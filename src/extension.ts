import * as vscode from "vscode";

import {
  formatNginx,
  formatNginxRange,
  type NginxFormatOptions,
} from "./formatter";

const NGINX_SELECTORS: vscode.DocumentSelector = [
  { language: "nginx" },
  { language: "NGINX" },
];

export function activate(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentFormattingEditProvider &
    vscode.DocumentRangeFormattingEditProvider = {
    provideDocumentFormattingEdits(document, options, cancellationToken) {
      if (cancellationToken.isCancellationRequested) {
        return [];
      }

      const source = document.getText();
      const formatted = formatNginx(
        source,
        getFormatOptions(document, options),
      );

      if (formatted === source || cancellationToken.isCancellationRequested) {
        return [];
      }

      const documentRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(source.length),
      );
      return [
        createMinimalEdit(document, documentRange, source, formatted),
      ];
    },

    provideDocumentRangeFormattingEdits(
      document,
      range,
      options,
      cancellationToken,
    ) {
      if (cancellationToken.isCancellationRequested) {
        return [];
      }

      const expandedRange = expandToWholeLines(document, range);
      const source = document.getText(expandedRange);
      const formatted = formatNginxRange(
        source,
        getFormatOptions(document, options),
      );

      if (formatted === source || cancellationToken.isCancellationRequested) {
        return [];
      }

      return [
        createMinimalEdit(document, expandedRange, source, formatted),
      ];
    },
  };

  const documentProvider = vscode.languages.registerDocumentFormattingEditProvider(
    NGINX_SELECTORS,
    provider,
  );
  const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    NGINX_SELECTORS,
    provider,
  );

  context.subscriptions.push(documentProvider, rangeProvider);
}

export function deactivate(): void {}

function createMinimalEdit(
  document: vscode.TextDocument,
  replacementRange: vscode.Range,
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

  const replacementOffset = document.offsetAt(replacementRange.start);
  return vscode.TextEdit.replace(
    new vscode.Range(
      document.positionAt(replacementOffset + start),
      document.positionAt(replacementOffset + sourceEnd),
    ),
    formatted.slice(start, formattedEnd),
  );
}

function getFormatOptions(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
): NginxFormatOptions {
  const indentation = options.insertSpaces
    ? " ".repeat(Math.max(1, options.tabSize))
    : "\t";
  const configuration = vscode.workspace.getConfiguration(
    "nginxBeautifier",
    document,
  );

  return {
    indentation,
    eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    removeCertbotComments: configuration.get<boolean>(
      "removeCertbotComments",
      false,
    ),
    preserveDirectiveLineBreaks: configuration.get<boolean>(
      "preserveDirectiveLineBreaks",
      true,
    ),
  };
}

function expandToWholeLines(
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range {
  const startLine = range.start.line;
  const endLine =
    range.end.character === 0 && range.end.line > startLine
      ? range.end.line - 1
      : range.end.line;

  return new vscode.Range(
    document.lineAt(startLine).range.start,
    document.lineAt(endLine).range.end,
  );
}
