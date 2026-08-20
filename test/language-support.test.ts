import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createOnigScanner,
  createOnigString,
  loadWASM,
} from "vscode-oniguruma";
import {
  parseRawGrammar,
  Registry,
  type IGrammar,
  type IOnigLib,
  type IToken,
  type StateStack,
} from "vscode-textmate";

interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  configuration?: string;
}

interface GrammarContribution {
  language: string;
  scopeName: string;
  path: string;
}

interface ExtensionManifest {
  publisher?: string;
  contributes?: {
    languages?: LanguageContribution[];
    grammars?: GrammarContribution[];
  };
}

interface AutoClosingPair {
  open: string;
  close: string;
  notIn?: string[];
}

interface LanguageConfiguration {
  comments?: {
    lineComment?: string;
  };
  brackets?: string[][];
  colorizedBracketPairs?: string[][];
  autoClosingPairs?: AutoClosingPair[];
  surroundingPairs?: string[][];
  wordPattern?: string;
  indentationRules?: {
    increaseIndentPattern?: string;
    decreaseIndentPattern?: string;
  };
  folding?: {
    markers?: {
      start?: string;
      end?: string;
    };
  };
}

interface TokenizedLine {
  text: string;
  tokens: readonly IToken[];
}

const projectRoot = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(projectRoot, "package.json");
const expectedLanguageConfigurationPath = path.join(
  projectRoot,
  "language-configuration.json",
);
const expectedGrammarPath = path.join(
  projectRoot,
  "syntaxes",
  "nginx.tmLanguage.json",
);
const nginxScopeName = "source.nginx";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    assert.fail(message);
  }
  return value;
}

function resolveContributionPath(contributionPath: string): string {
  const resolved = path.resolve(projectRoot, contributionPath);
  const relative = path.relative(projectRoot, resolved);

  assert.ok(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    `Contribution path must stay inside the extension: ${contributionPath}`,
  );
  return resolved;
}

function hasPair(
  pairs: readonly (readonly string[])[] | undefined,
  open: string,
  close: string,
): boolean {
  return pairs?.some((pair) => pair[0] === open && pair[1] === close) ?? false;
}

test("manifest connects the nginx language, language configuration, and TextMate grammar", () => {
  const manifest = readJson<ExtensionManifest>(manifestPath);
  assert.equal(manifest.publisher, "lch");
  const languages = required(
    manifest.contributes?.languages,
    "package.json must contribute languages",
  );
  const language = required(
    languages.find((candidate) => candidate.id === "nginx"),
    "package.json must contribute the canonical lowercase nginx language id",
  );

  assert.equal(language.aliases?.[0], "NGINX Beautifier");
  assert.ok(language.aliases?.includes("NGINX"), "legacy NGINX alias is missing");
  assert.ok(language.aliases?.includes("nginx"), "nginx alias is missing");
  assert.ok(language.extensions?.includes(".nginx"), ".nginx association is missing");
  assert.ok(language.filenames?.includes("nginx.conf"), "nginx.conf association is missing");

  for (const pattern of [
    "**/nginx/**/*.conf",
    "**/conf.d/**/*.conf",
    "**/sites-available/*",
    "**/sites-enabled/*",
  ]) {
    assert.ok(
      language.filenamePatterns?.includes(pattern),
      `NGINX filename pattern is missing: ${pattern}`,
    );
  }

  const configurationContribution = required(
    language.configuration,
    "nginx language must reference a language configuration",
  );
  const configurationPath = resolveContributionPath(configurationContribution);
  assert.equal(configurationPath, expectedLanguageConfigurationPath);
  assert.ok(existsSync(configurationPath), `${configurationContribution} does not exist`);

  const grammars = required(
    manifest.contributes?.grammars,
    "package.json must contribute grammars",
  );
  const grammarContribution = required(
    grammars.find((candidate) => candidate.language === "nginx"),
    "package.json must bind a grammar to nginx",
  );
  assert.equal(grammarContribution.scopeName, nginxScopeName);

  const grammarPath = resolveContributionPath(grammarContribution.path);
  assert.equal(grammarPath, expectedGrammarPath);
  assert.ok(existsSync(grammarPath), `${grammarContribution.path} does not exist`);

  const rawGrammar = parseRawGrammar(
    readFileSync(grammarPath, "utf8"),
    grammarPath,
  );
  assert.equal(rawGrammar.scopeName, grammarContribution.scopeName);
  assert.ok(rawGrammar.patterns.length > 0, "grammar must define top-level patterns");

  for (const repositoryEntry of [
    "comments",
    "directive",
    "rewrite-directive",
    "block-directive",
    "strings",
    "variables",
    "regular-expressions",
    "numbers",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(rawGrammar.repository, repositoryEntry),
      `grammar repository entry is missing: ${repositoryEntry}`,
    );
  }
});

