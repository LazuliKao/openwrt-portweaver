export type FrpEditorKind = "frpc" | "frps";
export type FrpEditorFormat = "toml" | "yaml" | "json";

export type MonacoTextEditor = {
  getValue(): string;
  setValue(value: string): void;
  dispose(): void;
};

type MonacoModel = {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeContent(listener: () => void): { dispose(): void };
  dispose(): void;
};

type MonacoApi = {
  Uri: { parse(value: string): unknown };
  editor: {
    createModel(value: string, language: string, uri: unknown): MonacoModel;
    create(
      container: HTMLElement,
      options: Record<string, unknown>,
    ): {
      dispose(): void;
    };
    setTheme(theme: string): void;
  };
  languages: {
    register(language: { id: string }): void;
    setMonarchTokensProvider(language: string, provider: object): void;
    registerCompletionItemProvider(
      language: string,
      provider: {
        triggerCharacters?: string[];
        provideCompletionItems: () => { suggestions: object[] };
      },
    ): void;
    CompletionItemKind: { Property: number };
    CompletionItemInsertTextRule: { InsertAsSnippet: number };
  };
  json?: {
    jsonDefaults: {
      setDiagnosticsOptions(options: Record<string, unknown>): void;
    };
  };
};

const MONACO_VERSION = "0.56.0";
const LOAD_TIMEOUT_MS = 15_000;
const SCHEMA_COMMIT = "bf8926da67eb09d5508e3403e3d538a90e66e739";
const SCHEMA_URLS: Record<FrpEditorKind, string> = {
  frpc: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frpc-schema.json`,
  frps: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frps-schema.json`,
};

let monacoPromise: Promise<MonacoApi> | undefined;
const schemas = new Map<FrpEditorKind, Record<string, unknown>>();
const registeredLanguages = new Set<string>();

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Advanced editor loading timed out.")),
      LOAD_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function importRemote<T>(url: string): Promise<T> {
  const dynamicImport = Function("url", "return import(url);") as (
    moduleUrl: string,
  ) => Promise<T>;
  return dynamicImport(url);
}

function createWorker(url: string): Worker {
  const blob = new Blob([`import ${JSON.stringify(url)};`], {
    type: "application/javascript",
  });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return new Worker(blobUrl, { type: "module" });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadStyle(): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://esm.sh/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error("Unable to load advanced editor styles."));
    };
    document.head.appendChild(link);
  });
}

function loadMonaco(): Promise<MonacoApi> {
  if (monacoPromise) return monacoPromise;

  const promise = withTimeout(
    Promise.all([
      importRemote<MonacoApi>(
        `https://esm.sh/monaco-editor@${MONACO_VERSION}?bundle`,
      ),
      loadStyle(),
    ]).then(([monaco]) => {
      const runtime = globalThis as typeof globalThis & {
        MonacoEnvironment?: {
          getWorker?: (_moduleId: string, label: string) => Worker;
        };
      };
      runtime.MonacoEnvironment = {
        ...runtime.MonacoEnvironment,
        getWorker: (_moduleId, label) =>
          createWorker(
            label === "json"
              ? `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/language/json/json.worker.js`
              : `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/editor/editor.worker.js`,
          ),
      };
      return monaco;
    }),
  );
  monacoPromise = promise;
  void promise.catch(() => {
    if (monacoPromise === promise) monacoPromise = undefined;
  });
  return promise;
}

function loadSchema(kind: FrpEditorKind): Promise<Record<string, unknown>> {
  const existing = schemas.get(kind);
  if (existing) return Promise.resolve(existing);
  return fetch(SCHEMA_URLS[kind])
    .then((response) => {
      if (!response.ok) throw new Error("Unable to load the FRP schema.");
      return response.json() as Promise<Record<string, unknown>>;
    })
    .then((schema) => {
      schemas.set(kind, schema);
      return schema;
    });
}

function registerSchemaCompletions(
  monaco: MonacoApi,
  language: "yaml" | "toml",
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
    provideCompletionItems: () => ({
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
      })),
    }),
  });
}

function prefersDarkTheme(): boolean {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function createFrpConfigEditor(
  container: HTMLElement,
  initialValue: () => string,
  onChange: (value: string) => void,
  kind: FrpEditorKind,
  format: FrpEditorFormat,
): Promise<MonacoTextEditor> {
  const [monaco, schema] = await Promise.all([loadMonaco(), loadSchema(kind)]);
  const uri = monaco.Uri.parse(`inmemory://portweaver/${kind}.${format}`);

  if (format === "json" && monaco.json) {
    monaco.json.jsonDefaults.setDiagnosticsOptions({
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [...schemas.entries()].map(([schemaKind, value]) => ({
        uri: SCHEMA_URLS[schemaKind],
        fileMatch: [`inmemory://portweaver/${schemaKind}.json`],
        schema: value,
      })),
      validate: true,
    });
  } else if (format !== "json") {
    registerSchemaCompletions(monaco, format, schema);
  }

  const model = monaco.editor.createModel(initialValue(), format, uri);
  monaco.editor.setTheme(prefersDarkTheme() ? "vs-dark" : "vs");
  const editor = monaco.editor.create(container, {
    automaticLayout: true,
    minimap: { enabled: false },
    model,
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: "on",
  });
  const listener = model.onDidChangeContent(() => onChange(model.getValue()));

  return {
    getValue: () => model.getValue(),
    setValue: (value) => model.setValue(value),
    dispose: () => {
      listener.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
