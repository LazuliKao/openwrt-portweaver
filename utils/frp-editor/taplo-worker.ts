import { TAPLO_LSP_URL } from "./constants";

type RpcMessage = {
  jsonrpc: "2.0";
  method?: string;
  id?: number | string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type TaploLsp = {
  send(message: RpcMessage): void;
  dispose(): void;
};

type TaploLspModule = {
  TaploLsp?: TaploLspConstructor;
  default?: { TaploLsp?: TaploLspConstructor };
};

type TaploLspConstructor = {
  initialize(
    environment: Record<string, unknown>,
    lspInterface: { onMessage(message: RpcMessage): void },
  ): Promise<TaploLsp>;
};

type WorkerRequest =
  | { type: "initialize" }
  | { type: "setSchemas"; schemas: Record<string, unknown> }
  | { type: "send"; message: RpcMessage }
  | { type: "dispose" };

type WorkerResponse =
  | { type: "ready" }
  | { type: "message"; message: RpcMessage }
  | { type: "error"; message: string };

let lsp: TaploLsp | undefined;
const schemaFileMap = new Map<string, Uint8Array>();
const schemaJsonMap = new Map<string, string>();

// Intercept fetch inside Web Worker so Taplo's reqwest/fetch gets schema instantly without network
const originalFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  console.log("[Taplo Worker fetch]", url);
  for (const [key, json] of schemaJsonMap.entries()) {
    if (url === key || url.endsWith(key) || key.endsWith(url)) {
      console.log("[Taplo Worker fetch HIT (intercepted schema)]:", url);
      const res = new Response(json, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      // CRITICAL: reqwest in WASM calls `Url::parse(&response.url()).expect_throw("url parse")`.
      // Browser's synthetic `new Response()` has an empty string `""` as its `.url`.
      // Parsing `""` causes Rust WASM panic: "url parse".
      // We must define `.url` on the Response instance!
      Object.defineProperty(res, "url", {
        value: url,
        writable: false,
        configurable: true,
      });
      return res;
    }
  }
  if (originalFetch) {
    console.log("[Taplo Worker fetch MISS (calling network)]:", url);
    try {
      const res = await originalFetch(input, init);
      console.log("[Taplo Worker fetch network response]:", url, res.status);
      if (!res.url) {
        Object.defineProperty(res, "url", {
          value: url,
          writable: false,
          configurable: true,
        });
      }
      return res;
    } catch (netErr) {
      console.error("[Taplo Worker fetch network error]:", url, netErr);
      throw netErr;
    }
  }
  console.error("[Taplo Worker fetch unavailable]:", url);
  throw new Error(`fetch unavailable for ${url}`);
};

function post(message: WorkerResponse): void {
  globalThis.postMessage(message);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^file:\/\//, "");
}

function createEnvironment(): Record<string, unknown> {
  const emptyInput = async (): Promise<Uint8Array> => new Uint8Array(0);
  const textDecoder = new TextDecoder();

  return {
    now: () => new Date(),
    envVar: () => undefined,
    envVars: () => [],
    stdErrAtty: () => false,
    stdin: emptyInput,
    stdout: async (bytes: Uint8Array): Promise<number> => {
      const text = textDecoder.decode(bytes).trim();
      if (text) {
        console.log("[Taplo Worker stdout]", text);
      }
      return bytes.byteLength;
    },
    stderr: async (bytes: Uint8Array): Promise<number> => {
      const text = textDecoder.decode(bytes).trim();
      if (text) {
        console.warn("[Taplo Worker stderr]", text);
      }
      return bytes.byteLength;
    },
    glob: () => [],
    readFile: async (path: string): Promise<Uint8Array> => {
      const normalized = normalizePath(path);
      for (const [key, bytes] of schemaFileMap.entries()) {
        if (
          normalized === key ||
          normalized.endsWith(key) ||
          key.endsWith(normalized)
        ) {
          console.log("[Taplo Worker readFile HIT]", path, "matched key:", key);
          return bytes;
        }
      }
      console.warn(
        "[Taplo Worker readFile MISS (fallback to empty JSON)]",
        path,
        "known keys:",
        [...schemaFileMap.keys()],
      );
      // NEVER throw inside async callback called by WASM! It hangs the Rust future.
      return new TextEncoder().encode("{}");
    },
    writeFile: async (): Promise<void> => {},
    urlToFilePath: (url: string) => {
      let res: string;
      try {
        const parsed = new URL(url);
        res = parsed.pathname || url;
      } catch {
        res = url.replace(/^file:\/\//, "");
      }
      console.log("[Taplo Worker urlToFilePath]", url, "->", res);
      return res;
    },
    isAbsolute: () => true,
    cwd: () => "/",
    findConfigFile: () => undefined,
  };
}

function importTaplo(): Promise<TaploLspModule> {
  const dynamicImport = Function("url", "return import(url);") as (
    url: string,
  ) => Promise<TaploLspModule>;
  return dynamicImport(TAPLO_LSP_URL);
}

async function initialize(): Promise<void> {
  if (lsp) return;
  console.log("[Taplo Worker] Importing Taplo LSP from CDN...");
  const module = await importTaplo();
  const TaploLsp = module.TaploLsp ?? module.default?.TaploLsp;
  if (!TaploLsp) throw new Error("Taplo LSP export is unavailable.");
  console.log("[Taplo Worker] Initializing Taplo LSP WASM instance...");
  lsp = await TaploLsp.initialize(createEnvironment(), {
    onMessage: (message) => {
      console.log(
        "[Taplo Worker -> Client (onMessage)]",
        message.method || `reply(${message.id})`,
        message,
      );
      post({ type: "message", message });
    },
  });
  console.log("[Taplo Worker] Taplo LSP WASM initialized successfully.");
}

function updateSchemas(schemas: Record<string, unknown>): void {
  const encoder = new TextEncoder();
  for (const [key, value] of Object.entries(schemas)) {
    const json = JSON.stringify(value);
    const bytes = encoder.encode(json);
    schemaFileMap.set(key, bytes);
    schemaFileMap.set(normalizePath(key), bytes);
    schemaJsonMap.set(key, json);
    schemaJsonMap.set(normalizePath(key), json);
    try {
      const url = new URL(key);
      schemaFileMap.set(url.pathname, bytes);
      schemaJsonMap.set(url.pathname, json);
      schemaJsonMap.set(url.href, json);
    } catch {
      // ignore
    }
  }
}

globalThis.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void (async () => {
    try {
      switch (event.data.type) {
        case "initialize":
          console.log("[Taplo Worker] Received initialize request");
          await initialize();
          post({ type: "ready" });
          break;
        case "setSchemas":
          console.log(
            "[Taplo Worker] Updating schemas, keys:",
            Object.keys(event.data.schemas),
          );
          updateSchemas(event.data.schemas);
          break;
        case "send": {
          if (!lsp) throw new Error("Taplo has not been initialized.");
          const desc =
            event.data.message.method || `reply(${event.data.message.id})`;
          console.log(
            "[Taplo Worker -> Rust lsp.send]",
            desc,
            event.data.message,
          );
          try {
            lsp.send(event.data.message);
          } catch (sendErr) {
            console.error(
              "[Taplo Worker] lsp.send threw exception:",
              desc,
              sendErr,
            );
            throw sendErr;
          }
          break;
        }
        case "dispose":
          console.log("[Taplo Worker] Disposing Taplo LSP");
          lsp?.dispose();
          lsp = undefined;
          schemaFileMap.clear();
          globalThis.close();
          break;
      }
    } catch (error) {
      console.error("[Taplo Worker unhandled error]", error);
      post({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unable to start Taplo.",
      });
    }
  })();
};