test("language configuration supplies NGINX editing behavior", () => {
  const configuration = readJson<LanguageConfiguration>(
    expectedLanguageConfigurationPath,
  );

  assert.equal(configuration.comments?.lineComment, "#");
  for (const pair of [
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    assert.ok(
      hasPair(configuration.brackets, pair[0], pair[1]),
      `bracket pair is missing: ${pair[0]}${pair[1]}`,
    );
    assert.ok(
      configuration.autoClosingPairs?.some(
        (candidate) => candidate.open === pair[0] && candidate.close === pair[1],
      ),
      `auto-closing pair is missing: ${pair[0]}${pair[1]}`,
    );
    assert.ok(
      hasPair(configuration.surroundingPairs, pair[0], pair[1]),
      `surrounding pair is missing: ${pair[0]}${pair[1]}`,
    );
  }

  assert.deepEqual(configuration.colorizedBracketPairs, [["{", "}"]]);

  const wordPattern = required(
    configuration.wordPattern,
    "language configuration must define wordPattern",
  );
  const increaseIndentPattern = required(
    configuration.indentationRules?.increaseIndentPattern,
    "language configuration must define increaseIndentPattern",
  );
  const decreaseIndentPattern = required(
    configuration.indentationRules?.decreaseIndentPattern,
    "language configuration must define decreaseIndentPattern",
  );
  const foldingStart = required(
    configuration.folding?.markers?.start,
    "language configuration must define a folding start marker",
  );
  const foldingEnd = required(
    configuration.folding?.markers?.end,
    "language configuration must define a folding end marker",
  );

  for (const pattern of [
    wordPattern,
    increaseIndentPattern,
    decreaseIndentPattern,
    foldingStart,
    foldingEnd,
  ]) {
    assert.doesNotThrow(() => new RegExp(pattern), `invalid language regex: ${pattern}`);
  }

  const increaseIndent = new RegExp(increaseIndentPattern);
  const decreaseIndent = new RegExp(decreaseIndentPattern);
  assert.match("server {", increaseIndent);
  assert.match("location ~ ^/items/[0-9]{2,4}$ { # block", increaseIndent);
  assert.doesNotMatch('set $literal "{";', increaseIndent);
  assert.match("  }", decreaseIndent);
});

let grammarPromise: Promise<IGrammar> | undefined;

function loadNginxGrammar(): Promise<IGrammar> {
  grammarPromise ??= (async () => {
    const wasm = readFileSync(
      require.resolve("vscode-oniguruma/release/onig.wasm"),
    );
    await loadWASM(wasm);

    // vscode-textmate and vscode-oniguruma deliberately expose the same runtime
    // scanner API, although their latest declaration files model options
    // differently. Keep the compatibility cast at this integration boundary.
    const onigLib = Promise.resolve({
      createOnigScanner,
      createOnigString,
    } as unknown as IOnigLib);
    const registry = new Registry({
      onigLib,
      async loadGrammar(scopeName) {
        if (scopeName !== nginxScopeName) {
          return null;
        }
        return parseRawGrammar(
          readFileSync(expectedGrammarPath, "utf8"),
          expectedGrammarPath,
        );
      },
    });
    const grammar = await registry.loadGrammar(nginxScopeName);

    if (grammar === null) {
      assert.fail(`Unable to load TextMate grammar ${nginxScopeName}`);
    }
    return grammar;
  })();

  return grammarPromise;
}

function tokenizeLines(grammar: IGrammar, lines: readonly string[]): TokenizedLine[] {
  let ruleStack: StateStack | null = null;

  return lines.map((text) => {
    const result = grammar.tokenizeLine(text, ruleStack);
    ruleStack = result.ruleStack;
    return { text, tokens: result.tokens };
  });
}

function scopesAt(line: TokenizedLine, index: number): readonly string[] {
  const token = line.tokens.find(
    (candidate) => candidate.startIndex <= index && index < candidate.endIndex,
  );

  if (token === undefined) {
    assert.fail(`No token at column ${index} in ${JSON.stringify(line.text)}`);
  }
  return token.scopes;
}

function scopesFor(
  line: TokenizedLine,
  needle: string,
  offsetWithinNeedle = 0,
): readonly string[] {
  const start = line.text.indexOf(needle);
  assert.notEqual(start, -1, `${JSON.stringify(needle)} is absent from ${JSON.stringify(line.text)}`);
  return scopesAt(line, start + offsetWithinNeedle);
}

function assertHasScope(
  line: TokenizedLine,
  needle: string,
  expectedScope: string,
  offsetWithinNeedle = 0,
): void {
  const scopes = scopesFor(line, needle, offsetWithinNeedle);
  assert.ok(
    scopes.includes(expectedScope),
    `${JSON.stringify(needle)} expected ${expectedScope}, received ${scopes.join(" ")}`,
  );
}

test("TextMate grammar scopes representative NGINX syntax", async () => {
  const grammar = await loadNginxGrammar();
  const lines = tokenizeLines(grammar, [
    "server {",
    "  listen 127.0.0.1:443 ssl; # secure listener",
    "  set $origin \"${scheme}://${host}\";",
    "  location ~* ^/assets/(?:css|js)/.+\\.(?:css|js)$ {",
    "    proxy_pass http://backend;",
    "  }",
    "  custom_module_toggle on;",
    "  keepalive_timeout 65s;",
    "  types {",
    "    text/html html;",
    "  }",
    "}",
  ]);

  assertHasScope(lines[0], "server", "entity.name.type.block.nginx");
  assertHasScope(lines[0], "{", "punctuation.section.block.begin.nginx");
  assertHasScope(lines[1], "listen", "keyword.other.directive.nginx");
  assertHasScope(lines[1], "127.0.0.1:443", "constant.numeric.ipv4.nginx");
  assertHasScope(lines[1], "ssl", "constant.language.nginx");
  assertHasScope(lines[1], ";", "punctuation.terminator.directive.nginx");
  assertHasScope(lines[1], "#", "comment.line.number-sign.nginx");
  assertHasScope(lines[2], "$origin", "variable.other.nginx");
  assertHasScope(lines[2], "${scheme}", "variable.other.braced.nginx");
  assertHasScope(lines[2], "${host}", "variable.other.braced.nginx");
  assertHasScope(lines[2], "\"${scheme}", "string.quoted.double.nginx", 1);
  assertHasScope(lines[3], "location", "entity.name.type.block.nginx");
  assertHasScope(lines[3], "~*", "keyword.operator.regexp.nginx");
  assertHasScope(lines[3], "^/assets", "string.regexp.unquoted.nginx");
  assertHasScope(lines[4], "proxy_pass", "keyword.other.directive.nginx");
  assertHasScope(lines[4], "http://backend", "string.unquoted.url.nginx");
  assertHasScope(lines[6], "custom_module_toggle", "keyword.other.directive.nginx");
  assertHasScope(lines[6], "on", "constant.language.boolean.nginx");
  assertHasScope(lines[7], "65s", "constant.numeric.nginx");
  assertHasScope(lines[8], "types", "entity.name.type.block.nginx");
  assertHasScope(lines[9], "text/html", "constant.other.mime-type.nginx");
});

test("rewrite patterns stay a single regexp token instead of bracket punctuation", async () => {
  const grammar = await loadNginxGrammar();
  const [location, rewrite] = tokenizeLines(grammar, [
    "location /api/ {",
    "  rewrite ^([^.]*[^/])$ $1/ break;",
  ]);

  assertHasScope(location, "location", "entity.name.type.block.nginx");
  assertHasScope(location, "{", "punctuation.section.block.begin.nginx");

  for (const token of ["^", "(", "[", "]", ")", "$"]) {
    const scopes = scopesFor(rewrite, token);
    assert.ok(
      scopes.includes("string.regexp.unquoted.nginx"),
      `${JSON.stringify(token)} was not scoped as regexp: ${scopes.join(" ")}`,
    );
    assert.equal(
      scopes.some((scope) => scope.startsWith("punctuation.section.")),
      false,
      `${JSON.stringify(token)} was also scoped as bracket punctuation: ${scopes.join(" ")}`,
    );
  }
});

test("hash signs inside bare and quoted values are not comments", async () => {
  const grammar = await loadNginxGrammar();
  const [bare, quoted] = tokenizeLines(grammar, [
    "set $literal foo#bar; # actual comment",
    "set $quoted \"foo#bar\";",
  ]);

  const bareHashScopes = scopesFor(bare, "#bar");
  assert.equal(
    bareHashScopes.some((scope) => scope.startsWith("comment.")),
    false,
    `foo#bar was misclassified as a comment: ${bareHashScopes.join(" ")}`,
  );
  assertHasScope(bare, "# actual", "comment.line.number-sign.nginx");

  const quotedHashScopes = scopesFor(quoted, "#bar");
  assert.ok(quotedHashScopes.includes("string.quoted.double.nginx"));
  assert.equal(
    quotedHashScopes.some((scope) => scope.startsWith("comment.")),
    false,
    `quoted foo#bar was misclassified as a comment: ${quotedHashScopes.join(" ")}`,
  );
});
