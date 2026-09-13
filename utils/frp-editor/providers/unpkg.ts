import {
  MONACO_ESM_VERSION,
  MONACO_VERSION,
  MONACO_YAML_VERSION,
} from "../constants";
import { createModuleWorker, importRemoteModule } from "../helpers";
import type { MonacoJSONDefaults } from "../types";
import type { MonacoCdnProvider } from "./types";

export const esmUnpkgProvider: MonacoCdnProvider = {
  id: "esm-unpkg",
  label: "esm.unpkg.com",

  getStyleUrl(): string {
    return `https://esm.unpkg.com/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`;
  },

  loadModule() {
    return importRemoteModule(
      `https://esm.unpkg.com/monaco-editor@${MONACO_VERSION}`,
    );
  },

  createEditorWorker(): Worker {
    return createModuleWorker(
      `https://esm.unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`,
    );
  },

  createJsonWorker(): Worker {
    return createModuleWorker(
      `https://esm.unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`,
    );
  },

  createYamlWorker(): Worker {
    return createModuleWorker(
      `https://esm.unpkg.com/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js`,
    );
  },

  loadYamlModule() {
    return importRemoteModule(
      `https://esm.unpkg.com/monaco-yaml@${MONACO_YAML_VERSION}`,
    );
  },
};

export const unpkgProvider: MonacoCdnProvider = {
  id: "unpkg",
  label: "unpkg",

  getStyleUrl(): string {
    return `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/min/vs/editor/editor.main.css`;
  },

  loadModule() {
    return importRemoteModule(
      `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.api.js`,
    );
  },

  loadJsonDefaults(): Promise<MonacoJSONDefaults> {
    const jsonModuleUrl = `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/register.js`;
    const jsonModeUrl = `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/features/json/jsonMode.js`;
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

  createEditorWorker(): Worker {
    return createModuleWorker(
      `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/editor.worker.js`,
    );
  },

  createJsonWorker(): Worker {
    return createModuleWorker(
      `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/editor/json.worker.js`,
    );
  },

  createYamlWorker(): Worker {
    return createModuleWorker(
      `https://unpkg.com/monaco-yaml@${MONACO_YAML_VERSION}/yaml.worker.js?module`,
    );
  },

  loadYamlModule() {
    return importRemoteModule(
      `https://unpkg.com/monaco-yaml@${MONACO_YAML_VERSION}?module`,
    );
  },

  loadYamlSyntax() {
    return importRemoteModule<{ conf?: unknown; language?: unknown }>(
      `https://unpkg.com/@node-projects/monaco-editor-esm@${MONACO_ESM_VERSION}/esm/vs/languages/definitions/yaml/yaml.js`,
    );
  },
};
