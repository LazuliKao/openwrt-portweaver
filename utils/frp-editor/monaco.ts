import type * as Monaco from "monaco-editor";
import {
  MONACO_CDN_TIMEOUT,
  SCHEMA_CANDIDATE_URLS,
  SCHEMA_URLS,
} from "./constants";
import { loadStylesheet, prefersDarkTheme, withTimeout } from "./helpers";
import {
  getProvider,
  MONACO_SOURCE_OPTIONS,
  type MonacoCdnProvider,
  type MonacoSource,
} from "./providers";
import { attachTaplo } from "./taplo";
import { registerTomlLanguage } from "./toml";
import type {
  FrpEditorFormat,
  FrpEditorKind,
  LoadedMonaco,
  MonacoGlobal,
  MonacoTextEditor,
  MonacoWorkerFactory,
} from "./types";
import { configureYaml } from "./yaml";

export type { FrpEditorFormat, FrpEditorKind, MonacoSource, MonacoTextEditor };
export { MONACO_SOURCE_OPTIONS };

const monacoPromises = new Map<string, Promise<LoadedMonaco>>();
const schemas = new Map<FrpEditorKind, Record<string, unknown>>();
let nextModelId = 1;
const schemaPromises = new Map<
  FrpEditorKind,
  Promise<Record<string, unknown> | undefined>
>();

function configureWorkers(
  createEditorWorker: MonacoWorkerFactory,
  createJsonWorker: MonacoWorkerFactory,
  createYamlWorker: MonacoWorkerFactory,
): void {
  const runtime = globalThis as MonacoGlobal;
  const previousEnvironment = runtime.MonacoEnvironment;
  runtime.MonacoEnvironment = {
    ...previousEnvironment,
    getWorker(moduleId, label) {
      // monaco-yaml requires its own language-service worker. Some remote
      // Monaco bundles install a generic worker handler, so route YAML first.
      if (label === "yaml" || moduleId === "monaco-yaml/yaml.worker")
        return createYamlWorker();
      if (previousEnvironment?.getWorker)
        return previousEnvironment.getWorker(moduleId, label);
      return (label === "json" ? createJsonWorker : createEditorWorker)();
    },
  };
}

function loadProvider(provider: MonacoCdnProvider): Promise<LoadedMonaco> {
  // Monaco reads its worker environment during module initialization. Install
  // the selected factories before importing it so monaco-yaml gets its worker.
  configureWorkers(
    () => provider.createEditorWorker(),
    () => provider.createJsonWorker(),
    () => provider.createYamlWorker(),
  );

  const stylesheet = loadStylesheet(provider.getStyleUrl());
  const module = provider.loadModule();
  const jsonDefaults = provider.loadJsonDefaults
    ? provider.loadJsonDefaults().then((defaults) => {
        if (!defaults) throw new Error("Monaco JSON support is unavailable.");
        return defaults;
      })
    : module.then((monaco) => {
        const defaults =
          monaco.languages?.json?.jsonDefaults ?? monaco.json?.jsonDefaults;
        if (!defaults) throw new Error("Monaco JSON support is unavailable.");
        return defaults;
      });

  let yamlModulePromise:
    | ReturnType<MonacoCdnProvider["loadYamlModule"]>
    | undefined;

  const loadYamlSyntax = provider.loadYamlSyntax;
  const resources = Promise.all([module, jsonDefaults, stylesheet]).then(
    ([monaco, defaults, style]) => ({
      monaco,
      jsonDefaults: defaults,
      createEditorWorker: () => provider.createEditorWorker(),
      createJsonWorker: () => provider.createJsonWorker(),
      createYamlWorker: () => provider.createYamlWorker(),
      loadYamlModule: () => {
        yamlModulePromise ??= withTimeout(
          provider.loadYamlModule(),
          MONACO_CDN_TIMEOUT,
        );
        return yamlModulePromise;
      },
      loadYamlSyntax: loadYamlSyntax ? () => loadYamlSyntax() : undefined,
      style,
    }),
  );

  return withTimeout(resources, MONACO_CDN_TIMEOUT).catch((error: unknown) => {
    void stylesheet.then(
      (style) => style.remove(),
      () => undefined,
    );
    throw new Error(`Unable to load Monaco from ${provider.label}.`, {
      cause: error,
    });
  });
}

function loadMonaco(source = "esm"): Promise<LoadedMonaco> {
  const existing = monacoPromises.get(source);
  if (existing) return existing;

  const provider = getProvider(source);
  if (!provider) {
    return Promise.reject(new Error(`Unknown Monaco source: ${source}.`));
  }

  const promise = loadProvider(provider);
  monacoPromises.set(source, promise);
  void promise.catch(() => {
    if (monacoPromises.get(source) === promise) monacoPromises.delete(source);
  });
  return promise;
}

function loadSchema(
  kind: FrpEditorKind,
): Promise<Record<string, unknown> | undefined> {
  const existing = schemaPromises.get(kind);
  if (existing) return existing;

  const candidateUrls = SCHEMA_CANDIDATE_URLS[kind] ?? [SCHEMA_URLS[kind]];
  const promise = (async () => {
    for (const url of candidateUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const schema = (await response.json()) as Record<string, unknown>;
          schemas.set(kind, schema);
          return schema;
        }
      } catch {
        // Try next candidate mirror
      }
    }
    return undefined;
  })();

  schemaPromises.set(kind, promise);
  return promise;
}

