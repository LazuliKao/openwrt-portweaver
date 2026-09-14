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
  schemaUrl: string;
  schema?: Record<string, unknown>;
  getText(): string;
  getVersion(): number;
  onDiagnostics(diagnostics: LspDiagnostic[]): void;
};

const MARKER_OWNER = "portweaver-taplo";

class TaploClient {
  private worker: Worker;
  private readonly documents = new Map<string, DocumentSession>();
  private readonly pending = new Map<
    RpcId,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextId = 1;
  private ready: Promise<void>;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private initialized: Promise<void> | undefined;
  private configured: Promise<void>;
  private configuredResolve: (() => void) | undefined;
  private lastSchemas: Record<string, unknown> = {};
  private isDisposed = false;
  private isRecovering = false;
  private recoveryPromise: Promise<void> | undefined;

  constructor() {
    this.configured = new Promise<void>((resolve) => {
      this.configuredResolve = resolve;
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker = this.createWorker();
    this.sendWorker({ type: "initialize" });
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./taplo-worker.ts", import.meta.url), {
      name: "portweaver-taplo",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.handleWorkerMessage(event.data);
    worker.onerror = (event: ErrorEvent) => {
      console.error("[Taplo Worker onerror]", event.message || event);
      this.triggerRecovery("worker onerror");
    };
    return worker;
  }

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
      this.triggerRecovery(response.message);
      return;
    }
    console.log(
      "[Taplo Worker -> Client]",
      response.message.method || `reply(${response.message.id})`,
      response.message,
    );
    this.handleServerMessage(response.message);
  }

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
        void this.notify({
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
      void this.notify({ jsonrpc: "2.0", id: message.id, result: null });
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

  private triggerRecovery(reason: string): void {
    if (this.isDisposed || this.isRecovering) return;
    console.warn(
      `[Taplo Client] Triggering self-healing recovery (reason: ${reason})...`,
    );
    void this.recover().catch((err) => {
      console.error("[Taplo Client] Self-healing recovery failed:", err);
    });
  }

  private async recover(): Promise<void> {
    if (this.isDisposed) return;
    if (this.recoveryPromise) return this.recoveryPromise;

    this.recoveryPromise = (async () => {
      this.isRecovering = true;
      console.log(
        "[Taplo Client] Initiating worker replacement and state restoration...",
      );

      // 1. Terminate old dead worker
      try {
        this.worker.terminate();
      } catch (err) {
        console.warn("[Taplo Client] Failed to terminate worker:", err);
      }

      // 2. Reject all in-flight pending requests
      this.rejectPending(new Error("Taplo worker crashed and is restarting."));

      // 3. Reset handshake promises
      this.configured = new Promise<void>((resolve) => {
        this.configuredResolve = resolve;
      });
      this.ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
      this.initialized = undefined;

      // 4. Create new worker
      this.worker = this.createWorker();
      this.sendWorker({ type: "initialize" });

      // 5. Initialize LSP
      await this.initialize();

      // 6. Restore schemas
      if (Object.keys(this.lastSchemas).length > 0) {
        this.sendWorker({ type: "setSchemas", schemas: this.lastSchemas });
      }

      // 7. Re-open all tracked active documents
      for (const [uri, doc] of this.documents.entries()) {
        const text = doc.getText();
        const schemaUrl = doc.schemaUrl;

        await this.notify({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri,
              languageId: "toml",
              version: doc.getVersion(),
              text,
            },
          },
        });

        await this.notify({
          jsonrpc: "2.0",
          method: "taplo/associateSchema",
          params: {
            documentUri: uri,
            schemaUri: schemaUrl,
            rule: { url: uri },
            priority: 10,
          },
        });

        await this.notify({
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

      console.log(
        `[Taplo Client] Self-healing recovery finished successfully. Restored ${this.documents.size} document(s).`,
      );
    })().finally(() => {
      this.isRecovering = false;
      this.recoveryPromise = undefined;
    });

    return this.recoveryPromise;
  }

  private async notify(message: RpcMessage): Promise<void> {
    if (this.recoveryPromise && !this.isRecovering) {
      try {
        await this.recoveryPromise;
      } catch {
        return;
      }
    }
    console.log(
      "[Taplo Client -> Worker]",
      message.method || `reply(${message.id})`,
      message,
    );
    this.sendWorker({ type: "send", message });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.recoveryPromise && !this.isRecovering) {
      try {
        await this.recoveryPromise;
      } catch {
        return null;
      }
    }
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
      this.sendWorker({
        type: "send",
        message: { jsonrpc: "2.0", id, method, params },
      });
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
      await this.notify({ jsonrpc: "2.0", method: "initialized", params: {} });
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
    this.lastSchemas = { ...this.lastSchemas, ...schemas };
    this.sendWorker({ type: "setSchemas", schemas });
  }

  async openDocument(
    uri: string,
    schemaUrl: string,
    schema: Record<string, unknown> | undefined,
    text: string,
    session: DocumentSession,
  ): Promise<void> {
    if (this.recoveryPromise && !this.isRecovering) {
      try {
        await this.recoveryPromise;
      } catch {
        // ignore
      }
    }
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
    await this.notify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "toml", version: 1, text },
      },
    });

    // 2. Associate schema AFTER didOpen (so didOpen's retain doesn't wipe manual association)
    console.debug("[Taplo] Associating schema:", { uri, schemaUrl });
    await this.notify({
      jsonrpc: "2.0",
      method: "taplo/associateSchema",
      params: {
        documentUri: uri,
        schemaUri: schemaUrl,
        rule: { url: uri },
        priority: 10,
      },
    });
    await this.notify({
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
    void this.notify({
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
    void this.notify({
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

  dispose(): void {
    this.isDisposed = true;
    try {
      this.sendWorker({ type: "dispose" });
      this.worker.terminate();
    } catch {
      // ignore
    }
    this.rejectPending(new Error("Taplo client disposed."));
    this.documents.clear();
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
    schemaUrl,
    schema,
    getText: () => model.getValue(),
    getVersion: () => version,
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
        try {
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
                    textEdit?.newText ||
                    item.insertText ||
                    completionLabel(item),
                  insertTextRules:
                    item.insertTextFormat === 2
                      ? monaco.languages.CompletionItemInsertTextRule
                          .InsertAsSnippet
                      : undefined,
                  range: textEdit
                    ? toMonacoRange(textEdit.range)
                    : defaultRange,
                };
              }),
            };
          }
        } catch (error) {
          console.warn("[Taplo Completion Error]", error);
        }

        return { suggestions: [] };
      },
    },
  );
  const hoverProvider = monaco.languages.registerHoverProvider("toml", {
    provideHover: async (_model, position) => {
      try {
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
      } catch (error) {
        console.warn("[Taplo Hover Error]", error);
        return null;
      }
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
