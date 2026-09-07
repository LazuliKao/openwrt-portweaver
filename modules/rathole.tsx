import { LogViewerDialog } from "@/components/LogViewerDialog";
import type { RatholeMode } from "@/types/portweaver/rathole";
import { rpcClient } from "@/utils/rpc-client";

const form = L.form;

class RatholeNodeStatus {
  private statusEl: HTMLElement | null = null;

  constructor(
    private mode: RatholeMode,
    private name: string,
  ) {}

  private refresh(): void {
    rpcClient
      .getRatholeInfo(this.mode, this.name)
      .then((info) => {
        if (this.statusEl) {
          this.statusEl.textContent = `${info?.status || "unavailable"}${info?.last_error ? `: ${info.last_error}` : ""}`;
        }
      })
      .catch((err: unknown) => {
        console.warn("Rathole status failed", err);
        if (this.statusEl) this.statusEl.textContent = _("Unavailable");
      });
  }

  render(): HTMLElement {
    this.statusEl = <span>{_("Loading...")}</span>;
    const result = (
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        {this.statusEl}
        <button type="button" class="cbi-button" onclick={() => this.refresh()}>
          {_("Refresh")}
        </button>
        <button
          type="button"
          class="cbi-button"
          onclick={() => {
            new LogViewerDialog({
              name: this.name,
              title: _("Rathole Lifecycle Logs"),
              fetcher: () => rpcClient.getRatholeInfo(this.mode, this.name),
              clearer: () => rpcClient.clearRatholeLogs(this.mode, this.name),
            }).open();
          }}
        >
          {_("View Logs")}
        </button>
      </div>
    );
    this.refresh();
    return result;
  }
}

export default function rathole(
  s: LuCI.form.NamedSection,
  mode: RatholeMode,
): void {
  const tab = `rathole_${mode}`;
  const nodeType = `${tab}_node`;
  const nodes = s.taboption(
    tab,
    form.SectionValue,
    `_${nodeType}`,
    form.GridSection,
    nodeType,
  ).subsection as LuCI.form.GridSection;
  nodes.anonymous = true;
  nodes.addremove = true;
  nodes.sectiontitle = (id: string) =>
    String(L.uci.get("portweaver", id, "name") || id);

  const enabled = nodes.option(form.Flag, "enabled", _("Enable"));
  enabled.default = "1";
  enabled.rmempty = false;
  const name = nodes.option(form.Value, "name", _("Node Name"));
  name.rmempty = false;
  name.validate = (id: string, value: unknown) => {
    const text = String(value || "");
    if (!/^[a-zA-Z0-9_-]+$/.test(text))
      return _("Use letters, numbers, underscore or hyphen");
    const duplicate = L.uci
      .sections("portweaver", nodeType)
      .some((section) => section[".name"] !== id && section.name === text);
    return duplicate ? _("Node name must be unique") : true;
  };
  const endpoint = nodes.option(
    form.Value,
    mode === "client" ? "remote_addr" : "bind_addr",
    mode === "client"
      ? _("Server Address:Port")
      : _("Control Bind Address:Port"),
  );
  endpoint.rmempty = false;
  endpoint.placeholder =
    mode === "client" ? "example.com:2333" : "0.0.0.0:2333";
  const token = nodes.option(
    form.Value,
    "default_token",
    _("Default Service Token"),
  );
  token.password = true;
  token.description = _(
    "Each enabled service requires its own token or this default. TCP transport is not encrypted; use Noise on untrusted networks.",
  );
  const transport = nodes.option(form.ListValue, "transport", _("Transport"));
  transport.value("tcp", "TCP");
  transport.value("noise", "Noise (NK)");
  transport.default = "tcp";
  const key = nodes.option(
    form.Value,
    mode === "client" ? "noise_remote_public_key" : "noise_local_private_key",
    mode === "client" ? _("Server Public Key") : _("Server Private Key"),
  );
  key.depends("transport", "noise");
  key.rmempty = false;
  key.password = mode === "server";
  const status = nodes.option(
    form.DummyValue,
    "_rathole_status",
    _("Lifecycle Status"),
  );
  status.description = _(
    "Running means the task is active, not that every service is connected. Logs currently contain lifecycle events only.",
  );
  status.textvalue = (id: string) =>
    new RatholeNodeStatus(
      mode,
      String(L.uci.get("portweaver", id, "name") || id),
    ).render();

  const serviceType = `${tab}_service`;
  const services = s.taboption(
    tab,
    form.SectionValue,
    `_${serviceType}`,
    form.GridSection,
    serviceType,
  ).subsection as LuCI.form.GridSection;
  services.anonymous = true;
  services.addremove = true;
  const serviceEnabled = services.option(form.Flag, "enabled", _("Enable"));
  serviceEnabled.default = "1";
  serviceEnabled.rmempty = false;
  const node = services.option(form.ListValue, "node", _("Node"));
  node.rmempty = false;
  for (const section of L.uci.sections("portweaver", nodeType)) {
    const nodeName = String(section.name || section[".name"]);
    node.value(nodeName, nodeName);
  }
  node.description = _(
    "Save newly created nodes before adding their services.",
  );
  const serviceName = services.option(
    form.Value,
    "service_name",
    _("Service Name"),
  );
  serviceName.rmempty = false;
  serviceName.description = _(
    "Client and server must preconfigure the same service name, protocol and token. Public ports are configured on the server.",
  );
  const protocol = services.option(form.ListValue, "protocol", _("Protocol"));
  protocol.value("tcp", "TCP");
  protocol.value("udp", "UDP");
  protocol.default = "tcp";
  const serviceToken = services.option(form.Value, "token", _("Service Token"));
  serviceToken.password = true;
  if (mode === "client") {
    const project = services.option(
      form.ListValue,
      "project",
      _("Target Project"),
    );
    project.value("", _("Explicit Target"));
    for (const section of L.uci.sections("portweaver", "project"))
      project.value(section[".name"], String(section.name || section[".name"]));
    const targetPort = services.option(
      form.Value,
      "project_target_port",
      _("Project Target Port"),
    );
    targetPort.datatype = "port";
    targetPort.description = _(
      "With a project reference, leave explicit target fields empty. Specify this port for projects with multiple ports.",
    );
  }
  const address = services.option(
    form.Value,
    mode === "client" ? "local_address" : "bind_address",
    mode === "client" ? _("Explicit Target Address") : _("Public Bind Address"),
  );
  address.datatype = "host";
  address.rmempty = mode === "client";
  const port = services.option(
    form.Value,
    mode === "client" ? "local_port" : "bind_port",
    mode === "client" ? _("Explicit Target Port") : _("Public Port"),
  );
  port.datatype = "port";
  port.rmempty = mode === "client";
}
