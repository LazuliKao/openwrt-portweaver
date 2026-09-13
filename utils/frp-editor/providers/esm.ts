import { MONACO_VERSION, MONACO_YAML_VERSION } from "../constants";
import { createModuleWorker, importRemoteModule } from "../helpers";
import type { MonacoAPI, MonacoJSONDefaults, MonacoYamlModule } from "../types";
import type { MonacoCdnProvider } from "./types";

// esm.sh's yaml.worker wrapper initializes Monaco's generic worker before the
// YAML service. Load its dependency-pinned bundle directly instead.
const ESM_YAML_WORKER_URL = `https://esm.sh/monaco-yaml@${MONACO_YAML_VERSION}/X-ZG1vbmFjby1lZGl0b3JAMC41Ni4w/es2022/yaml.worker.bundle.mjs`;

export const esmProvider: MonacoCdnProvider = {
  id: "esm",
  label: "esm.sh",

  getStyleUrl(): string {
    return `https://esm.sh/monaco-editor@${MONACO_VERSION}/min/vs/editor/editor.main.css`;
  },

  loadModule(): Promise<
    MonacoAPI & {
      json?: { jsonDefaults: MonacoJSONDefaults };
      languages?: { json?: { jsonDefaults: MonacoJSONDefaults } };
    }
  > {
    return importRemoteModule(
      `https://esm.sh/monaco-editor@${MONACO_VERSION}?bundle`,
    );
  },

  createEditorWorker(): Worker {
    return createModuleWorker(
      `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/editor/editor.worker.js`,
    );
  },

  createJsonWorker(): Worker {
    return createModuleWorker(
      `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/language/json/json.worker.js`,
    );
  },

  createYamlWorker(): Worker {
    return createModuleWorker(ESM_YAML_WORKER_URL);
  },

  loadYamlModule(): Promise<MonacoYamlModule> {
    return importRemoteModule(
      `https://esm.sh/monaco-yaml@${MONACO_YAML_VERSION}?bundle&deps=monaco-editor@${MONACO_VERSION}`,
    );
  },
};
