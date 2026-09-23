import type { Client } from "./client";
import { isFeatureEnabled } from "../utils/feature";
import FrpNodeSelector from "../components/FrpNodeSelector";
import PortMappingEditor from "../components/PortMappingEditor";
import { rpcClient, type WolWakeResponse } from "@/utils/rpc-client";
const form = L.form;
const uci = L.uci;

const PROTOCOLS = [
  ["ssh", "SSH"],
  ["rdp", "RDP"],
  ["http", "HTTP"],
  ["tls", "TLS/SSL"],
  ["vnc", "VNC/RFB"],
  ["socks5", "SOCKS5"],
  ["postgresql", "PostgreSQL"],
  ["telnet", "Telnet"],
  ["minecraft", "Minecraft (Java Edition)"],
  ["mqtt", "MQTT"],
  ["smb", "SMB/CIFS"],
] as const;

const FILTER_PROTOCOLS = new Set(PROTOCOLS.map(([value]) => value));
const ON_PROTOCOL_WOL_PROTOCOLS = new Set([
  "rdp",
  "http",
  "tls",
  "socks5",
  "postgresql",
  "minecraft",
  "mqtt",
  "smb",
]);

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const item = String(value || "").trim();
  return item ? [item] : [];
}

function validateProtocolList(
  value: unknown,
  allowed: ReadonlySet<string>,
  required: boolean,
): boolean | string {
  const values = stringList(value).map((item) => item.toLowerCase());
  if (required && values.length === 0)
    return _("Select at least one protocol.");

  const seen = new Set<string>();
  for (const protocol of values) {
    if (!allowed.has(protocol)) {
      return _("Unsupported protocol: %s").format(protocol);
    }
    if (seen.has(protocol)) {
      return _("Protocol may only be selected once: %s").format(protocol);
    }
    seen.add(protocol);
  }
  return true;
}

function hasChanged(
  options: LuCI.form.AbstractValue[],
  sectionId: string,
): boolean {
  return options.some((option) => option.getUIElement(sectionId)?.isChanged());
}

function showWakeResult(result: WolWakeResponse): void {
  const message = _("WoL queued: %d, skipped: %d, failed: %d.").format(
    result.queued_count,
    result.skipped_count,
    result.failed_count,
  );
  L.ui.addNotification(
    null,
    <p>{message}</p>,
    result.failed_count ? "error" : "info",
  );
}

