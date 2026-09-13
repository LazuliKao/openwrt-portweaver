import {
  MONACO_CDN_TIMEOUT,
  MONACO_ESM_VERSION,
  MONACO_YAML_VERSION,
} from "../constants";
import {
  createModuleWorker,
  createModuleWorkerFromSource,
  importRemoteModule,
  withTimeout,
} from "../helpers";
import type { MonacoJSONDefaults } from "../types";
import type { MonacoCdnProvider } from "./types";

export function createJsdelivrYamlWorker(
  editorWorkerUrl: string,
  sourceUrl: string,
  name: string,
): Promise<Worker> {
  return withTimeout(
    fetch(sourceUrl)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Unable to load YAML worker from ${name}.`);
        return response.text();
      })
      .then((source) => {
        const workerManagerBridge = `data:text/javascript;charset=utf-8,${encodeURIComponent(
          `import { initialize as initializeEditorWorker } from ${JSON.stringify(editorWorkerUrl)}; export function initialize(create) { self.onmessage = () => { initializeEditorWorker((ctx, createData) => Object.create(create(ctx, createData))); }; }`,
        )}`;
        const withPinnedWorker = source.replace(
          /(from\s*["'])\/npm\/monaco-worker-manager@[^"']+\/worker\/\+esm(["'])/,
          `$1${workerManagerBridge}$2`,
        );
        if (withPinnedWorker === source)
          throw new Error("jsDelivr YAML worker dependency was not found.");

        const origin = new URL(sourceUrl).origin;
        const workerSource = withPinnedWorker.replace(
          /(["'])\/(npm|node)\//g,
          `$1${origin}/$2/`,
        );
        return createModuleWorkerFromSource(workerSource);
      }),
    MONACO_CDN_TIMEOUT,
  );
}

function createJsdelivrProvider(
  id: string,
  label: string,
  baseUrl: string,
): MonacoCdnProvider {
  const editorWorkerUrl = `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`;
  const jsonWorkerUrl = `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`;
  const yamlWorkerSourceUrl = `${baseUrl}/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js/+esm`;

  return {
    id,
    label,
    getStyleUrl(): string {
      return `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/min/vs/editor/editor.main.css`;
    },
    loadModule() {
      return importRemoteModule(
        `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.api.js`,
      );
    },
    loadJsonDefaults(): Promise<MonacoJSONDefaults> {
      const jsonModuleUrl = `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/register.js`;
      const jsonModeUrl = `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/jsonMode.js`;
      return Promise.all([
        importRemoteModule<{ jsonDefaults: MonacoJSONDefaults }>(jsonModuleUrl),
        importRemoteModule<{
          setupMode?: (defaults: MonacoJSONDefaults) => void;
        }>(jsonModeUrl),
      ]).then(([json, mode]) => {
        mode?.setupMode?.(json.jsonDefaults);
        return json.jsonDefaults;
      });
    },
    createEditorWorker() {
      return createModuleWorker(editorWorkerUrl);
    },
    createJsonWorker() {
      return createModuleWorker(jsonWorkerUrl);
    },
    createYamlWorker() {
      return createJsdelivrYamlWorker(
        editorWorkerUrl,
        yamlWorkerSourceUrl,
        label,
      );
    },
    loadYamlModule() {
      return importRemoteModule(
        `${baseUrl}/monaco-yaml@${MONACO_YAML_VERSION}/+esm`,
      );
    },
    loadYamlSyntax() {
      return importRemoteModule<{ conf?: unknown; language?: unknown }>(
        `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/definitions/yaml/yaml.js`,
      );
    },
  };
}

export const jsdelivrProvider = createJsdelivrProvider(
  "jsdelivr",
  "jsDelivr",
  "https://cdn.jsdelivr.net/npm",
);

export const fastlyProvider = createJsdelivrProvider(
  "fastly",
  "jsDelivr (Fastly)",
  "https://fastly.jsdelivr.net/npm",
);

export const gcoreProvider = createJsdelivrProvider(
  "gcore",
  "jsDelivr (Gcore)",
  "https://gcore.jsdelivr.net/npm",
);
