# Changelog

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
