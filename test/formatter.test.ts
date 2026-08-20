import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatNginx,
  formatNginxRange,
  isCertbotManagedComment,
} from "../src/formatter";

const twoSpaces = { indentation: "  " } as const;

function document(lines: string[], eol = "\n"): string {
  return `${lines.join(eol)}${eol}`;
}

test("formats a map without interpreting braces in its quoted regular expression", () => {
  const source = [
    "map   $time_iso8601   $datetime_kst{",
    "'~^(?<d>\\d{4}-\\d{2}-\\d{2})T(?<t>\\d{2}:\\d{2}:\\d{2})'  '$d $t';",
    "default    '-';",
    "}",
  ].join("\n");
  const expected = document([
    "map $time_iso8601 $datetime_kst {",
    "  '~^(?<d>\\d{4}-\\d{2}-\\d{2})T(?<t>\\d{2}:\\d{2}:\\d{2})' '$d $t';",
    "  default '-';",
    "}",
  ]);

  const formatted = formatNginx(source, twoSpaces);

  assert.equal(formatted, expected);
  assert.ok(
    formatted.includes(
      "'~^(?<d>\\d{4}-\\d{2}-\\d{2})T(?<t>\\d{2}:\\d{2}:\\d{2})'",
    ),
  );
});

test("keeps quoted, escaped, variable, and comment punctuation inside tokens", () => {
  const source = [
    "server{",
    'set $double "a;{b}#c";',
    "set $single 'x\\';{y}#z';",
    "set $bare foo\\{bar\\}\\;baz\\#qux;",
    "set $hash foo#bar;",
    "set $origin ${scheme}://${host}:${server_port};",
    "# a comment containing { } and ;",
    "location /{# a trailing comment containing } { ;",
    "return 200;",
    "}",
    'if ($request_method = "POST"){return 405;}',
    "}",
  ].join("\n");
  const expected = document([
    "server {",
    '  set $double "a;{b}#c";',
    "  set $single 'x\\';{y}#z';",
    "  set $bare foo\\{bar\\}\\;baz\\#qux;",
    "  set $hash foo#bar;",
    "  set $origin ${scheme}://${host}:${server_port};",
    "  # a comment containing { } and ;",
    "  location / { # a trailing comment containing } { ;",
    "    return 200;",
    "  }",
    '  if ($request_method = "POST") {',
    "    return 405;",
    "  }",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("preserves nginx argument boundaries around a standalone closing parenthesis", () => {
  const source = [
    "server{",
    "set   $literal   );",
    "return   200   );",
    'if ($request_method = "POST"){return 405;}',
    "}",
  ].join("\n");
  const expected = document([
    "server {",
    "  set $literal );",
    "  return 200 );",
    '  if ($request_method = "POST") {',
    "    return 405;",
    "  }",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("keeps adjacent quoted and unquoted token segments together", () => {
  const source = 'set   $value   prefix"two words"$suffix;\n';
  const expected = 'set $value prefix"two words"$suffix;\n';

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("formats unquoted regular-expression quantifiers and named properties safely", () => {
  const source = [
    "server{",
    "location ~ ^/items/[0-9]{2,4}$ {return 200;}",
    "location ~ ^/letters/\\p{Letter}+$ {return 204;}",
    "}",
  ].join("\n");
  const expected = document([
    "server {",
    "  location ~ ^/items/[0-9]{2,4}$ {",
    "    return 200;",
    "  }",
    "  location ~ ^/letters/\\p{Letter}+$ {",
    "    return 204;",
    "  }",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("recognizes only the complete Certbot marker comment", () => {
  assert.equal(isCertbotManagedComment("# managed by Certbot"), true);
  assert.equal(isCertbotManagedComment("#\tMANAGED BY CERTBOT  "), true);
  assert.equal(isCertbotManagedComment("managed by Certbot"), false);
  assert.equal(isCertbotManagedComment("# managed by Certbot - keep"), false);
  assert.equal(isCertbotManagedComment("# not managed by Certbot"), false);
});

test("keeps Certbot marker comments by default", () => {
  const source = [
    "server{",
    "listen 443 ssl;# managed by Certbot",
    'set $marker "# managed by Certbot";',
    "# managed by Certbot",
    "return 404;# managed by Certbot - keep",
    "}# managed by Certbot",
  ].join("\n");
  const expected = document([
    "server {",
    "  listen 443 ssl; # managed by Certbot",
    '  set $marker "# managed by Certbot";',
    "  # managed by Certbot",
    "  return 404; # managed by Certbot - keep",
    "} # managed by Certbot",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
  assert.equal(
    formatNginx(source, { ...twoSpaces, removeCertbotComments: false }),
    expected,
  );
});

test("removes only Certbot marker comment tokens when enabled", () => {
  const source = [
    "server{",
    "listen 443 ssl;# managed by Certbot",
    'set $marker "# managed by Certbot";',
    "# managed by Certbot",
    "return 404;# managed by Certbot - keep",
    "}# managed by Certbot",
  ].join("\n");
  const expected = document([
    "server {",
    "  listen 443 ssl;",
    '  set $marker "# managed by Certbot";',
    "  return 404; # managed by Certbot - keep",
    "}",
  ]);

  assert.equal(
    formatNginx(source, {
      ...twoSpaces,
      removeCertbotComments: true,
    }),
    expected,
  );
});

test("uses the indentation string supplied by the editor", () => {
  const source = "http{server{location /{proxy_pass http://backend;}}}";

  assert.equal(
    formatNginx(source, { indentation: "  " }),
    document([
      "http {",
      "  server {",
      "    location / {",
      "      proxy_pass http://backend;",
      "    }",
      "  }",
      "}",
    ]),
  );
  assert.equal(
    formatNginx(source, { indentation: "\t" }),
    document([
      "http {",
      "\tserver {",
      "\t\tlocation / {",
      "\t\t\tproxy_pass http://backend;",
      "\t\t}",
      "\t}",
      "}",
    ]),
  );
});

test("preserves CRLF line endings and a final newline", () => {
  const source = "http{\r\nserver{\r\nlisten 80;\r\n}\r\n}\r\n";
  const expected = document([
    "http {",
    "  server {",
    "    listen 80;",
    "  }",
    "}",
  ], "\r\n");

  const formatted = formatNginx(source, twoSpaces);

  assert.equal(formatted, expected);
  assert.doesNotMatch(formatted.replaceAll("\r\n", ""), /\n/u);
});

test("removes blank lines immediately before closing braces", () => {
  const source = [
    "server {",
    "  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;",
    "",
    "}",
  ].join("\n");
  const expected = document([
    "server {",
    "  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("adds a blank line between adjacent top-level blocks", () => {
  const source = [
    "server {",
    "  listen 80;",
    "}",
    "server {",
    "  listen 443 ssl;",
    "}",
  ].join("\n");
  const expected = document([
    "server {",
    "  listen 80;",
    "}",
    "",
    "server {",
    "  listen 443 ssl;",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("always adds a final newline to a formatted document", () => {
  assert.equal(formatNginx("worker_processes auto;", twoSpaces), "worker_processes auto;\n");
});

const invalidCases: ReadonlyArray<readonly [name: string, source: string]> = [
  ["unterminated quote", 'server{set $x "unterminated;\n}'],
  ["dangling escape", "server{set $x dangling\\"],
  ["unclosed block", "server{listen 80;"],
  ["unexpected closing brace", "server{listen 80;}}"],
  ["missing semicolon", "server {\nlisten 80\n}\n"],
];

for (const [name, source] of invalidCases) {
  test(`fails closed for ${name}`, () => {
    assert.equal(formatNginx(source, twoSpaces), source);
  });
}

test("fails closed when a quoted or escaped token contains a physical newline", () => {
  const quoted = 'set $value "first\n  second;{#}";\n';
  const escaped = "set $value first\\\nsecond;\n";

  assert.equal(formatNginx(quoted, twoSpaces), quoted);
  assert.equal(formatNginx(escaped, twoSpaces), escaped);
});

test("formatting is idempotent", () => {
  const source = [
    "http{",
    "map $http_upgrade $connection_upgrade{",
    "default upgrade;",
    "'' close;",
    "}",
    "",
    "server{listen 80;# ordinary comment",
    "return 404;# managed by Certbot",
    "}",
    "}",
  ].join("\n");

  for (const removeCertbotComments of [false, true]) {
    const options = { ...twoSpaces, removeCertbotComments };
    const once = formatNginx(source, options);
    const twice = formatNginx(once, options);
    assert.equal(twice, once);
  }
});

test("preserves and consistently indents multi-line directives by default", () => {
  const source = [
    "http{",
    "log_format   main   '$remote_addr - $remote_user'",
    "              '\"$request\" $status $body_bytes_sent';",
    "}",
  ].join("\n");
  const expected = document([
    "http {",
    "  log_format main '$remote_addr - $remote_user'",
    "    '\"$request\" $status $body_bytes_sent';",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
  assert.equal(
    formatNginx(source, {
      ...twoSpaces,
      preserveDirectiveLineBreaks: false,
    }),
    document([
      "http {",
      "  log_format main '$remote_addr - $remote_user' '\"$request\" $status $body_bytes_sent';",
      "}",
    ]),
  );
});

test("keeps a block brace at block depth after a header comment", () => {
  const source = [
    "server # keep this header note",
    "{",
    "listen 80;",
    "}",
  ].join("\n");
  const expected = document([
    "server # keep this header note",
    "{",
    "  listen 80;",
    "}",
  ]);

  assert.equal(formatNginx(source, twoSpaces), expected);
});

test("formats a balanced selection without losing its surrounding indentation", () => {
  const source = [
    "    listen   80;",
    "    location /api{",
    "    proxy_pass   http://backend;",
    "    }",
  ].join("\n");
  const expected = [
    "    listen 80;",
    "    location /api {",
    "      proxy_pass http://backend;",
    "    }",
  ].join("\n");

  assert.equal(formatNginxRange(source, twoSpaces), expected);
});

test("leaves an incomplete selection and whitespace-only input unchanged", () => {
  const incomplete = [
    "    location /api {",
    "      proxy_pass http://backend;",
  ].join("\n");
  const whitespace = "  \r\n\t\r\n";

  assert.equal(formatNginxRange(incomplete, twoSpaces), incomplete);
  assert.equal(formatNginx(whitespace, twoSpaces), whitespace);
});

test("fails closed before pathologically deep blocks can exhaust the stack", () => {
  const source = `${"section{".repeat(300)}${"}".repeat(300)}`;

  assert.equal(formatNginx(source, twoSpaces), source);
});

test("leaves Lua embedded-language blocks completely unchanged", () => {
  const source = [
    "http{server{",
    "content_by_lua_block {",
    'ngx.say("hello");',
    "}",
    "}}",
  ].join("\n");

  assert.equal(formatNginx(source, twoSpaces), source);
});
