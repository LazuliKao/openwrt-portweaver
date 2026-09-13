import type * as Monaco from "monaco-editor";

import type { MonacoAPI } from "./types";

type RpcId = number | string;

type RpcMessage = {
  jsonrpc: "2.0";
  method?: string;
  id?: RpcId;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type WorkerResponse =
  | { type: "ready" }
  | { type: "message"; message: RpcMessage }
  | { type: "error"; message: string };

type LspPosition = { line: number; character: number };

type LspRange = { start: LspPosition; end: LspPosition };

type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
};

type CompletionItem = {
  label: string | { label: string; detail?: string; description?: string };
  detail?: string;
  documentation?: string | { kind?: string; value?: string };
  insertText?: string;
  insertTextFormat?: number;
  kind?: number;
  textEdit?: { newText: string; range: LspRange };
};

type Hover = {
  contents?: Array<string | { kind?: string; value?: string }>;
  range?: LspRange;
};

type DocumentSession = {
  onDiagnostics(diagnostics: LspDiagnostic[]): void;
};

const MARKER_OWNER = "portweaver-taplo";

class TaploClient {
  private readonly worker: Worker;
  private readonly documents = new Map<string, DocumentSession>();
  private readonly pending = new Map<
    RpcId,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextId = 1;
  private ready: Promise<void>;
  private initialized: Promise<void> | undefined;

  constructor() {
    this.worker = new Worker(new URL("./taplo-worker.ts", import.meta.url), {
      name: "portweaver-taplo",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.handleWorkerMessage(event.data);
    this.worker.onerror = () =>
      this.rejectPending(new Error("Taplo worker failed."));
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.sendWorker({ type: "initialize" });
  }

  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;

  private sendWorker(message: unknown): void {
    this.worker.postMessage(message);
  }

  private handleWorkerMessage(response: WorkerResponse): void {
    if (response.type === "ready") {
      this.readyResolve?.();
      return;
    }
    if (response.type === "error") {
      const error = new Error(response.message);
      console.error("[Taplo Worker Error]", response.message);
      this.readyReject?.(error);
      this.rejectPending(error);
      return;
    }
    console.log(
      "[Taplo Worker -> Client]",
      response.message.method || `reply(${response.message.id})`,
      response.message,
    );
    this.handleServerMessage(response.message);
  }

  private configuredResolve: (() => void) | undefined;
  private readonly configured = new Promise<void>((resolve) => {
    this.configuredResolve = resolve;
  });

  private handleServerMessage(message: RpcMessage): void {
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as
        | { uri?: string; diagnostics?: LspDiagnostic[] }
        | undefined;
      if (params?.uri)
        this.documents.get(params.uri)?.onDiagnostics(params.diagnostics ?? []);
      return;
    }

    if (message.id !== undefined && message.method) {
      if (message.method === "workspace/configuration") {
        const params = message.params as { items?: unknown[] } | undefined;
        // Respond with LspConfig-compatible JSON matching the Taplo source
        // (crates/taplo-lsp/src/config.rs). Setting catalogs:[] is CRITICAL:
        // update_configuration holds an exclusive write lock on workspaces
        // while processing this response. If catalogs contains URLs, Taplo
        // fetches them (e.g. schemastore.org) inside the lock, blocking ALL
        // other handlers (completion, hover, didOpen) until the HTTP request
        // finishes — causing the timeout.
        this.notify({
          jsonrpc: "2.0",
          id: message.id,
          result: (params?.items ?? []).map(() => ({
            taplo: { configFile: { enabled: false } },
            schema: {
              enabled: true,
              catalogs: [],
              links: false,
            },
            completion: { maxKeys: 10 },
          })),
        });
        this.configuredResolve?.();
        return;
      }

      // Taplo can request optional client capabilities. This editor has no
      // workspace, so acknowledge unsupported requests instead of stalling it.
      this.notify({ jsonrpc: "2.0", id: message.id, result: null });
      return;
    }

    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(message.error.message || "Taplo request failed."),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private notify(message: RpcMessage): void {
    console.log(
      "[Taplo Client -> Worker]",
      message.method || `reply(${message.id})`,
      message,
    );
    this.sendWorker({ type: "send", message });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs = 5000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(null);
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.notify({ jsonrpc: "2.0", id, method, params });
    });
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.ready.then(async () => {
      await this.request("initialize", {
        processId: null,
        rootUri: null,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: true } },
            hover: { contentFormat: ["markdown", "plaintext"] },
          },
        },
        // Match the official VS Code extension (editors/vscode/src/client.ts).
        // configurationSection tells Taplo which section name to use when
        // querying workspace/configuration.
        initializationOptions: {
          configurationSection: "evenBetterToml",
        },
      });
      this.notify({ jsonrpc: "2.0", method: "initialized", params: {} });
      // Wait for Taplo's update_configuration handshake to complete,
      // ensuring its workspaces write lock is fully released before opening documents.
      await Promise.race([
        this.configured,
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    return this.initialized;
  }

  setSchemas(schemas: Record<string, unknown>): void {
    this.sendWorker({ type: "setSchemas", schemas });
  }

  async openDocument(
    uri: string,
    schemaUrl: string,
    schema: Record<string, unknown> | undefined,
    text: string,
    session: DocumentSession,
  ): Promise<void> {
    await this.initialize();
    const fileSchemaUrl = `file:///schemas/${schemaUrl.split("/").pop() ?? "schema.json"}`;
    if (schema) {
      this.setSchemas({
        [schemaUrl]: schema,
        [fileSchemaUrl]: schema,
      });
    }
    this.documents.set(uri, session);

    // 1. Send didOpen FIRST so the document is stored in workspaces
    this.notify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "toml", version: 1, text },
      },
    });

    // 2. Associate schema AFTER didOpen (so didOpen's retain doesn't wipe manual association)
    console.debug("[Taplo] Associating schema:", { uri, schemaUrl });
    this.notify({
      jsonrpc: "2.0",
      method: "taplo/associateSchema",
      params: {
        documentUri: uri,
        schemaUri: schemaUrl,
        rule: { url: uri },
        priority: 10,
      },
    });
    this.notify({
      jsonrpc: "2.0",
      method: "taplo/associateSchema",
      params: {
        documentUri: uri,
        schemaUri: schemaUrl,
        rule: { regex: ".*" },
        priority: 10,
      },
    });
  }

  changeDocument(uri: string, version: number, text: string): void {
    this.notify({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      },
    });
  }

  closeDocument(uri: string): void {
    this.documents.delete(uri);
    this.notify({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
    });
  }

  completion(uri: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/completion", {
      textDocument: { uri },
      position,
    });
  }

  hover(uri: string, position: LspPosition): Promise<unknown> {
    return this.request("textDocument/hover", {
      textDocument: { uri },
      position,
    });
  }
}

