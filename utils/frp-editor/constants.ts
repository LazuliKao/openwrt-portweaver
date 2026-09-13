import type { FrpEditorKind } from "./types";

export const MONACO_VERSION = "0.56.0";
export const MONACO_ESM_VERSION = "0.56.1";
export const MONACO_YAML_VERSION = "5.5.1";
export const MONACO_CDN_TIMEOUT = 15_000;

export const SCHEMA_COMMIT = "bf8926da67eb09d5508e3403e3d538a90e66e739";

export const SCHEMA_URLS: Record<FrpEditorKind, string> = {
  frpc: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frpc-schema.json`,
  frps: `https://raw.githubusercontent.com/LazuliKao/frp-schemas/${SCHEMA_COMMIT}/frps-schema.json`,
};
