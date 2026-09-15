import { SCHEMA_URLS } from "./constants";
import type {
  FrpEditorKind,
  LoadedMonaco,
  MonacoAPI,
  MonacoGlobal,
  MonacoWithWebWorkerCompatibility,
  MonacoYaml,
} from "./types";

const patchedMonacoApis = new WeakSet<object>();
const registeredSyntaxApis = new WeakSet<object>();
let yamlService: MonacoYaml | undefined;

export async function ensureYamlSyntax(loaded: LoadedMonaco): Promise<void> {
  if (registeredSyntaxApis.has(loaded.monaco)) return;
  registeredSyntaxApis.add(loaded.monaco);

  let syntaxConf:
    | Parameters<typeof loaded.monaco.languages.setLanguageConfiguration>[1]
    | undefined;
  let syntaxLanguage:
    | Parameters<typeof loaded.monaco.languages.setMonarchTokensProvider>[1]
    | undefined;

  if (loaded.loadYamlSyntax) {
    try {
      const syntax = await loaded.loadYamlSyntax();
      if (syntax?.conf) {
        syntaxConf = syntax.conf as typeof syntaxConf;
      }
      if (syntax?.language) {
        syntaxLanguage = syntax.language as typeof syntaxLanguage;
      }
    } catch {
      // Ignore if network fails
    }
  }

  try {
    loaded.monaco.languages.register({
      id: "yaml",
      extensions: [".yaml", ".yml"],
      aliases: ["YAML", "yaml", "YML", "yml"],
      mimetypes: ["application/x-yaml", "text/x-yaml"],
    });
    loaded.monaco.languages.setLanguageConfiguration("yaml", {
      wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
      comments: { lineComment: "#" },
      brackets: [
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      ...syntaxConf,
    });
    if (syntaxLanguage) {
      loaded.monaco.languages.setMonarchTokensProvider("yaml", syntaxLanguage);
    }
  } catch {
    // Ignore if already registered
  }
}

export function installYamlWorkerCompatibility(monaco: MonacoAPI): void {
  if (patchedMonacoApis.has(monaco)) return;
  patchedMonacoApis.add(monaco);

  const api = monaco as unknown as MonacoWithWebWorkerCompatibility;
  const legacyCreateWebWorker = api.editor.createWebWorker;
  const getWorker = (globalThis as MonacoGlobal).MonacoEnvironment?.getWorker;
  if (!legacyCreateWebWorker || !getWorker) return;

  // monaco-worker-manager still uses Monaco's pre-0.53 worker descriptor.
  // Convert that descriptor into a real worker before calling Monaco 0.56.
  api.editor.createWebWorker = (options) => {
    if ("worker" in options) return legacyCreateWebWorker(options);

    const worker = Promise.resolve(
      getWorker(options.moduleId ?? "workerMain.js", options.label ?? "yaml"),
    ).then((instance) => {
      instance.postMessage("ignore");
      instance.postMessage(options.createData);
      return instance;
    });
    return legacyCreateWebWorker({ ...options, worker });
  };
}

export async function configureYaml(
  loaded: LoadedMonaco,
  schemas: Map<FrpEditorKind, Record<string, unknown>>,
): Promise<void> {
  await ensureYamlSyntax(loaded);

  const schemasForYaml = [...schemas.entries()].map(([kind, schema]) => ({
    fileMatch: ["*"],
    schema,
    uri: SCHEMA_URLS[kind],
  }));
  const options = {
    completion: true,
    enableSchemaRequest: false,
    format: { enable: true },
    hover: true,
    schemas: schemasForYaml,
    validate: true,
    yamlVersion: "1.2" as const,
  };
  if (yamlService) {
    await yamlService.update(options);
  } else {
    installYamlWorkerCompatibility(loaded.monaco);
    const yamlModule = await loaded.loadYamlModule();
    yamlService = yamlModule.configureMonacoYaml(loaded.monaco, options);
  }
}
