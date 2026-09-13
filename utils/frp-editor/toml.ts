import type { MonacoAPI } from "./types";

let registered = false;

export function registerTomlLanguage(monaco: MonacoAPI): void {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: "toml" });
  monaco.languages.setMonarchTokensProvider("toml", {
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
