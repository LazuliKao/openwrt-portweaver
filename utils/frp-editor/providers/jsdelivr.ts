import {
  MONACO_CDN_TIMEOUT,
  MONACO_ESM_VERSION,
  MONACO_VERSION,
  MONACO_YAML_VERSION,
} from "../constants";
import {
  createModuleWorker,
  createModuleWorkerFromSource,
  importRemoteModule,
  withTimeout,
} from "../helpers";
import type { MonacoCdnProvider } from "./types";

function createJsdelivrYamlWorker(
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

        // jsDelivr's transformed module uses root-relative imports. A blob
        // worker has the LuCI origin, so make those imports point back to the
        // selected jsDelivr endpoint before starting it.
        const origin = sourceUrl.startsWith("https://esm.run")
          ? "https://cdn.jsdelivr.net"
          : new URL(sourceUrl).origin;
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
  const isEsmRun = id === "esmrun";
  const editorWorkerUrl = isEsmRun
    ? `https://cdn.jsdelivr.net/npm/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`
    : `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`;
  const jsonWorkerUrl = isEsmRun
    ? `https://cdn.jsdelivr.net/npm/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`
    : `${baseUrl}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`;
  const yamlWorkerSourceUrl = isEsmRun
    ? `https://cdn.jsdelivr.net/npm/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js/+esm`
    : `${baseUrl}/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js/+esm`;

  return {
    id,
    label,
    getStyleUrl(): string {
      return isEsmRun
        ? `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`
        : `${baseUrl}/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`;
    },
    loadModule() {
      return importRemoteModule(
        isEsmRun
          ? `https://esm.run/monaco-editor@${MONACO_VERSION}`
          : `${baseUrl}/monaco-editor@${MONACO_VERSION}/+esm`,
      );
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
        isEsmRun
          ? `https://esm.run/monaco-yaml@${MONACO_YAML_VERSION}`
          : `${baseUrl}/monaco-yaml@${MONACO_YAML_VERSION}/+esm`,
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

export const esmrunProvider = createJsdelivrProvider(
  "esmrun",
  "esm.run",
  "https://esm.run",
);
