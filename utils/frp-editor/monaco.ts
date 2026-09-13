import type * as Monaco from "monaco-editor";
import type { LanguageServiceDefaults } from "monaco-editor/languages/features/json/register.js";

export type FrpEditorKind = "frpc" | "frps";
export type FrpEditorFormat = "toml" | "yaml" | "json";

const MONACO_VERSION = "0.56.0";
const MONACO_ESM_VERSION = "0.56.1";
const MONACO_CDN_TIMEOUT = 15_000;
const SCHEMA_COMMIT = "bf8926da67eb09d5508e3403e3d538a90e66e739";
const SCHEMA_URLS: Record<FrpEditorKind, string> = {
  frpc: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frpc-schema.json`,
  frps: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frps-schema.json`,
};

type MonacoAPI = Pick<typeof Monaco, "Uri" | "editor" | "languages">;
type MonacoJSONDefaults = LanguageServiceDefaults;

type MonacoEnvironment = {
  getWorker?: (moduleId: string, label: string) => Worker | Promise<Worker>;
};

type MonacoCandidateId = "esm" | "jsdelivr" | "fastly" | "gcore" | "unpkg";

export type MonacoSource = "auto" | MonacoCandidateId;

export const MONACO_SOURCE_OPTIONS: ReadonlyArray<{
  value: MonacoSource;
  label: string;
}> = [
  { value: "auto", label: _("Automatic (test all CDNs and use the fastest)") },
  { value: "esm", label: "esm.sh" },
  { value: "jsdelivr", label: "jsDelivr" },
  { value: "fastly", label: "jsDelivr (Fastly)" },
  { value: "gcore", label: "jsDelivr (Gcore)" },
  { value: "unpkg", label: "unpkg" },
];

type MonacoCandidate = {
  id: MonacoCandidateId;
  name: string;
  moduleUrl: string;
  probeUrls?: string[];
  jsonModuleUrl?: string;
  jsonModeUrl?: string;
  editorWorkerUrl: string;
  jsonWorkerUrl: string;
  styleUrl: string;
};

type MonacoWorkerFactory = () => Worker;

type LoadedMonaco = {
  monaco: MonacoAPI;
  jsonDefaults: MonacoJSONDefaults;
  createEditorWorker: MonacoWorkerFactory;
  createJsonWorker: MonacoWorkerFactory;
  style: HTMLLinkElement;
};

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoEnvironment;
};

export type MonacoTextEditor = {
  getValue(): string;
  setValue(value: string): void;
  dispose(): void;
};

let monacoPromise: Promise<LoadedMonaco> | undefined;
const schemas = new Map<FrpEditorKind, Record<string, unknown>>();
const schemaPromises = new Map<
  FrpEditorKind,
  Promise<Record<string, unknown> | undefined>
>();
const registeredLanguages = new Set<string>();

const MONACO_CANDIDATES: MonacoCandidate[] = [
  {
    id: "esm",
    name: "esm.sh",
    moduleUrl: `https://esm.sh/monaco-editor@${MONACO_VERSION}?bundle`,
    probeUrls: [
      `https://esm.sh/monaco-editor@${MONACO_VERSION}/es2022/monaco-editor.bundle.mjs`,
    ],
    editorWorkerUrl: `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/editor/editor.worker.js`,
    jsonWorkerUrl: `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/language/json/json.worker.js`,
    styleUrl: `https://esm.sh/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`,
  },
  ...[
    [
      "jsdelivr",
      "jsDelivr",
      "https://cdn.jsdelivr.net/npm/@node-projects/monaco-editor-esm",
    ],
    [
      "fastly",
      "jsDelivr (Fastly)",
      "https://fastly.jsdelivr.net/npm/@node-projects/monaco-editor-esm",
    ],
    [
      "gcore",
      "jsDelivr (Gcore)",
      "https://gcore.jsdelivr.net/npm/@node-projects/monaco-editor-esm",
    ],
    ["unpkg", "unpkg", "https://unpkg.com/@node-projects/monaco-editor-esm"],
  ].map(([id, name, baseUrl]) => ({
    id: id as MonacoCandidateId,
    name,
    moduleUrl: `${baseUrl}@${MONACO_ESM_VERSION}/esm/vs/editor/editor.api.js`,
    jsonModuleUrl: `${baseUrl}@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/register.js`,
    jsonModeUrl: `${baseUrl}@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/jsonMode.js`,
    editorWorkerUrl: `${baseUrl}@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`,
    jsonWorkerUrl: `${baseUrl}@${MONACO_ESM_VERSION}/esm/vs/language/json/json.worker.js`,
    styleUrl: `${baseUrl}@${MONACO_ESM_VERSION}/min/vs/editor/editor.main.css`,
  })),
];

