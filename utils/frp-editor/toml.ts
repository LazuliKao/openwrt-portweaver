import type { MonacoAPI } from "./types";

const registeredLanguages = new Set<string>();

export function registerSchemaCompletions(
  monaco: MonacoAPI,
  language: "toml",
  schema: Record<string, unknown>,
): void {
  const registration = `${language}:${String(schema.$id || "frp")}`;
  if (registeredLanguages.has(registration)) return;
  registeredLanguages.add(registration);

  if (!registeredLanguages.has(language)) {
    registeredLanguages.add(language);
    monaco.languages.register({ id: language });
    monaco.languages.setMonarchTokensProvider(language, {
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/, "string"],
          [/\b(?:true|false)\b/, "keyword"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
          [/[A-Za-z_][\w-]*(?=\s*(?:=|:))/, "type"],
        ],
      },
    });
  }

  const properties = (schema.properties || {}) as Record<
    string,
    { description?: string; default?: unknown }
  >;
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", "-"],
    provideCompletionItems: (_model, position) => ({
      suggestions: Object.entries(properties).map(([name, property]) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: property.description || "FRP configuration option",
        insertText:
          language === "toml"
            ? `${name} = ${JSON.stringify(property.default ?? "")}`
            : `${name}: ${JSON.stringify(property.default ?? "")}`,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column,
        },
      })),
    }),
  });
}
