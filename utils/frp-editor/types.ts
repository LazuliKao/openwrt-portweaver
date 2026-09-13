import type * as Monaco from "monaco-editor";
import type { LanguageServiceDefaults } from "monaco-editor/languages/features/json/register.js";

export type FrpEditorKind = "frpc" | "frps";
export type FrpEditorFormat = "toml" | "yaml" | "json";

export type MonacoAPI = Pick<typeof Monaco, "Uri" | "editor" | "languages">;
export type MonacoJSONDefaults = LanguageServiceDefaults;

export type MonacoWebWorkerOptions = {
  createData?: unknown;
  host?: Record<string, (...args: never[]) => unknown>;
  keepIdleModels?: boolean;
  label?: string;
  moduleId?: string;
  worker?: Worker | Promise<Worker>;
};

export type MonacoWebWorkerFactory = (
  options: MonacoWebWorkerOptions,
) => unknown;

export type MonacoWithWebWorkerCompatibility = {
  editor: {
    createWebWorker?: MonacoWebWorkerFactory;
  };
};

export type MonacoEnvironment = {
  getWorker?: (moduleId: string, label: string) => Worker | Promise<Worker>;
};

export type MonacoWorkerFactory = () => Worker | Promise<Worker>;

export type MonacoYamlOptions = {
  completion: boolean;
  enableSchemaRequest: boolean;
  format: { enable: boolean };
  hover: boolean;
  schemas: Array<{
    fileMatch: string[];
    schema: Record<string, unknown>;
    uri: string;
  }>;
  validate: boolean;
  yamlVersion: "1.2";
};

export type MonacoYaml = {
  update(options: MonacoYamlOptions): Promise<void>;
};

export type MonacoYamlModule = {
  configureMonacoYaml(
    monaco: MonacoAPI,
    options: MonacoYamlOptions,
  ): MonacoYaml;
};

export type LoadedMonaco = {
  monaco: MonacoAPI;
  jsonDefaults: MonacoJSONDefaults;
  createEditorWorker: MonacoWorkerFactory;
  createJsonWorker: MonacoWorkerFactory;
  createYamlWorker: MonacoWorkerFactory;
  loadYamlModule(): Promise<MonacoYamlModule>;
  loadYamlSyntax?(): Promise<
    { conf?: unknown; language?: unknown } | undefined
  >;
  style: HTMLLinkElement;
};

export type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoEnvironment;
};

export type MonacoTextEditor = {
  getValue(): string;
  setValue(value: string): void;
  dispose(): void;
};
