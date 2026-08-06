# nginx-beautifier

`nginx-beautifier` is a safe NGINX configuration formatter for VS Code and Cursor.
It uses the editor's current indentation settings and keeps quoted NGINX values
byte-for-byte intact, including PCRE quantifiers such as `\d{4}`.

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

## File detection

The formatter is available for both `nginx` and legacy `NGINX` language IDs,
so it works alongside existing NGINX syntax-highlighting extensions. It also
matches these paths even when the editor currently sees the file as plain text:

- `**/nginx.conf`
- `**/conf.d/**/*.conf`
- `**/sites-available/*`
- `**/sites-enabled/*`

It intentionally does not claim every `*.conf` file. For another NGINX layout,
add a precise association in your VS Code or Cursor settings:

```json
{
  "files.associations": {
    "**/my-nginx/**/*.conf": "nginx"
  }
}
```

## Formatting

Run **Format Document** or enable `editor.formatOnSave`. The formatter uses the
`tabSize` and `insertSpaces` values supplied by the editor for that document.

If more than one NGINX formatter is installed, select **Format Document With...**
once, or configure this extension explicitly:

```json
{
  "[nginx]": {
    "editor.defaultFormatter": "ckdgh.nginx-beautifier"
  },
  "[NGINX]": {
    "editor.defaultFormatter": "ckdgh.nginx-beautifier"
  }
}
```

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

The formatter returns an incomplete or unbalanced document unchanged. It also
leaves `*_by_lua_block` blocks unchanged because their contents are Lua rather
than NGINX configuration syntax.

## Development

```shell
npm install
npm test
npm run package
```

`npm run package` creates a `.vsix` that can be installed from the Extensions
view in both VS Code and Cursor using **Install from VSIX...**.
