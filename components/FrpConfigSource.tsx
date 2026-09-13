import { createFrpExternalConfigEditor } from "@/components/FrpExternalConfigEditor";
import type { FrpEditorFormat, FrpEditorKind } from "@/utils/frp-editor/monaco";

const form = L.form;

type SourceField = "mode" | "format" | "path";

type FormOption = {
  formvalue(sectionId: string): unknown;
};

class NodeSourceValues {
  private readonly values = new Map<
    string,
    Partial<Record<SourceField, string>>
  >();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(sectionId: string, field: SourceField, fallback: string): string {
    return this.values.get(sectionId)?.[field] || fallback;
  }

  set(sectionId: string, field: SourceField, value: string): void {
    const values = this.values.get(sectionId) || {};
    values[field] = value;
    this.values.set(sectionId, values);
    for (const listener of this.listeners.get(sectionId) || []) listener();
  }

  subscribe(sectionId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(sectionId) || new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(sectionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sectionId);
    };
  }
}

function optionValue(
  option: FormOption,
  sectionId: string,
  fallback: string,
): string {
  const value = option.formvalue(sectionId);
  return typeof value === "string" && value ? value : fallback;
}

/** Add the source fields shown only while editing one FRP node. */
export function addFrpNodeConfigSource(
  section: LuCI.form.GridSection,
  kind: FrpEditorKind,
): void {
  const label = kind.toUpperCase();
  const values = new NodeSourceValues();
  const modeOption = section.option(
    form.ListValue,
    "config_mode",
    _("Configuration Source"),
  );
  modeOption.modalonly = true;
  modeOption.rmempty = false;
  modeOption.default = "builtin";
  modeOption.value("builtin", _("Built-in Configuration"));
  modeOption.value("external_file", _("External File"));
  modeOption.value("external_uci", _("UCI Configuration Text"));
  modeOption.description = _(
    "Choose the configuration source for this %s instance. Switching source clears the inactive external value.",
  ).format(label);
  modeOption.onchange = (
    _element: Element,
    sectionId: string,
    value: unknown,
  ) => values.set(sectionId, "mode", String(value));
  modeOption.write = (sectionId: string, formvalue: string): null => {
    const mode = String(formvalue);
    L.uci.set("portweaver", sectionId, "config_mode", mode);
    if (mode === "external_file") {
      L.uci.unset("portweaver", sectionId, "config_content");
    } else if (mode === "external_uci") {
      L.uci.unset("portweaver", sectionId, "config_path");
    } else {
      L.uci.unset("portweaver", sectionId, "config_path");
      L.uci.unset("portweaver", sectionId, "config_content");
    }
    return null;
  };

  const formatOption = section.option(
    form.ListValue,
    "config_format",
    _("Configuration Format"),
  );
  formatOption.modalonly = true;
  formatOption.rmempty = false;
  formatOption.default = "toml";
  formatOption.value("toml", "TOML");
  formatOption.value("yaml", "YAML");
  formatOption.value("json", "JSON");
  formatOption.depends("config_mode", "external_file");
  formatOption.depends("config_mode", "external_uci");
  formatOption.onchange = (
    _element: Element,
    sectionId: string,
    value: unknown,
  ) => values.set(sectionId, "format", String(value));

  const pathOption = section.option(
    form.Value,
    "config_path",
    _("Configuration File Path"),
  );
  pathOption.modalonly = true;
  pathOption.rmempty = false;
  pathOption.placeholder = `/etc/portweaver/${kind}.toml`;
  pathOption.description = _(
    "Absolute path below the configured FRP configuration root. Parent directories must already exist.",
  );
  pathOption.depends("config_mode", "external_file");
  pathOption.onchange = (
    _element: Element,
    sectionId: string,
    value: unknown,
  ) => values.set(sectionId, "path", String(value));

  const editor = section.option(
    createFrpExternalConfigEditor({
      kind,
      optionName: "config_content",
      getMode: (sectionId) =>
        values.get(
          sectionId,
          "mode",
          optionValue(
            modeOption as unknown as FormOption,
            sectionId,
            "builtin",
          ),
        ),
      getFormat: (sectionId) =>
        values.get(
          sectionId,
          "format",
          optionValue(formatOption as unknown as FormOption, sectionId, "toml"),
        ) as FrpEditorFormat,
      getPath: (sectionId) =>
        values.get(
          sectionId,
          "path",
          optionValue(pathOption as unknown as FormOption, sectionId, ""),
        ),
      subscribeSourceChanges: (sectionId, listener) =>
        values.subscribe(sectionId, listener),
    }),
    "config_content",
    _(`${label} Configuration`),
  );
  editor.modalonly = true;
  editor.rmempty = false;
  editor.depends("config_mode", "external_file");
  editor.depends("config_mode", "external_uci");
}
