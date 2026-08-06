export interface NginxFormatOptions {
  indentation: string;
  eol?: "\n" | "\r\n";
  removeCertbotComments?: boolean;
}

type TokenType =
  | "word"
  | "semicolon"
  | "openBrace"
  | "closeBrace"
  | "comment";

interface Token {
  type: TokenType;
  raw: string;
  leadingNewlines: number;
}

interface WordPart {
  type: "word";
  token: Token;
}

interface CommentPart {
  type: "comment";
  token: Token;
}

type StatementPart = WordPart | CommentPart;

interface CommentNode {
  type: "comment";
  comment: Token;
  blankBefore: boolean;
}

interface DirectiveNode {
  type: "directive";
  parts: StatementPart[];
  trailingComment?: Token;
  blankBefore: boolean;
}

interface BlockNode {
  type: "block";
  parts: StatementPart[];
  trailingComment?: Token;
  children: Node[];
  blankBeforeClose: boolean;
  closingComment?: Token;
  blankBefore: boolean;
}

type Node = CommentNode | DirectiveNode | BlockNode;

interface ParseResult {
  nodes: Node[];
  closeToken?: Token;
  closingComment?: Token;
}

interface FormatContext {
  indentation: string;
  removeCertbotComments: boolean;
  lines: string[];
}

class NginxSyntaxError extends Error {}

/**
 * Formats an NGINX configuration without changing the raw contents of tokens.
 * Invalid or unsupported input is returned unchanged (fail closed).
 */
export function formatNginx(
  source: string,
  options: NginxFormatOptions,
): string {
  const hasBom = source.startsWith("\uFEFF");
  const body = hasBom ? source.slice(1) : source;

  if (body.length === 0) {
    return source;
  }

  try {
    const tokens = lex(body);

    // A physical newline inside a quoted/escaped token is value data. Until an
    // embedded-value printer exists, leave that document untouched.
    if (tokens.some((token) => token.type === "word" && /[\r\n]/u.test(token.raw))) {
      return source;
    }

    const parser = new Parser(tokens);
    const parsed = parser.parse();

    if (containsEmbeddedLanguageBlock(parsed.nodes)) {
      return source;
    }

    const eol = options.eol ?? detectEol(body);
    const hadFinalNewline = /(?:\r\n|\r|\n)$/u.test(body);
    const context: FormatContext = {
      indentation: options.indentation,
      removeCertbotComments: options.removeCertbotComments ?? false,
      lines: [],
    };

    printNodes(parsed.nodes, 0, context);

    let formatted = context.lines.join(eol);
    if (hadFinalNewline && formatted.length > 0) {
      formatted += eol;
    }

    if (hasBom) {
      formatted = `\uFEFF${formatted}`;
    }

    return formatted;
  } catch (error) {
    if (error instanceof NginxSyntaxError) {
      return source;
    }
    throw error;
  }
}

