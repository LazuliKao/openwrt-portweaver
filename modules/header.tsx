import { StatusPanel } from "@/components/StatusPanel";
import { rpcClient } from "@/utils/rpc-client";
import { isFeatureEnabled } from "@/utils/feature";
const form = L.form;
import type { Client } from "./client";

export default function (
  _m: LuCI.form.Map,
  s: LuCI.form.NamedSection,
  client: Client,
  tab_id: string,
) {
  {
    const o = s.taboption(tab_id, form.Flag, "enabled", _("Enable PortWeaver"));
    o.default = "1";
    o.rmempty = false;

    if (isFeatureEnabled("nftables_mode")) {
      const o = s.taboption(
        tab_id,
        form.Flag,
        "use_nftables",
        _("Use nftables"),
      );
      o.default = "0";
      o.rmempty = false;
      o.description = _(
        "Add nft rules directly to the nftables instead of adding uci entries to the OpenWrt firewall (fw4).",
      );
      o.default = "1";
      o.rmempty = false;
    }
  }
  {
    const o = s.taboption(
      tab_id,
      form.Value,
      "frp_config_root",
      _("External Configuration Root"),
    );
    o.rmempty = false;
    o.default = "/etc/portweaver";
    o.placeholder = "/etc/portweaver";
    o.description = _(
      "Trusted root for external FRP and Rathole configuration files. Save and reload after changing this path before using file editor actions.",
    );
    o.validate = (_sectionId: string, value: unknown) => {
      const path = String(value || "");
      if (!path.startsWith("/") || path === "/")
        return _(
          "Configuration root must be an absolute directory other than /.",
        );
      return true;
    };
  }
  {
    const o = s.taboption(
      tab_id,
      form.DummyValue,
      "_runtime_status",
      _("Runtime Status"),
    );
    o.rawhtml = true;
    o.cfgvalue = () => {
      const panel = new StatusPanel();
      client.statusPanel = panel;
      return panel.render(
        client.globalStatus,
        client.frpStatus,
        client.projectStatuses,
        client.events,
        client.ddnsGlobalStatus,
      );
    };
  }

  const o = s.taboption(
    tab_id,
    form.Button,
    "_reload_config",
    _("Reload Config"),
  );
  o.modalonly = false;
  o.editable = true;
  o.inputtitle = _("Reload");
  o.onclick = async () => {
    try {
      await _m.save();
      await L.uci.save();
      await rpcClient.uciCommit("portweaver");
      const result = await rpcClient.reloadConfig();
      L.ui.addNotification(
        null,
        <p>
          {_("Config reloaded: %d project(s) restarted").format(result.changes)}
        </p>,
        "info",
      );
      location.reload();
    } catch (err) {
      L.ui.addNotification(
        null,
        <p>
          {_("Failed to reload config: %s").format(
            (err as { message: string })?.message || String(err),
          )}
        </p>,
        "error",
      );
    }
  };
  const runtimeToggle = async (section_id: string) => {
    const idx = client.getProjectIndex(section_id);
    if (idx < 0) {
      L.ui.addNotification(
        null,
        <p>{_("Could not determine project index")}</p>,
        "error",
      );
      return Promise.resolve();
    }
    const actionObj = client.actionContainers?.[section_id];
    if (actionObj?.toggleBtn) {
      actionObj.toggleBtn.disabled = true;
    }
    const status = client.getProjectStatus(section_id);
    const newEnabled = !status?.enabled;
    try {
      await rpcClient.setEnabled(idx, !!newEnabled);
      L.ui.addNotification(
        null,
        <p>
          {_("Runtime state updated to: %s").format(
            newEnabled ? _("enabled") : _("disabled"),
          )}
        </p>,
        "info",
      );
      const fullStatus = await rpcClient.getFullStatus();
      if (fullStatus) {
        client.updateFromFullStatus(fullStatus);
      }
    } catch (err) {
      L.ui.addNotification(
        null,
        <p>
          {_("Failed to toggle runtime state: %s").format(
            (err as { message: string })?.message || String(err),
          )}
        </p>,
        "error",
      );
    } finally {
      if (actionObj?.toggleBtn) {
        actionObj.toggleBtn.disabled = false;
      }
    }
  };
  (window as any).portweaverToggle = runtimeToggle;
  const restartProject = async (section_id: string) => {
    const idx = client.getProjectIndex(section_id);
    if (idx < 0) {
      L.ui.addNotification(
        null,
        <p>{_("Could not determine project index")}</p>,
        "error",
      );
      return Promise.resolve();
    }
    const actionObj = client.actionContainers?.[section_id];
    if (actionObj?.restartBtn) {
      actionObj.restartBtn.disabled = true;
    }
    try {
      await rpcClient.restartProject(idx);
      L.ui.addNotification(
        null,
        <p>{_("Project restarted successfully")}</p>,
        "info",
      );
      const fullStatus = await rpcClient.getFullStatus();
      if (fullStatus) {
        client.updateFromFullStatus(fullStatus);
      }
    } catch (err) {
      L.ui.addNotification(
        null,
        <p>
          {_("Failed to restart project: %s").format(
            (err as { message: string })?.message || String(err),
          )}
        </p>,
        "error",
      );
    } finally {
      if (actionObj?.restartBtn) {
        actionObj.restartBtn.disabled = false;
      }
    }
  };
  (window as any).portweaverRestart = restartProject;
}