function shouldAutoTriggerSuggest(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): boolean {
  const lineContent = model.getLineContent(position.lineNumber);
  const textBeforeCursor = lineContent.slice(0, position.column - 1);
  const trimmed = textBeforeCursor.trim();

  // 1. Empty line or indentation only (e.g. after Enter)
  if (trimmed.length === 0) return true;

  // 2. YAML list item slot: e.g. "  - " or "-"
  if (/^\s*-\s*$/.test(textBeforeCursor)) return true;

  // 3. Key-value separator with trailing space: e.g. "type: " or "name: " or "key = "
  if (/:\s+$/.test(textBeforeCursor) || /=\s*$/.test(textBeforeCursor))
    return true;

  // 4. Structural openings: e.g. "[", "{", "[["
  if (/[[{]\s*$/.test(textBeforeCursor)) return true;

  return false;
}

export async function createFrpConfigEditor(
  container: HTMLElement,
  initialValue: () => string,
  onChange: (value: string) => void,
  kind: FrpEditorKind,
  format: FrpEditorFormat,
  source = "esm",
): Promise<MonacoTextEditor> {
  const [loaded, schema] = await Promise.all([
    loadMonaco(source),
    loadSchema(kind),
  ]);
  const { monaco, jsonDefaults } = loaded;
  const uri =
    format === "toml"
      ? monaco.Uri.parse(`file:///workspace/${kind}-${nextModelId++}.toml`)
      : monaco.Uri.parse(
          `inmemory://portweaver/${kind}-${nextModelId++}.${format}`,
        );

  if (format === "json") {
    jsonDefaults.setDiagnosticsOptions({
      allowComments: false,
      enableSchemaRequest: false,
      schemas: schema
        ? [...schemas.entries()].map(([schemaKind, value]) => ({
            fileMatch: ["*"],
            schema: value,
            uri: SCHEMA_URLS[schemaKind],
          }))
        : [],
      validate: true,
    });
  } else if (format === "yaml") {
    await configureYaml(loaded, schemas);
  } else {
    registerTomlLanguage(monaco);
  }

  const model = monaco.editor.createModel(initialValue(), format, uri);
  const taplo =
    format === "toml"
      ? await attachTaplo(monaco, model, SCHEMA_URLS[kind], schema)
      : undefined;
  monaco.editor.setTheme(prefersDarkTheme() ? "vs-dark" : "vs");
  const editor = monaco.editor.create(container, {
    acceptSuggestionOnEnter: "smart",
    automaticLayout: true,
    minimap: { enabled: false },
    model,
    quickSuggestions: {
      comments: "on",
      other: "on",
      strings: "on",
    },
    quickSuggestionsDelay: 0,
    scrollBeyondLastLine: false,
    suggest: {
      filterGraceful: true,
      localityBonus: true,
      preview: true,
      shareSuggestSelections: true,
      showFields: true,
      showKeywords: true,
      showProperties: true,
      showSnippets: true,
      showValues: true,
      showWords: true,
    },
    suggestOnTriggerCharacters: true,
    suggestSelection: "first",
    tabCompletion: "on",
    tabSize: 2,
    wordBasedSuggestions: "allDocuments",
    wordWrap: "on",
  });

  let suggestTimeout: number | undefined;
  const listener = model.onDidChangeContent((e) => {
    onChange(model.getValue());
    if (e.isUndoing || e.isRedoing || e.isFlush) return;

    if (suggestTimeout) clearTimeout(suggestTimeout);
    suggestTimeout = window.setTimeout(() => {
      const position = editor.getPosition();
      if (position && shouldAutoTriggerSuggest(model, position)) {
        editor.trigger("keyboard", "editor.action.triggerSuggest", {});
      }
    }, 25);
  });

  const keydownDisposable = editor.onKeyDown((e) => {
    if (e.keyCode === monaco.KeyCode.Enter) {
      if (suggestTimeout) clearTimeout(suggestTimeout);
      suggestTimeout = window.setTimeout(() => {
        const position = editor.getPosition();
        if (position && shouldAutoTriggerSuggest(model, position)) {
          editor.trigger("keyboard", "editor.action.triggerSuggest", {});
        }
      }, 30);
    }
  });

  // Ensure focused elements in Monaco (such as .native-edit-context) satisfy Vimium's isEditable check
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      !target.isContentEditable &&
      target.tagName !== "TEXTAREA" &&
      target.tagName !== "INPUT"
    ) {
      target.setAttribute("contenteditable", "true");
    }
  };
  container.addEventListener("focusin", onFocusIn);

  return {
    getValue: () => model.getValue(),
    setValue: (value) => model.setValue(value),
    focus: () => editor.focus(),
    dispose: () => {
      container.removeEventListener("focusin", onFocusIn);
      if (suggestTimeout) clearTimeout(suggestTimeout);
      listener.dispose();
      keydownDisposable.dispose();
      taplo?.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
