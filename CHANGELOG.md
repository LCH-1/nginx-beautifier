# Changelog

## 0.2.3

- Treat the first `rewrite` argument as one regular-expression token.
- Restrict bracket-pair colorization to NGINX block braces so regex groups and character classes stay visually consistent.
- Give block directives a distinct type scope so names such as `location` contrast with braces across common themes.

## 0.2.2

- Remove blank lines immediately before closing braces.
- Add a blank line between adjacent top-level blocks.
- Ensure formatted documents end with a final newline.

## 0.2.1

- Display the language as **NGINX Beautifier** in the language selector.
- Align the Marketplace publisher and extension ID with the other `lch` extensions.
- Add Marketplace homepage, issue, and release-script metadata.

## 0.2.0

- Register the canonical `nginx` language and add automatic NGINX file detection.
- Add TextMate syntax highlighting and NGINX editor configuration.
- Add safe selection formatting and multi-line directive preservation.
- Support unquoted PCRE quantifiers and adjacent quoted token segments.
- Fix standalone `)` argument merging and block braces following header comments.
- Add real TextMate/Oniguruma highlighting tests and formatter regressions.

## 0.1.0

- Add quote-aware NGINX configuration formatting.
- Use the editor's active indentation settings.
- Add optional removal of exact Certbot marker comments.
- Detect `nginx.conf`, `conf.d`, `sites-available`, and `sites-enabled` files.