let client: TaploClient | undefined;

function getClient(): TaploClient {
  client ??= new TaploClient();
  return client;
}

function toMonacoRange(range: LspRange): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function markerSeverity(
  monaco: MonacoAPI,
  severity?: number,
): Monaco.MarkerSeverity {
  switch (severity) {
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function markdownText(
  content: string | { kind?: string; value?: string } | undefined,
): string | undefined {
  if (!content) return undefined;
  return typeof content === "string" ? content : content.value;
}

function completionItems(result: unknown): CompletionItem[] {
  if (Array.isArray(result)) return result as CompletionItem[];
  if (result && typeof result === "object" && "items" in result) {
    const { items } = result as { items?: CompletionItem[] };
    return items ?? [];
  }
  return [];
}

function completionLabel(item: CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

export async function attachTaplo(
  monaco: MonacoAPI,
  model: Monaco.editor.ITextModel,
  schemaUrl: string,
  schema?: Record<string, unknown>,
): Promise<Monaco.IDisposable> {
  const uri = model.uri.toString();
  let version = 1;
  const taplo = getClient();

  await taplo.openDocument(uri, schemaUrl, schema, model.getValue(), {
    onDiagnostics: (diagnostics) => {
      console.debug("[Taplo] Received diagnostics:", diagnostics);
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        diagnostics.map((diagnostic) => ({
          ...toMonacoRange(diagnostic.range),
          severity: markerSeverity(monaco, diagnostic.severity),
          message: diagnostic.message,
          source: diagnostic.source || "Taplo",
        })),
      );
    },
  });

  const changeListener = model.onDidChangeContent(() => {
    version += 1;
    taplo.changeDocument(uri, version, model.getValue());
  });
  const completionProvider = monaco.languages.registerCompletionItemProvider(
    "toml",
    {
      triggerCharacters: [
        ".",
        "=",
        "[",
        '"',
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
        "l",
        "m",
        "n",
        "o",
        "p",
        "q",
        "r",
        "s",
        "t",
        "u",
        "v",
        "w",
        "x",
        "y",
        "z",
      ],
      provideCompletionItems: async (
        completionModel,
        position,
        _context,
        _token,
      ) => {
        const lspPos = {
          line: position.lineNumber - 1,
          character: position.column - 1,
        };
        const result = await taplo.completion(uri, lspPos);
        const rawItems = completionItems(result);
        if (rawItems.length > 0) {
          const word = completionModel.getWordUntilPosition(position);
          const defaultRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };
          return {
            suggestions: rawItems.map((item) => {
              const textEdit = item.textEdit;
              return {
                label: completionLabel(item),
                detail: item.detail,
                documentation: markdownText(item.documentation),
                kind:
                  item.kind !== undefined
                    ? item.kind
                    : monaco.languages.CompletionItemKind.Property,
                insertText:
                  textEdit?.newText || item.insertText || completionLabel(item),
                insertTextRules:
                  item.insertTextFormat === 2
                    ? monaco.languages.CompletionItemInsertTextRule
                        .InsertAsSnippet
                    : undefined,
                range: textEdit ? toMonacoRange(textEdit.range) : defaultRange,
              };
            }),
          };
        }

        return { suggestions: [] };
      },
    },
  );
  const hoverProvider = monaco.languages.registerHoverProvider("toml", {
    provideHover: async (_model, position) => {
      const result = (await taplo.hover(uri, {
        line: position.lineNumber - 1,
        character: position.column - 1,
      })) as Hover | null;
      const contents = result?.contents
        ?.map(markdownText)
        .filter((content): content is string => Boolean(content));
      if (!contents?.length) return null;
      return {
        contents: contents.map((value) => ({ value })),
        range: result?.range ? toMonacoRange(result.range) : undefined,
      };
    },
  });

  return {
    dispose: () => {
      changeListener.dispose();
      completionProvider.dispose();
      hoverProvider.dispose();
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      taplo.closeDocument(uri);
    },
  };
}
