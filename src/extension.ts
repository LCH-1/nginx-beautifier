import * as vscode from "vscode";

import { formatNginx } from "./formatter";

const NGINX_SELECTORS: vscode.DocumentSelector = [
  { language: "nginx" },
  { language: "NGINX" },
  { pattern: "**/nginx.conf" },
  { pattern: "**/conf.d/**/*.conf" },
  { pattern: "**/sites-available/*" },
  { pattern: "**/sites-enabled/*" },
];

export function activate(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    NGINX_SELECTORS,
    {
      provideDocumentFormattingEdits(document, options, cancellationToken) {
        if (cancellationToken.isCancellationRequested) {
          return [];
        }

        const source = document.getText();
        const indentation = options.insertSpaces
          ? " ".repeat(Math.max(1, options.tabSize))
          : "\t";
        const configuration = vscode.workspace.getConfiguration(
          "nginxBeautifier",
          document,
        );
        const formatted = formatNginx(source, {
          indentation,
          eol:
            document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
          removeCertbotComments: configuration.get<boolean>(
            "removeCertbotComments",
            false,
          ),
        });

        if (formatted === source || cancellationToken.isCancellationRequested) {
          return [];
        }

        return [createMinimalEdit(document, source, formatted)];
      },
    },
  );

  context.subscriptions.push(provider);
}

export function deactivate(): void {}

function createMinimalEdit(
  document: vscode.TextDocument,
  source: string,
  formatted: string,
): vscode.TextEdit {
  let start = 0;
  const shortestLength = Math.min(source.length, formatted.length);
  while (start < shortestLength && source[start] === formatted[start]) {
    start += 1;
  }

  let sourceEnd = source.length;
  let formattedEnd = formatted.length;
  while (
    sourceEnd > start &&
    formattedEnd > start &&
    source[sourceEnd - 1] === formatted[formattedEnd - 1]
  ) {
    sourceEnd -= 1;
    formattedEnd -= 1;
  }

  return vscode.TextEdit.replace(
    new vscode.Range(document.positionAt(start), document.positionAt(sourceEnd)),
    formatted.slice(start, formattedEnd),
  );
}
