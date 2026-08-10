# NGINX Beautifier

NGINX Beautifier provides complete NGINX language support for VS Code and
Cursor: an `nginx` language mode, syntax highlighting, editor behavior, and a
safe configuration formatter.

## Features

- **NGINX Beautifier** in the language selector
- TextMate highlighting for directives, blocks, comments, strings, variables,
  regular expressions, URLs, addresses, units, and punctuation
- Comment toggling, bracket matching, auto-closing pairs, folding, and block
  indentation
- **Format Document**, **Format Selection**, and `editor.formatOnSave`
- Editor-controlled spaces/tabs and LF/CRLF preservation
- Fail-closed parsing for incomplete or unsupported input

## Why

Formatters that split every `{` and `}` as an NGINX block can corrupt valid
quoted regular expressions. This extension tokenizes quotes, escapes, comments,
and `${variables}` before it formats block structure.

For example, this value remains a single token:

```nginx
map $time_iso8601 $datetime_kst {
  '~^(?<d>\d{4}-\d{2}-\d{2})T(?<t>\d{2}:\d{2}:\d{2})' '$d $t';
  default '-';
}
```

## Language and file detection

The extension registers the canonical `nginx` language ID and displays it as
**NGINX Beautifier**. It automatically detects:

- `nginx.conf`
- `*.nginx`, `*.nginx.conf`, and `*.nginxconf`
- `**/nginx/**/*.conf`
- `**/conf.d/**/*.conf`
- `**/sites-available/*`
- `**/sites-enabled/*`

It intentionally does not claim every `*.conf` file because `.conf` is also
used by unrelated formats. For another layout, choose **NGINX Beautifier** from
**Change Language Mode** (`Ctrl+K M`) or add a precise association:

```json
{
  "files.associations": {
    "**/my-nginx/**/*.conf": "nginx"
  }
}
```

## Formatting

Run **Format Document**, **Format Selection**, or enable `editor.formatOnSave`.
The formatter uses the document's active `tabSize` and `insertSpaces` values.
Intentional line breaks in directives such as `log_format` are preserved and
continuation lines are indented one level.

If more than one NGINX formatter is installed, select **Format Document With...**
once, or configure this extension explicitly:

```json
{
  "[nginx]": {
    "editor.defaultFormatter": "lch.nginx-beautifier"
  }
}
```

To flatten multi-line directives instead of preserving their line breaks:

```json
{
  "nginxBeautifier.preserveDirectiveLineBreaks": false
}
```

The formatter also remains compatible with the legacy uppercase `NGINX`
language ID contributed by some older extensions.

## Certbot marker comments

Certbot commonly annotates generated directives with `# managed by Certbot`.
The marker is preserved by default. To remove only that exact marker comment
(case-insensitive) while leaving its directive in place:

```json
{
  "nginxBeautifier.removeCertbotComments": true
}
```

Near matches, quoted text, and other comments are preserved.

## Safety

The formatter preserves raw token contents and logical argument boundaries. It
returns incomplete or unbalanced input unchanged, keeps quoted and unquoted
PCRE quantifiers intact, and leaves documents containing `*_by_lua_block`
unchanged because those blocks contain Lua rather than NGINX syntax.

## Development

```shell
npm install
npm test
npm run package
```

The test suite exercises both the formatter and the actual TextMate/Oniguruma
tokenizer used by VS Code. `npm run package` creates a `.vsix` that can be
installed from the Extensions view using **Install from VSIX...**.
