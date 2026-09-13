import { MONACO_CDN_TIMEOUT, SCHEMA_URLS } from "./constants";
import { loadStylesheet, prefersDarkTheme, withTimeout } from "./helpers";
import {
  getProvider,
  MONACO_SOURCE_OPTIONS,
  type MonacoCdnProvider,
  type MonacoSource,
} from "./providers";
import { registerSchemaCompletions } from "./toml";
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

let monacoPromise: Promise<LoadedMonaco> | undefined;
const schemas = new Map<FrpEditorKind, Record<string, unknown>>();
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
  if (monacoPromise) return monacoPromise;

  const provider = getProvider(source);
  if (!provider) {
    return Promise.reject(new Error(`Unknown Monaco source: ${source}.`));
  }

  const promise = loadProvider(provider);
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
  } else if (format === "yaml") {
    await configureYaml(loaded, schemas);
  } else if (schema) {
    registerSchemaCompletions(monaco, "toml", schema);
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
