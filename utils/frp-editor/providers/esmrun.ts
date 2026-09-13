import { MONACO_ESM_VERSION, MONACO_YAML_VERSION } from "../constants";
import { createModuleWorker, importRemoteModule } from "../helpers";
import type { MonacoJSONDefaults } from "../types";
import { createJsdelivrYamlWorker } from "./jsdelivr";
import type { MonacoCdnProvider } from "./types";

const BASE_URL = "https://cdn.jsdelivr.net/npm";
const editorWorkerUrl = `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`;
const jsonWorkerUrl = `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`;
const yamlWorkerSourceUrl = `${BASE_URL}/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js/+esm`;

export const esmrunProvider: MonacoCdnProvider = {
  id: "esmrun",
  label: "esm.run",

  getStyleUrl(): string {
    return `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/min/vs/editor/editor.main.css`;
  },

  loadModule() {
    return importRemoteModule(
      `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.api.js`,
    );
  },

  loadJsonDefaults(): Promise<MonacoJSONDefaults> {
    const jsonModuleUrl = `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/register.js`;
    const jsonModeUrl = `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/jsonMode.js`;
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
      "esm.run",
    );
  },

  loadYamlModule() {
    return importRemoteModule(
      `https://esm.run/monaco-yaml@${MONACO_YAML_VERSION}`,
    );
  },

  loadYamlSyntax() {
    return importRemoteModule<{ conf?: unknown; language?: unknown }>(
      `${BASE_URL}/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/definitions/yaml/yaml.js`,
    );
  },
};
