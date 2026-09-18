import { Client } from "./modules/client";
import type { FullStatusResponse, VersionResponse } from "./types/portweaver";
import frpc from "./modules/frpc";
import frps from "./modules/frps";
import rathole from "./modules/rathole";
import config from "./modules/config";
import header from "./modules/header";
import logs from "./modules/logs";
import ddns from "./modules/ddns";
import nftables from "./modules/nftables";
import about from "./modules/about";
import wol from "./modules/wol";
import { rpcClient } from "./utils/rpc-client";
import { setVersionInfo, isFeatureEnabled } from "./utils/feature";

const form = L.form;
const uci = L.uci;
type UnwrapPromise<T> = T extends Promise<infer R> ? R : T;
export class main extends L.view {
  private mapInstance?: LuCI.form.Map;

  override async load() {
    return Promise.all([
      uci.load("portweaver"),
      uci.load("firewall"),
      rpcClient
        .getFullStatus()
        .then((res: FullStatusResponse) => res || {})
        .catch((err: any) => {
          console.warn("ubus get_full_status failed:", err);
          return {} as FullStatusResponse;
        }),
      L.fs
        .exec("/usr/bin/portweaver", ["version", "--json"])
        .then((res: any) => {
          if (res && res.code === 0 && res.stdout) {
            try {
              const info = JSON.parse(res.stdout) as VersionResponse;
              setVersionInfo(info);
              return info;
            } catch (e) {
              console.warn("Failed to parse portweaver version JSON:", e);
            }
          }
          return null;
        })
        .catch((err: any) => {
          console.warn("exec portweaver version failed:", err);
          return null;
        }),
    ]);
  }

  override render(data: UnwrapPromise<ReturnType<typeof this.load>>) {
    const m = new form.Map(
      "portweaver",
      _("PortWeaver"),
      _("Port forwarding and NAT traversal configuration"),
    );
    this.mapInstance = m;

    const s = m.section(form.NamedSection, "global", "portweaver");
    s.anonymous = true;
    s.addremove = false;

    s.tab("settings", _("Global Settings"));
    s.tab("projects", _("Port Forwarding"));
    const version = data[3] as VersionResponse | null;
    if (version?.rathole_client_mode)
      s.tab("rathole_client", _("Rathole Client"));
    if (version?.rathole_server_mode)
      s.tab("rathole_server", _("Rathole Server"));
    if (isFeatureEnabled("wol_mode")) {
      s.tab("wol", _("Wake-on-LAN"));
    }
    if (isFeatureEnabled("ddns_mode")) {
      s.tab("ddns", _("DDNS"));
    }
    if (isFeatureEnabled("frpc_mode")) {
      s.tab("frpc", _("FRP Tunnels"));
    }
    if (isFeatureEnabled("frps_mode")) {
      s.tab("frps", _("FRP Server"));
    }
    if (isFeatureEnabled("nftables_mode")) {
      s.tab("nftables", _("nftables"));
    }
    s.tab("logs", _("System Logs"));
    s.tab("about", _("About"));

    const fullStatus: FullStatusResponse = data[2] as FullStatusResponse;
    const versionInfo = data[3] as VersionResponse | null;
    const client = new Client(fullStatus);

    header(m, s, client, "settings");
    config(m, s, client, "projects");
    if (version?.rathole_client_mode) rathole(s, "client");
    if (version?.rathole_server_mode) rathole(s, "server");
    if (isFeatureEnabled("wol_mode")) {
      wol(m, s, "wol");
    }
    if (isFeatureEnabled("ddns_mode")) {
      ddns(m, s, "ddns");
    }
    if (isFeatureEnabled("frpc_mode")) {
      frpc(m, s, "frpc");
    }
    if (isFeatureEnabled("frps_mode")) {
      frps(m, s, "frps");
    }
    if (isFeatureEnabled("nftables_mode")) {
      nftables(m, s, "nftables");
    }
    logs(m, s, "logs");
    about(m, s, "about", versionInfo);

    return m.render();
  }

  override handleSave = async (_ev?: Event) => {
    if (this.mapInstance) {
      await this.mapInstance.save();
    }
    return L.uci.save();
  };

  override handleReset = async (_ev?: Event) => {
    if (this.mapInstance) {
      await this.mapInstance.reset();
    }
  };

  override handleSaveApply = async (ev?: Event, mode: string | number = 0) => {
    await this.handleSave(ev);
    const uiChanges = (L as any).ui.changes;
    if (uiChanges && typeof uiChanges.apply === "function") {
      return uiChanges.apply(mode === "0" || mode === 0);
    }
    return L.uci.apply();
  };

  async handleSaveRestart(ev?: Event) {
    try {
      await this.handleSave(ev);
      await rpcClient.uciCommit("portweaver");
      const res = await L.fs.exec("/etc/init.d/portweaver", ["restart"]);
      if (res && res.code !== 0) {
        throw new Error(res.stderr || res.stdout || `Exit code ${res.code}`);
      }
      L.ui.addNotification(
        null,
        <p>{_("Service restarted successfully")}</p>,
        "info",
      );
      window.setTimeout(() => location.reload(), 1500);
    } catch (err: any) {
      L.ui.addNotification(
        null,
        <p>{_("Failed to restart service: %s").format(err.toString())}</p>,
        "error",
      );
    }
  }

  addFooter(): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const pageActions = (
      <div class="cbi-page-actions">
        <button
          type="button"
          class="cbi-button cbi-button-apply"
          onclick={(ev: Event) => this.handleSaveApply(ev, 0)}
        >
          {_("Save & Apply")}
        </button>
        <button
          type="button"
          class="cbi-button cbi-button-negative"
          style="margin-left: 8px;"
          onclick={(ev: Event) => this.handleSaveRestart(ev)}
        >
          {_("Save & Restart")}
        </button>
        <button
          type="button"
          class="cbi-button cbi-button-save"
          style="margin-left: 8px;"
          onclick={(ev: Event) => this.handleSave(ev)}
        >
          {_("Save")}
        </button>
        <button
          type="button"
          class="cbi-button cbi-button-reset"
          style="margin-left: 8px;"
          onclick={(ev: Event) => this.handleReset(ev)}
        >
          {_("Reset")}
        </button>
      </div>
    );

    fragment.appendChild(pageActions);
    return fragment;
  }
}
