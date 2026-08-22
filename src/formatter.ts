export interface NginxFormatOptions {
  indentation: string;
  eol?: "\n" | "\r\n";
  removeCertbotComments?: boolean;
  preserveDirectiveLineBreaks?: boolean;
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
  closingComment?: Token;
  blankBefore: boolean;
}

type Node = CommentNode | DirectiveNode | BlockNode;

const MAX_NESTING_DEPTH = 256;

interface ParseResult {
  nodes: Node[];
  closeToken?: Token;
  closingComment?: Token;
}

interface FormatContext {
  indentation: string;
  removeCertbotComments: boolean;
  preserveDirectiveLineBreaks: boolean;
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

  if (body.length === 0 || body.trim().length === 0) {
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
    const context: FormatContext = {
      indentation: options.indentation,
      removeCertbotComments: options.removeCertbotComments ?? false,
      preserveDirectiveLineBreaks:
        options.preserveDirectiveLineBreaks ?? true,
      lines: [],
    };

    printNodes(parsed.nodes, 0, context);

    let formatted = context.lines.join(eol);
    if (formatted.length > 0) {
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

/**
 * Formats a balanced selection while keeping the indentation that places it in
 * its surrounding block. An incomplete selection still fails closed through
 * formatNginx and is returned byte-for-byte unchanged.
 */
export function formatNginxRange(
  source: string,
  options: NginxFormatOptions,
): string {
  const eol = options.eol ?? detectEol(source);
  const lines = source.split(/\r\n|\r|\n/u);
  const firstContentLine = lines.find((line) => /\S/u.test(line));
  const baseIndentation = firstContentLine?.match(/^[ \t]*/u)?.[0] ?? "";

  if (baseIndentation.length === 0) {
    return formatNginx(source, options);
  }

  const dedented = lines
    .map((line) =>
      line.startsWith(baseIndentation)
        ? line.slice(baseIndentation.length)
        : line,
    )
    .join(eol);
  const hadFinalNewline = /(?:\r\n|\r|\n)$/u.test(dedented);
  let formatted = formatNginx(dedented, { ...options, eol });

  if (!hadFinalNewline && formatted.endsWith(eol)) {
    formatted = formatted.slice(0, -eol.length);
  }

  if (formatted === dedented) {
    return source;
  }

  return formatted
    .split(eol)
    .map((line) => (line.length > 0 ? `${baseIndentation}${line}` : line))
    .join(eol);
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
    let quote: "'" | '"' | undefined;
    while (index < source.length) {
      const wordCharacter = source[index];

      if (wordCharacter === "\\") {
        if (index + 1 >= source.length) {
          throw new NginxSyntaxError("Dangling escape in word");
        }
        index += 2;
        continue;
      }

      if (quote !== undefined) {
        index += 1;
        if (wordCharacter === quote) {
          quote = undefined;
        }
        continue;
      }

      if (wordCharacter === "'" || wordCharacter === '"') {
        quote = wordCharacter;
        index += 1;
        continue;
      }

      if (
        isNginxWhitespace(wordCharacter) ||
        wordCharacter === ";" ||
        wordCharacter === "}"
      ) {
        break;
      }

      if (wordCharacter === "{") {
        const literalBraceEnd = findLiteralBraceEnd(source, index, start);
        if (literalBraceEnd === undefined) {
          break;
        }
        index = literalBraceEnd + 1;
        continue;
      }

      index += 1;
    }

    if (quote !== undefined) {
      throw new NginxSyntaxError("Unterminated quoted token");
    }

    if (index === start) {
      throw new NginxSyntaxError("Unable to read token");
    }

    emit("word", source.slice(start, index));
  }

  return tokens;
}

/**
 * NGINX uses braces both for blocks and inside unquoted values. Only consume
 * forms whose closing brace is unambiguous; every other opening brace remains
 * a block delimiter and is handled by the parser.
 */
function findLiteralBraceEnd(
  source: string,
  openIndex: number,
  tokenStart: number,
): number | undefined {
  if (openIndex <= tokenStart) {
    return undefined;
  }

  const closeIndex = source.indexOf("}", openIndex + 1);
  if (closeIndex === -1) {
    return undefined;
  }

  const contents = source.slice(openIndex + 1, closeIndex);
  const precedingCharacter = source[openIndex - 1];

  if (
    precedingCharacter === "$" &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(contents)
  ) {
    return closeIndex;
  }

  if (/^[0-9]+(?:,[0-9]*)?$/u.test(contents)) {
    return closeIndex;
  }

  const prefix = source.slice(Math.max(tokenStart, openIndex - 2), openIndex);
  if (/\\[pPkKgN]$/u.test(prefix) && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(contents)) {
    return closeIndex;
  }

  return undefined;
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
    const result = this.parseNodes(false, 0);
    if (this.index !== this.tokens.length) {
      throw new NginxSyntaxError("Unexpected tokens after document");
    }
    return result;
  }

  private parseNodes(expectClose: boolean, depth: number): ParseResult {
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
          if (depth >= MAX_NESTING_DEPTH) {
            throw new NginxSyntaxError("Maximum block nesting depth exceeded");
          }
          this.index += 1;
          const trailingComment = this.takeTrailingComment();
          const childResult = this.parseNodes(true, depth + 1);
          if (childResult.closeToken === undefined) {
            throw new NginxSyntaxError("Unclosed block");
          }

          nodes.push({
            type: "block",
            parts,
            trailingComment,
            children: childResult.nodes,
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
  let previousPrintedNode: Node | undefined;

  for (const node of nodes) {
    if (node.type === "comment" && shouldRemoveComment(node.comment, context)) {
      continue;
    }

    if (depth === 0 && node.type === "block" && previousPrintedNode?.type === "block") {
      addBlankLineIfNeeded(true, context.lines);
    }
    addBlankLineIfNeeded(node.blankBefore, context.lines);

    if (node.type === "comment") {
      context.lines.push(`${indent(depth, context)}${node.comment.raw}`);
      previousPrintedNode = node;
      continue;
    }

    printStatementStart(node.parts, depth, node.type === "block" ? "{" : ";", context);
    appendTrailingComment(node.trailingComment, context);

    if (node.type === "block") {
      printNodes(node.children, depth + 1, context);

      let closingLine = `${indent(depth, context)}}`;
      if (
        node.closingComment !== undefined &&
        !shouldRemoveComment(node.closingComment, context)
      ) {
        closingLine += ` ${node.closingComment.raw}`;
      }
      context.lines.push(closingLine);
    }

    previousPrintedNode = node;
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
      if (
        context.preserveDirectiveLineBreaks &&
        part.token.leadingNewlines > 0 &&
        words.length > 0
      ) {
        emitWords();
        addBlankLineIfNeeded(
          part.token.leadingNewlines >= 2,
          context.lines,
        );
      } else if (
        context.preserveDirectiveLineBreaks &&
        part.token.leadingNewlines >= 2 &&
        emittedSegment &&
        words.length === 0
      ) {
        addBlankLineIfNeeded(true, context.lines);
      }
      words.push(part.token);
      continue;
    }

    if (shouldRemoveComment(part.token, context)) {
      continue;
    }

    if (part.token.leadingNewlines > 0 && words.length > 0) {
      emitWords();
      addBlankLineIfNeeded(
        context.preserveDirectiveLineBreaks &&
          part.token.leadingNewlines >= 2,
        context.lines,
      );
      emitWords("", part.token);
    } else {
      emitWords("", part.token);
    }
  }

  if (terminator === "{") {
    if (words.length === 0 && emittedSegment) {
      context.lines.push(`${indent(depth, context)}{`);
    } else {
      emitWords(words.length > 0 ? " {" : "{");
    }
  } else {
    emitWords(";");
  }
}

function joinWords(words: Token[]): string {
  let result = "";
  for (const word of words) {
    if (result.length === 0) {
      result = word.raw;
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
  return comment.slice(1).trim().toLowerCase() === "managed by certbot";
}

function addBlankLineIfNeeded(blankBefore: boolean, lines: string[]): void {
  if (blankBefore && lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function indent(depth: number, context: FormatContext): string {
  return context.indentation.repeat(Math.max(0, depth));
}