export default function (
  _m: LuCI.form.Map,
  s: LuCI.form.NamedSection,
  client: Client,
  tab_id: string,
) {
  const o0 = s.taboption(
    tab_id,
    form.SectionValue,
    "_projects",
    form.GridSection,
    "project",
  );

  const ss = o0.subsection as LuCI.form.TableSection;
  ss.anonymous = true;
  ss.addremove = true;
  ss.sortable = true;
  ss.cloneable = true;

  ss.modaltitle = (section_id: string) =>
    uci.get("portweaver", section_id, "remark")?.toString() ||
    _("Unnamed project");

  {
    const o = ss.option(form.Flag, "enabled", _("Enabled"));
    o.modalonly = false;
    o.default = "1";
    o.editable = true;
  }
  {
    const o = ss.option(form.DummyValue, "_project_name", _("Name"));
    o.modalonly = false;
    o.textvalue = (section_id: string) => {
      const name =
        uci.get("portweaver", section_id, "remark")?.toString() ||
        _("Unnamed project");

      return (
        <div style="text-align: center;">
          <strong>{name}</strong>
        </div>
      );
    };
  }
  {
    const o = ss.option(form.DummyValue, "_runtime_status", _("Status"));
    o.modalonly = false;
    o.textvalue = (section_id: string) => {
      const status = client.getProjectStatus(section_id);
      const container = (
        <div>{client.renderStatusElements(status, section_id)}</div>
      ) as HTMLElement;
      client.projectContainers = client.projectContainers || {};
      client.projectContainers[section_id] = container;
      return container;
    };
  } // Preview column

  {
    const o = ss.option(form.DummyValue, "_runtime_actions", _("Actions"));
    o.modalonly = false;
    o.textvalue = (section_id: string) => {
      const status = client.getProjectStatus(section_id);
      const isRuntimeEnabled = status?.enabled;
      const toggleText = isRuntimeEnabled ? _("Disable") : _("Enable");

      const toggleBtn = (
        <button
          type="button"
          class="btn cbi-button cbi-button-neutral"
          style="margin-bottom: 4px; width: 100%; min-width: 60px;"
          onclick={(_ev: Event) => (window as any).portweaverToggle(section_id)}
        >
          {toggleText}
        </button>
      ) as HTMLButtonElement;

      const restartBtn = (
        <button
          type="button"
          class="btn cbi-button cbi-button-neutral"
          style="width: 100%; min-width: 60px;"
          onclick={(_ev: Event) =>
            (window as any).portweaverRestart(section_id)
          }
        >
          {_("Restart")}
        </button>
      ) as HTMLButtonElement;

      const container = (
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; max-width: 80px; margin: 0 auto;">
          {toggleBtn}
          {restartBtn}
        </div>
      ) as HTMLElement;

      client.actionContainers = client.actionContainers || {};
      client.actionContainers[section_id] =
        client.actionContainers[section_id] || {};
      client.actionContainers[section_id].container = container;
      client.actionContainers[section_id].toggleBtn = toggleBtn;
      client.actionContainers[section_id].restartBtn = restartBtn;

      return container;
    };
  }
  {
    const o = ss.option(form.DummyValue, "_preview", _("Overview"));
    o.modalonly = false;
    o.textvalue = (section_id: string) => {
      const protocol =
        uci.get("portweaver", section_id, "protocol")?.toString() || "tcp";
      const family =
        uci.get("portweaver", section_id, "family")?.toString() || "any";
      const listen_port =
        uci.get("portweaver", section_id, "listen_port")?.toString() || "";
      const target_address =
        uci.get("portweaver", section_id, "target_address")?.toString() || "";
      const target_port =
        uci.get("portweaver", section_id, "target_port")?.toString() || "";
      const port_mappings = L.toArray<string>(
        uci.get("portweaver", section_id, "port_mapping"),
      );
      const src_zones = L.toArray<string>(
        uci.get("portweaver", section_id, "src_zone"),
      );
      const dest_zones = L.toArray<string>(
        uci.get("portweaver", section_id, "dest_zone"),
      );

      const proto_text: string =
        (
          {
            both: _("TCP and UDP"),
            tcp: _("TCP"),
            udp: _("UDP"),
          } as any
        )[protocol] || String(protocol).toUpperCase();
      const family_text: string =
        (
          {
            any: _("IPv4 and IPv6"),
            ipv4: _("IPv4"),
            ipv6: _("IPv6"),
          } as any
        )[family] || family;

      const lines: any[] = [];
      lines.push(
        <span>
          {_("Incoming ")}
          <var>{family_text}</var>
          {_(" protocol ")}
          <var>{proto_text}</var>
        </span>,
      );

      if (src_zones.length > 0) {
        const src_badges = src_zones.map((z: string) => (
          <span class="zonebadge" style={fwmodel.getZoneColorStyle(z)}>
            <strong>{z || <em>{_("any zone")}</em>}</strong>
          </span>
        ));
        lines.push(<br />);
        lines.push(
          <span>
            {_("From ")}
            {...src_badges}
          </span>,
        );
      }

      if (port_mappings.length > 0) {
        lines.push(<br />);
        lines.push(
          <span>
            <strong style="color: #09c;">{_("Multi-Port")}</strong>
            {_(" - ")}
            <var>{port_mappings.length}</var>
            {_(" mapping(s)")}
          </span>,
        );
        const first = port_mappings[0];
        lines.push(<br />);
        lines.push(
          <span>
            {_("e.g. ")}
            <var>{first}</var>
          </span>,
        );
      } else if (listen_port) {
        lines.push(<br />);
        lines.push(
          <span>
            {_("Port ")}
            <var>{listen_port}</var>
          </span>,
        );
      }

      lines.push(<br />);
      lines.push(
        <span>
          <var data-tooltip="Forward">{_("Forward")}</var>
          {_(" to ")}
        </span>,
      );

      if (dest_zones.length > 0) {
        const dest_badges = dest_zones.map((z: string) => (
          <span class="zonebadge" style={fwmodel.getZoneColorStyle(z)}>
            <strong>{z || <em>{_("any zone")}</em>}</strong>
          </span>
        ));
        lines.push(...dest_badges);
        lines.push(_(" "));
      }

      if (target_address) {
        lines.push(
          <span>
            {_("IP ")}
            <var>{target_address}</var>
          </span>,
        );
      }
      if (port_mappings.length === 0 && target_port) {
        lines.push(
          <span>
            {_(" port ")}
            <var>{target_port}</var>
          </span>,
        );
      }
      return <small>{lines}</small>;
    };
  }
  ss.addModalOptions = (modalSection) => {
    modalSection.tab("general", _("General Settings"));
    modalSection.tab("advanced", _("Advanced Settings"));
    if (isFeatureEnabled("wol_mode")) {
      modalSection.tab("project_wol", _("Wake-on-LAN"));
    }
    modalSection.tab("protocol_filter", _("Protocol Filter"));

    {
      // Modal configuration fields
      const o = modalSection.taboption(
        "general",
        form.Value,
        "remark",
        _("Remark"),
      );
      o.modalonly = true;
      o.rmempty = false;
      o.datatype = "string";
      o.validate = (_section_id: string, value: unknown) => {
        if (!value || String(value).trim() === "")
          return _("This field is required");
        return true;
      };
      o.placeholder = "My Project";
    }
    {
      const o = modalSection.taboption(
        "general",
        widgets.ZoneSelect,
        "src_zone",
        _("Source Zones"),
      );
      o.modalonly = true;
      o.multiple = true;
      o.nocreate = false;
      o.allowlocal = false;
      o.default = "wan";
      o.rmempty = true;
    }
    {
      const o = modalSection.taboption(
        "general",
        widgets.ZoneSelect,
        "dest_zone",
        _("Destination Zones"),
      );
      o.modalonly = true;
      o.multiple = true;
      o.nocreate = false;
      o.allowlocal = false;
      o.default = "lan";
      o.rmempty = true;
    }
    {
      const o = modalSection.taboption(
        "general",
        form.ListValue,
        "family",
        _("Address Family"),
      );
      o.modalonly = true;
      o.value("any", _("IPv4 and IPv6"));
      o.value("ipv4", "IPv4");
      o.value("ipv6", "IPv6");
      o.default = "any";
    }
    {
      const o = modalSection.taboption(
        "general",
        form.Value,
        "target_address",
        _("Target Address"),
      );
      o.modalonly = true;
      o.rmempty = false;
      o.datatype = "host";
      o.placeholder = "192.168.1.100";
      o.validate = (_section_id, value) => {
        if (!value || String(value).trim() === "")
          return _("This field is required");
        return true;
      };
    }

    {
      // Port mode switcher
      const o = modalSection.taboption(
        "general",
        form.Flag,
        "use_port_mappings",
        _("Use Port Mappings Mode"),
      );
      o.modalonly = true;
      o.rmempty = true;
      o.default = "0";
      o.description = _(
        "Enable to configure multiple port mappings or port ranges. Disable for single port mode.",
      );
    }
    {
      // Single port mode
      const o = modalSection.taboption(
        "general",
        form.ListValue,
        "protocol",
        _("Protocol"),
      );
      o.modalonly = true;
      o.value("both", _("TCP and UDP"));
      o.value("tcp", "TCP");
      o.value("udp", "UDP");
      o.default = "tcp";
      o.depends("use_port_mappings", "0");
    }
    if (isFeatureEnabled("frpc_mode")) {
      // FRP node selector component factory
      const o = modalSection.taboption(
        "general",
        FrpNodeSelector,
        "frp_nodes",
        _("FRP Tunnels"),
      );
      o.modalonly = true;
      o.rmempty = true;
      o.depends("use_port_mappings", "0");
    }
    {
      // Port Mapping Editor component factory
      const o = modalSection.taboption(
        "general",
        PortMappingEditor,
        "port_mapping",
        _("Port Mappings"),
      );
      o.modalonly = true;
      o.depends("use_port_mappings", "1");
    }
    {
      const o = modalSection.taboption(
        "general",
        form.Value,
        "listen_port",
        _("Listen Port"),
      );
      o.modalonly = true;
      o.datatype = "port";
      o.placeholder = "8080";
      o.depends("use_port_mappings", "0");
      o.validate = (section_id, value) => {
        const use_mappings = uci.get(
          "portweaver",
          section_id,
          "use_port_mappings",
        );
        if (use_mappings !== "1") {
          if (!value || String(value).trim() === "")
            return _("This field is required in single port mode");
        }
        return true;
      };
    }
    {
      const o = modalSection.taboption(
        "general",
        form.Value,
        "target_port",
        _("Target Port"),
      );
      o.modalonly = true;
      o.datatype = "port";
      o.placeholder = "80";
      o.depends("use_port_mappings", "0");
      o.validate = (section_id, value) => {
        const use_mappings = uci.get(
          "portweaver",
          section_id,
          "use_port_mappings",
        );
        if (use_mappings !== "1") {
          if (!value || String(value).trim() === "")
            return _("This field is required in single port mode");
        }
        return true;
      };
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "open_firewall_port",
        _("Open Firewall Port"),
      );
      o.modalonly = true;
      o.default = "1";
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "enable_app_forward",
        _("Enable App Level Forward"),
      );
      o.modalonly = true;
      o.default = "0";
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.ListValue,
        "app_forward_loop_mode",
        _("Event-loop Attachment"),
        _(
          "Selects where this project's listeners are attached. " +
            "Project-shared uses one event loop for this project. " +
            "Listener-dedicated gives every listener its own event loop and thread. " +
            "Globally shared attaches listeners from all projects to one event loop.",
        ),
      );
      o.modalonly = true;
      o.value("per_project", _("Project-shared (default)"));
      o.value("per_listener", _("Listener-dedicated (highest isolation)"));
      o.value("global", _("Globally shared (lowest memory)"));
      o.default = "per_project";
      o.depends("enable_app_forward", "1");
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "reuseaddr",
        _("Reuse Address"),
      );
      o.modalonly = true;
      o.default = "1";
      o.depends("enable_app_forward", "1");
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "enable_app_stats",
        _("Enable App Statistics"),
        _(
          "Collect traffic statistics (bytes_in/bytes_out) for application-layer forwarding using zero-cost atomic counters.",
        ),
      );
      o.modalonly = true;
      o.default = "0";
      o.depends("enable_app_forward", "1");
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "add_firewall_forward",
        _("Add Firewall Forward"),
      );
      o.modalonly = true;
      o.default = "1";
      o.depends({ enable_app_forward: "0" });
      o.depends({ enable_app_forward: "1" });
    }
    {
      const isNftables =
        uci.get("portweaver", "global", "use_nftables") === "1";
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "enable_firewall_stats",
        _("Enable Firewall Statistics"),
        isNftables
          ? _(
              "Collect traffic statistics using nftables kernel counters (extremely low overhead). Requires nftables backend.",
            )
          : _(
              'Collect traffic statistics using nftables kernel counters (extremely low overhead). <strong style="color: #e74c3c;">(Disabled: requires nftables backend enabled in Global Settings)</strong>',
            ),
      );
      o.modalonly = true;
      o.default = "0";
      o.depends("add_firewall_forward", "1");
      if (!isNftables) {
        o.readonly = true;
      }
    }
    {
      const o = modalSection.taboption(
        "advanced",
        form.Flag,
        "preserve_source_ip",
        _("Preserve Source IP"),
        _(
          "Add NAT rules, preserving the source IP address. \nNote: Only effective when 'Add Firewall Forward' is enabled.",
        ),
      );
      o.modalonly = true;
      o.default = "0";
      o.depends("add_firewall_forward", "1");
    }

    // ── Wake-on-LAN ──────────────────────────────────────────────

    if (isFeatureEnabled("wol_mode")) {
      const wolOptions: LuCI.form.AbstractValue[] = [];
      {
        const o = modalSection.taboption(
          "project_wol",
          form.Flag,
          "enable_wol",
          /* i18n */ _("Enable Wake-on-LAN"),
          /* i18n */ _(
            "Wake the selected target before connecting. Choose whether to wake immediately or after a client protocol is recognized.",
          ),
        );
        o.modalonly = true;
        o.default = "0";
        o.rmempty = true;
        wolOptions.push(o);
      }
      {
        const o = modalSection.taboption(
          "project_wol",
          form.ListValue,
          "wol_trigger_mode",
          /* i18n */ _("WoL Trigger Mode"),
          /* i18n */ _(
            "Wake on connection supports sleeping and server-first targets. Wake on protocol waits for a client-first protocol signature before waking.",
          ),
        );
        o.modalonly = true;
        o.default = "on_connect";
        o.rmempty = false;
        o.depends("enable_wol", "1");
        o.value("on_connect", _("On Connection"));
        o.value("on_protocol", _("On Protocol"));
        wolOptions.push(o);
      }
      {
        const o = modalSection.taboption(
          "project_wol",
          form.DynamicList,
          "detect_protocols",
          /* i18n */ _("Detect Protocols"),
          /* i18n */ _(
            "Client-first protocol signatures that trigger WoL. Custom or duplicate values are not allowed.",
          ),
        );
        o.modalonly = true;
        o.rmempty = false;
        o.depends({ enable_wol: "1", wol_trigger_mode: "on_protocol" });
        for (const [value, title] of PROTOCOLS) {
          if (ON_PROTOCOL_WOL_PROTOCOLS.has(value)) o.value(value, title);
        }
        o.validate = (_sectionId: string, value: unknown) =>
          validateProtocolList(value, ON_PROTOCOL_WOL_PROTOCOLS, true);
        wolOptions.push(o);
      }
      {
        const o = modalSection.taboption(
          "project_wol",
          form.ListValue,
          "wol_target",
          /* i18n */ _("WoL Target"),
          /* i18n */ _(
            "Select the global Wake-on-LAN target configuration for this project.",
          ),
        );
        o.modalonly = true;
        o.rmempty = true;
        o.depends("enable_wol", "1");
        o.value("", _("-- Select Target --"));

        const wol_sections = L.uci.sections("portweaver", "wol_target") || [];
        for (const target of wol_sections) {
          const name = target.name || target[".name"];
          if (name && target.enabled !== "0") {
            o.value(String(name), String(name));
          }
        }
        wolOptions.push(o);
      }
      {
        const o = modalSection.taboption(
          "project_wol",
          form.Button,
          "_wol_wake",
          /* i18n */ _("Wake Now"),
        );
        o.modalonly = true;
        o.editable = true;
        o.inputtitle = /* i18n */ _("Wake Now");
        o.depends("enable_wol", "1");
        o.onclick = (_ev: any, section_id: string) => {
          if (hasChanged(wolOptions, section_id)) {
            L.ui.addNotification(
              null,
              <p>
                {_(
                  "Save and reload the changed WoL configuration before waking a target.",
                )}
              </p>,
              "warning",
            );
            return;
          }
          rpcClient
            .wolWake(section_id)
            .then(showWakeResult)
            .catch((err: unknown) => {
              alert(/* i18n */ _(`WoL error: ${String(err)}`));
            });
        };
      }
    }

    // ── Protocol Filter ───────────────────────────────────────────
    let allowedProtocols: LuCI.form.DynamicList;
    {
      const o = modalSection.taboption(
        "protocol_filter",
        form.Flag,
        "enable_protocol_filter",
        /* i18n */ _("Enable Protocol Filter"),
        /* i18n */ _(
          "Reject connections whose detected application-layer protocol is not in the allowed list.",
        ),
      );
      o.modalonly = true;
      o.default = "0";
      o.rmempty = true;
    }
    {
      const o = modalSection.taboption(
        "protocol_filter",
        form.DynamicList,
        "allowed_protocols",
        /* i18n */ _("Allowed Protocols"),
        /* i18n */ _(
          "Only connections matching these protocol signatures will be forwarded.",
        ),
      );
      o.modalonly = true;
      o.rmempty = false;
      o.depends("enable_protocol_filter", "1");
      for (const [value, title] of PROTOCOLS) o.value(value, title);
      o.validate = (_sectionId: string, value: unknown) =>
        validateProtocolList(value, FILTER_PROTOCOLS, true);
      allowedProtocols = o;
    }
    // ── TLS SNI Filter ────────────────────────────────────────────
    {
      const o = modalSection.taboption(
        "protocol_filter",
        form.DynamicList,
        "tls_allowed_snis",
        /* i18n */ _("Allowed TLS SNIs"),
        /* i18n */ _(
          "Only TLS connections matching these server names will be forwarded. Supports wildcards (e.g. *.example.com). Only effective when TLS is in the allowed protocols list.",
        ),
      );
      o.modalonly = true;
      o.rmempty = true;
      o.depends("enable_protocol_filter", "1");
      o.placeholder = "*.example.com";
      o.validate = (sectionId: string, value: unknown) => {
        const snis = stringList(value);
        if (
          snis.length > 0 &&
          !stringList(allowedProtocols.formvalue(sectionId))
            .map((protocol) => protocol.toLowerCase())
            .includes("tls")
        ) {
          return _(
            "Allowed TLS SNIs require TLS in the allowed protocols list.",
          );
        }
        for (const sni of snis) {
          if (
            !/^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
              sni,
            )
          ) {
            return _("Invalid TLS SNI pattern: %s").format(sni);
          }
        }
        return true;
      };
    }
  };
}