function loadStylesheet(url: string): Promise<HTMLLinkElement> {
  return new Promise<HTMLLinkElement>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => resolve(link);
    link.onerror = () => {
      link.remove();
      reject(new Error(`Unable to load Monaco stylesheet from ${url}.`));
    };
    document.head.appendChild(link);
  });
}

function createModuleWorker(url: string): Worker {
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

function configureWorkers(
  createEditorWorker: MonacoWorkerFactory,
  createJsonWorker: MonacoWorkerFactory,
): void {
  const runtime = globalThis as MonacoGlobal;
  const previousEnvironment = runtime.MonacoEnvironment;
  runtime.MonacoEnvironment = {
    ...previousEnvironment,
    getWorker(moduleId, label) {
      if (previousEnvironment?.getWorker)
        return previousEnvironment.getWorker(moduleId, label);
      return (label === "json" ? createJsonWorker : createEditorWorker)();
    },
  };
}

function importRemoteModule<T>(url: string): Promise<T> {
  const dynamicImport = Function("url", "return import(url);") as (
    moduleUrl: string,
  ) => Promise<T>;
  return dynamicImport(url);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Monaco CDN request timed out.")),
      milliseconds,
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

async function measureCandidate(candidate: MonacoCandidate): Promise<number> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    MONACO_CDN_TIMEOUT,
  );
  const startedAt = performance.now();

  try {
    const urls = (
      candidate.probeUrls ?? [
        candidate.moduleUrl,
        candidate.jsonModuleUrl,
        candidate.jsonModeUrl,
      ]
    ).filter((url): url is string => Boolean(url));
    const responses = await Promise.all(
      urls.map((url) => fetch(url, { signal: controller.signal })),
    );
    if (responses.some((response) => !response.ok))
      throw new Error("Monaco CDN probe failed.");
    await Promise.all(responses.map((response) => response.arrayBuffer()));
    return performance.now() - startedAt;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function rankCandidates(): Promise<MonacoCandidate[]> {
  const measurements = await Promise.all(
    MONACO_CANDIDATES.map(async (candidate, index) => {
      try {
        return {
          candidate,
          duration: await measureCandidate(candidate),
          index,
        };
      } catch {
        return {
          candidate,
          duration: Number.POSITIVE_INFINITY,
          index,
        };
      }
    }),
  );

  return measurements
    .sort(
      (left, right) =>
        left.duration - right.duration || left.index - right.index,
    )
    .map(({ candidate }) => candidate);
}

function loadCandidate(candidate: MonacoCandidate): Promise<LoadedMonaco> {
  const stylesheet = loadStylesheet(candidate.styleUrl);
  const module = importRemoteModule<
    MonacoAPI & { json?: { jsonDefaults: MonacoJSONDefaults } }
  >(candidate.moduleUrl);
  const jsonDefaults =
    candidate.jsonModuleUrl && candidate.jsonModeUrl
      ? Promise.all([
          importRemoteModule<{ jsonDefaults: MonacoJSONDefaults }>(
            candidate.jsonModuleUrl,
          ),
          importRemoteModule<unknown>(candidate.jsonModeUrl),
        ]).then(([json]) => json.jsonDefaults)
      : module.then((monaco) => {
          if (!monaco.json?.jsonDefaults)
            throw new Error("Monaco JSON support is unavailable.");
          return monaco.json.jsonDefaults;
        });
  const resources = Promise.all([module, jsonDefaults, stylesheet]).then(
    ([monaco, defaults, style]) => ({
      monaco,
      jsonDefaults: defaults,
      createEditorWorker: () => createModuleWorker(candidate.editorWorkerUrl),
      createJsonWorker: () => createModuleWorker(candidate.jsonWorkerUrl),
      style,
    }),
  );

  return withTimeout(resources, MONACO_CDN_TIMEOUT).catch((error: unknown) => {
    void stylesheet.then(
      (style) => style.remove(),
      () => undefined,
    );
    throw new Error(`Unable to load Monaco from ${candidate.name}.`, {
      cause: error,
    });
  });
}

async function loadCandidates(
  candidates: MonacoCandidate[],
): Promise<LoadedMonaco> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await loadCandidate(candidate);
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to load Monaco from any CDN.");
}

function loadMonaco(source: MonacoSource): Promise<LoadedMonaco> {
  if (monacoPromise) return monacoPromise;

  const candidates =
    source === "auto"
      ? rankCandidates()
      : Promise.resolve(
          MONACO_CANDIDATES.filter((candidate) => candidate.id === source),
        );
  const promise = candidates.then((rankedCandidates) =>
    loadCandidates(rankedCandidates).then((loaded) => {
      configureWorkers(loaded.createEditorWorker, loaded.createJsonWorker);
      return loaded;
    }),
  );

  monacoPromise = promise;
  void promise.catch(() => {
    if (monacoPromise === promise) monacoPromise = undefined;
  });
  return promise;
}

function loadSchema(
  kind: FrpEditorKind,
): Promise<Record<string, unknown> | undefined> {
  const existing = schemaPromises.get(kind);
  if (existing) return existing;

  const promise = fetch(SCHEMA_URLS[kind])
    .then((response) => {
      if (!response.ok) throw new Error("Unable to load the FRP schema.");
      return response.json() as Promise<Record<string, unknown>>;
    })
    .then((schema) => {
      schemas.set(kind, schema);
      return schema;
    })
    .catch(() => undefined);
  schemaPromises.set(kind, promise);
  return promise;
}

function registerSchemaCompletions(
  monaco: MonacoAPI,
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

function backgroundLuminance(element: HTMLElement): number | undefined {
  const color = getComputedStyle(element)
    .backgroundColor.match(/\d+/g)
    ?.map(Number);
  if (!color || color.length < 3 || color[3] === 0) return undefined;
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
}

function prefersDarkTheme(): boolean {
  for (const element of [document.body, document.documentElement]) {
    const luminance = backgroundLuminance(element);
    if (luminance !== undefined) return luminance < 128;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function createFrpConfigEditor(
  container: HTMLElement,
  initialValue: () => string,
  onChange: (value: string) => void,
  kind: FrpEditorKind,
  format: FrpEditorFormat,
  source: MonacoSource = "auto",
): Promise<MonacoTextEditor> {
  const [loaded, schema] = await Promise.all([
    loadMonaco(source),
    loadSchema(kind),
  ]);
  const { monaco, jsonDefaults } = loaded;
  const uri = monaco.Uri.parse(`inmemory://portweaver/${kind}.${format}`);

  if (format === "json") {
    jsonDefaults.setDiagnosticsOptions({
      allowComments: false,
      enableSchemaRequest: false,
      schemas: schema
        ? [...schemas.entries()].map(([schemaKind, value]) => ({
            fileMatch: [`inmemory://portweaver/${schemaKind}.json`],
            schema: value,
            uri: SCHEMA_URLS[schemaKind],
          }))
        : [],
      validate: true,
    });
  } else if (schema) {
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