function detectEol(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let leadingNewlines = 0;

  const emit = (type: TokenType, raw: string): void => {
    tokens.push({ type, raw, leadingNewlines });
    leadingNewlines = 0;
  };

  while (index < source.length) {
    const character = source[index];

    if (isHorizontalWhitespace(character)) {
      index += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      leadingNewlines += 1;
      continue;
    }

    if (character === "#") {
      const start = index;
      while (
        index < source.length &&
        source[index] !== "\r" &&
        source[index] !== "\n"
      ) {
        index += 1;
      }
      emit("comment", source.slice(start, index).replace(/[ \t]+$/u, ""));
      continue;
    }

    if (character === ";") {
      emit("semicolon", character);
      index += 1;
      continue;
    }

    if (character === "{") {
      emit("openBrace", character);
      index += 1;
      continue;
    }

    if (character === "}") {
      emit("closeBrace", character);
      index += 1;
      continue;
    }

    const start = index;

    if (character === "'" || character === '"') {
      const quote = character;
      index += 1;
      let closed = false;

      while (index < source.length) {
        const quotedCharacter = source[index];
        if (quotedCharacter === "\\") {
          if (index + 1 >= source.length) {
            throw new NginxSyntaxError("Dangling escape in quoted token");
          }
          index += 2;
          continue;
        }
        index += 1;
        if (quotedCharacter === quote) {
          closed = true;
          break;
        }
      }

      if (!closed) {
        throw new NginxSyntaxError("Unterminated quoted token");
      }

      const next = source[index];
      if (
        next !== undefined &&
        !isNginxWhitespace(next) &&
        next !== ";" &&
        next !== "{" &&
        next !== ")"
      ) {
        throw new NginxSyntaxError("Missing separator after quoted token");
      }

      emit("word", source.slice(start, index));
      continue;
    }

    while (index < source.length) {
      const bareCharacter = source[index];

      if (bareCharacter === "\\") {
        if (index + 1 >= source.length) {
          throw new NginxSyntaxError("Dangling escape in bare token");
        }
        index += 2;
        continue;
      }

      if (
        isNginxWhitespace(bareCharacter) ||
        bareCharacter === ";" ||
        (bareCharacter === "{" && source[index - 1] !== "$")
      ) {
        break;
      }

      index += 1;
    }

    if (index === start) {
      throw new NginxSyntaxError("Unable to read token");
    }

    emit("word", source.slice(start, index));
  }

  return tokens;
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function isNginxWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\r" ||
    character === "\n"
  );
}

class Parser {
  private index = 0;

  public constructor(private readonly tokens: Token[]) {}

  public parse(): ParseResult {
    const result = this.parseNodes(false);
    if (this.index !== this.tokens.length) {
      throw new NginxSyntaxError("Unexpected tokens after document");
    }
    return result;
  }

  private parseNodes(expectClose: boolean): ParseResult {
    const nodes: Node[] = [];

    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];

      if (token.type === "closeBrace") {
        if (!expectClose) {
          throw new NginxSyntaxError("Unexpected closing brace");
        }
        this.index += 1;
        return {
          nodes,
          closeToken: token,
          closingComment: this.takeTrailingComment(),
        };
      }

      if (token.type === "comment") {
        nodes.push({
          type: "comment",
          comment: token,
          blankBefore: token.leadingNewlines >= 2,
        });
        this.index += 1;
        continue;
      }

      if (token.type !== "word") {
        throw new NginxSyntaxError("Directive must start with a word");
      }

      const blankBefore = token.leadingNewlines >= 2;
      const parts: StatementPart[] = [];
      let completed = false;

      while (this.index < this.tokens.length) {
        const statementToken = this.tokens[this.index];

        if (statementToken.type === "word") {
          parts.push({ type: "word", token: statementToken });
          this.index += 1;
          continue;
        }

        if (statementToken.type === "comment") {
          parts.push({ type: "comment", token: statementToken });
          this.index += 1;
          continue;
        }

        if (statementToken.type === "semicolon") {
          this.index += 1;
          nodes.push({
            type: "directive",
            parts,
            trailingComment: this.takeTrailingComment(),
            blankBefore,
          });
          completed = true;
          break;
        }

        if (statementToken.type === "openBrace") {
          this.index += 1;
          const trailingComment = this.takeTrailingComment();
          const childResult = this.parseNodes(true);
          if (childResult.closeToken === undefined) {
            throw new NginxSyntaxError("Unclosed block");
          }

          nodes.push({
            type: "block",
            parts,
            trailingComment,
            children: childResult.nodes,
            blankBeforeClose: childResult.closeToken.leadingNewlines >= 2,
            closingComment: childResult.closingComment,
            blankBefore,
          });
          completed = true;
          break;
        }

        throw new NginxSyntaxError("Unterminated directive");
      }

      if (!completed) {
        throw new NginxSyntaxError("Unexpected end of directive");
      }
    }

    if (expectClose) {
      throw new NginxSyntaxError("Unclosed block");
    }

    return { nodes };
  }

  private takeTrailingComment(): Token | undefined {
    const token = this.tokens[this.index];
    if (token?.type === "comment" && token.leadingNewlines === 0) {
      this.index += 1;
      return token;
    }
    return undefined;
  }
}

