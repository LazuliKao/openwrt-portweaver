import { createFrpExternalConfigEditor } from "@/components/FrpExternalConfigEditor";
import type { FrpEditorFormat, FrpEditorKind } from "@/utils/frp-editor/monaco";

const form = L.form;

type FormOption = {
  formvalue(sectionId: string): unknown;
};

function optionValue(
  option: FormOption,
  sectionId: string,
  fallback: string,
): string {
  const value = option.formvalue(sectionId);
  return typeof value === "string" && value ? value : fallback;
}

export function addFrpConfigSource(
  section: LuCI.form.NamedSection,
  tabId: string,
  kind: FrpEditorKind,
): void {
  const prefix = kind === "frpc" ? "frpc" : "frps";
  const label = kind.toUpperCase();
  const modeOption = section.taboption(
    tabId,
    form.ListValue,
    `${prefix}_config_mode`,
    _("Configuration Source"),
  );
  modeOption.rmempty = false;
  modeOption.default = "builtin";
  modeOption.value("builtin", _("Built-in Nodes"));
  modeOption.value("external_file", _("External File"));
  modeOption.value("external_uci", _("UCI Configuration Text"));
  modeOption.description = _(
    "External sources use the official %s configuration format and replace all built-in nodes.",
  ).format(label);
  modeOption.write = (sectionId: string, formvalue: string): null => {
    const mode = String(formvalue);
    L.uci.set("portweaver", sectionId, `${prefix}_config_mode`, mode);
    if (mode === "external_file") {
      L.uci.unset("portweaver", sectionId, `${prefix}_config_content`);
    } else if (mode === "external_uci") {
      L.uci.unset("portweaver", sectionId, `${prefix}_config_path`);
    } else {
      L.uci.unset("portweaver", sectionId, `${prefix}_config_path`);
      L.uci.unset("portweaver", sectionId, `${prefix}_config_content`);
    }
    return null;
  };

  const formatOption = section.taboption(
    tabId,
    form.ListValue,
    `${prefix}_config_format`,
    _("Configuration Format"),
  );
  formatOption.rmempty = false;
  formatOption.default = "toml";
  formatOption.value("toml", "TOML");
  formatOption.value("yaml", "YAML");
  formatOption.value("json", "JSON");
  formatOption.depends(`${prefix}_config_mode`, "external_file");
  formatOption.depends(`${prefix}_config_mode`, "external_uci");

  const pathOption = section.taboption(
    tabId,
    form.Value,
    `${prefix}_config_path`,
    _("Configuration File Path"),
  );
  pathOption.rmempty = false;
  pathOption.placeholder = `/etc/portweaver/${prefix}.toml`;
  pathOption.description = _(
    "Absolute path below the configured FRP configuration root. Existing parent directories only.",
  );
  pathOption.depends(`${prefix}_config_mode`, "external_file");

  const editor = section.taboption(
    tabId,
    createFrpExternalConfigEditor({
      kind,
      optionName: `${prefix}_config_content`,
      getMode: (sectionId) =>
        optionValue(modeOption as unknown as FormOption, sectionId, "builtin"),
      getFormat: (sectionId) =>
        optionValue(
          formatOption as unknown as FormOption,
          sectionId,
          "toml",
        ) as FrpEditorFormat,
      getPath: (sectionId) =>
        optionValue(pathOption as unknown as FormOption, sectionId, ""),
    }),
    `${prefix}_config_content`,
    _(`${label} Configuration`),
  );
  editor.rmempty = false;
  editor.depends(`${prefix}_config_mode`, "external_file");
  editor.depends(`${prefix}_config_mode`, "external_uci");
}
