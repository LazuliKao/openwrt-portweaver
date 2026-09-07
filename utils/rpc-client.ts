import type { FullStatusResponse, ProjectStatus } from "@/types/portweaver";
import type { InfoResponse } from "./../types/portweaver/index";
import type { DdnsStatusResponse } from "@/types/portweaver/ddns";
import type { FrpcProxyStats } from "@/types/portweaver/frpc";
import type { FrpsProxyStats } from "@/types/portweaver/frps";
import type { RatholeMode, RatholeStatus } from "@/types/portweaver/rathole";

export interface WolWakeResponse {
  success: boolean;
  /** Legacy alias for queued_count. */
  sent_count: number;
  queued_count: number;
  skipped_count: number;
  failed_count: number;
}

export interface WolStatusResponse {
  enabled: boolean;
  mac_count: number;
  cooldown_ms: number;
  detect_protocols: string[];
  queue_depth: number;
  active_jobs: number;
  pending_count: number;
  cooldown_remaining_ms: number;
  last_attempt_ms_ago: number | null;
  last_success_ms_ago: number | null;
  last_error: string | null;
}

export type FrpConfigKind = "frpc" | "frps";
export type FrpConfigFormat = "toml" | "yaml" | "json";

export interface FrpConfigResponse {
  success: boolean;
  content: string;
  error: string;
}

export function createRpcClient(rpc: typeof L.rpc) {
  const getRatholeStatus = rpc.declare<RatholeStatus>({
    object: "portweaver",
    method: "get_rathole_status",
  });
  const getRatholeInfo = rpc.declare<InfoResponse, [RatholeMode, string]>({
    object: "portweaver",
    method: "get_rathole_info",
    params: ["mode", "name"],
  });
  const clearRatholeLogs = rpc.declare<void, [RatholeMode, string]>({
    object: "portweaver",
    method: "clear_rathole_logs",
    params: ["mode", "name"],
  });
  const listProjects = rpc.declare<{ projects: ProjectStatus[] }>({
    object: "portweaver",
    method: "list_projects",
  });
  const setEnabled = rpc.declare<void, [id: number, enabled: boolean]>({
    object: "portweaver",
    method: "set_enabled",
    params: ["id", "enabled"],
  });

  const getFrpcInfo = rpc.declare<InfoResponse, [id: string]>({
    object: "portweaver",
    method: "get_frpc_info",
    params: ["id"],
  });

  const clearFrpcLogs = rpc.declare<void, [id: string]>({
    object: "portweaver",
    method: "clear_frpc_logs",
    params: ["id"],
  });

  const getFrpcProxyStats = rpc.declare<FrpcProxyStats, [id: string]>({
    object: "portweaver",
    method: "get_frpc_proxy_stats",
    params: ["id"],
  });

  const getDdnsStatus = rpc.declare<DdnsStatusResponse>({
    object: "portweaver",
    method: "get_ddns_status",
  });

  const getDdnsInfo = rpc.declare<InfoResponse, [name: string]>({
    object: "portweaver",
    method: "get_ddns_info",
    params: ["name"],
  });

  const clearDdnsLogs = rpc.declare<void, [name: string]>({
    object: "portweaver",
    method: "clear_ddns_logs",
    params: ["name"],
  });

  const getFrpsInfo = rpc.declare<InfoResponse, [id: string]>({
    object: "portweaver",
    method: "get_frps_info",
    params: ["id"],
  });

  const clearFrpsLogs = rpc.declare<void, [id: string]>({
    object: "portweaver",
    method: "clear_frps_logs",
    params: ["id"],
  });

  const getFrpsProxyStats = rpc.declare<FrpsProxyStats[], [id: string]>({
    object: "portweaver",
    method: "get_frps_proxy_stats",
    params: ["id"],
  });

  const getFullStatus = rpc.declare<FullStatusResponse>({
    object: "portweaver",
    method: "get_full_status",
  });

  const getNftablesRules = rpc.declare<{ rules: string }>({
    object: "portweaver",
    method: "get_nftables_rules",
  });

  const reloadConfig = rpc.declare<{
    success: boolean;
    changes: number;
    message: string;
  }>({
    object: "portweaver",
    method: "reload_config",
  });

  const readFrpConfig = rpc.declare<FrpConfigResponse, [FrpConfigKind, string]>(
    {
      object: "portweaver",
      method: "read_frp_config",
      params: ["kind", "path"],
    },
  );

  const validateFrpConfig = rpc.declare<
    FrpConfigResponse,
    [FrpConfigKind, FrpConfigFormat, string]
  >({
    object: "portweaver",
    method: "validate_frp_config",
    params: ["kind", "format", "content"],
  });

  const writeFrpConfig = rpc.declare<
    FrpConfigResponse,
    [FrpConfigKind, FrpConfigFormat, string, string, boolean]
  >({
    object: "portweaver",
    method: "write_frp_config",
    params: ["kind", "format", "path", "content", "reload"],
  });

  const restartProject = rpc.declare<
    { id: number; status: string },
    [id: number]
  >({
    object: "portweaver",
    method: "restart_project",
    params: ["id"],
  });

  const wolWake = rpc.declare<
    WolWakeResponse,
    [project?: string, target?: string]
  >({
    object: "portweaver",
    method: "wol_wake",
    params: ["project", "target"],
  });

  const wolStatus = rpc.declare<
    WolStatusResponse,
    [project?: string, target?: string]
  >({
    object: "portweaver",
    method: "wol_status",
    params: ["project", "target"],
  });

  const uciCommit = rpc.declare<void, [config: string]>({
    object: "uci",
    method: "commit",
    params: ["config"],
  });

  return {
    listProjects,
    setEnabled,
    getFrpcInfo,
    getFrpcProxyStats,
    clearFrpcLogs,
    getDdnsStatus,
    getDdnsInfo,
    clearDdnsLogs,
    getFrpsInfo,
    getRatholeStatus,
    getRatholeInfo,
    clearRatholeLogs,
    clearFrpsLogs,
    getFrpsProxyStats,
    getFullStatus,
    getNftablesRules,
    reloadConfig,
    readFrpConfig,
    validateFrpConfig,
    writeFrpConfig,
    restartProject,
    wolWake,
    wolStatus,
    uciCommit,
  };
}
export type RpcClient = ReturnType<typeof createRpcClient>;
export const rpcClient = createRpcClient(L.rpc);