function containsEmbeddedLanguageBlock(nodes: Node[]): boolean {
  for (const node of nodes) {
    if (node.type !== "block") {
      continue;
    }

    const firstWord = node.parts.find(
      (part): part is WordPart => part.type === "word",
    );
    if (firstWord !== undefined && /_by_lua_block$/u.test(firstWord.token.raw)) {
      return true;
    }

    if (containsEmbeddedLanguageBlock(node.children)) {
      return true;
    }
  }
  return false;
}

function printNodes(nodes: Node[], depth: number, context: FormatContext): void {
  for (const node of nodes) {
    if (node.type === "comment" && shouldRemoveComment(node.comment, context)) {
      continue;
    }

    addBlankLineIfNeeded(node.blankBefore, context.lines);

    if (node.type === "comment") {
      context.lines.push(`${indent(depth, context)}${node.comment.raw}`);
      continue;
    }

    printStatementStart(node.parts, depth, node.type === "block" ? "{" : ";", context);
    appendTrailingComment(node.trailingComment, context);

    if (node.type === "block") {
      printNodes(node.children, depth + 1, context);
      addBlankLineIfNeeded(node.blankBeforeClose, context.lines);

      let closingLine = `${indent(depth, context)}}`;
      if (
        node.closingComment !== undefined &&
        !shouldRemoveComment(node.closingComment, context)
      ) {
        closingLine += ` ${node.closingComment.raw}`;
      }
      context.lines.push(closingLine);
    }
  }
}

function printStatementStart(
  parts: StatementPart[],
  depth: number,
  terminator: ";" | "{",
  context: FormatContext,
): void {
  let words: Token[] = [];
  let emittedSegment = false;

  const emitWords = (suffix = "", comment?: Token): void => {
    const code = joinWords(words);
    let line = `${indent(depth + (emittedSegment ? 1 : 0), context)}${code}`;
    line += suffix;
    if (comment !== undefined) {
      if (code.length > 0 || suffix.length > 0) {
        line += " ";
      }
      line += comment.raw;
    }
    context.lines.push(line);
    words = [];
    emittedSegment = true;
  };

  for (const part of parts) {
    if (part.type === "word") {
      words.push(part.token);
      continue;
    }

    if (shouldRemoveComment(part.token, context)) {
      continue;
    }

    if (part.token.leadingNewlines > 0 && words.length > 0) {
      emitWords();
      emitWords("", part.token);
    } else {
      emitWords("", part.token);
    }
  }

  if (terminator === "{") {
    emitWords(words.length > 0 ? " {" : "{");
  } else {
    emitWords(";");
  }
}

function joinWords(words: Token[]): string {
  let result = "";
  for (const word of words) {
    if (result.length === 0) {
      result = word.raw;
    } else if (word.raw === ")") {
      result += word.raw;
    } else {
      result += ` ${word.raw}`;
    }
  }
  return result;
}

function appendTrailingComment(
  comment: Token | undefined,
  context: FormatContext,
): void {
  if (comment === undefined || shouldRemoveComment(comment, context)) {
    return;
  }
  const lastIndex = context.lines.length - 1;
  context.lines[lastIndex] += ` ${comment.raw}`;
}

function shouldRemoveComment(comment: Token, context: FormatContext): boolean {
  return context.removeCertbotComments && isCertbotManagedComment(comment.raw);
}

export function isCertbotManagedComment(comment: string): boolean {
  if (!comment.startsWith("#")) {
    return false;
  }
  return comment.slice(1).trim().toLocaleLowerCase("en-US") === "managed by certbot";
}

function addBlankLineIfNeeded(blankBefore: boolean, lines: string[]): void {
  if (blankBefore && lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function indent(depth: number, context: FormatContext): string {
  return context.indentation.repeat(Math.max(0, depth));
}
