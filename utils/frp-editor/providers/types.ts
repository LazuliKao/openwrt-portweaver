import type { MonacoAPI, MonacoJSONDefaults, MonacoYamlModule } from "../types";

export interface MonacoCdnProvider {
  /** Unique provider identifier for persistence and selection */
  readonly id: string;
  /** UI display name */
  readonly label: string;
  /** Whether this provider is enabled */
  readonly enabled?: boolean;

  /** URL to the Monaco CSS stylesheet */
  getStyleUrl(): string;

  /** Dynamically import the Monaco API module */
  loadModule(): Promise<
    MonacoAPI & {
      json?: { jsonDefaults: MonacoJSONDefaults };
      languages?: { json?: { jsonDefaults: MonacoJSONDefaults } };
    }
  >;

  /** Optional external loader for JSON defaults if not bundled in the main module */
  loadJsonDefaults?(): Promise<MonacoJSONDefaults | undefined>;

  /** Factory for the general editor worker */
  createEditorWorker(): Worker | Promise<Worker>;

  /** Factory for the JSON language worker */
  createJsonWorker(): Worker | Promise<Worker>;

  /** Factory for the YAML language worker */
  createYamlWorker(): Worker | Promise<Worker>;

  /** Dynamically load the monaco-yaml language service module */
  loadYamlModule(): Promise<MonacoYamlModule>;

  /** Optional external loader for YAML Monarch syntax highlighting from upstream */
  loadYamlSyntax?(): Promise<
    { conf?: unknown; language?: unknown } | undefined
  >;
}
