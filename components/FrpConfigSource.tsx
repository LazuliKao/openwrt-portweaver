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

/** Add the source fields shown only while editing one FRP node. */
export function addFrpNodeConfigSource(
  section: LuCI.form.GridSection,
  kind: FrpEditorKind,
): void {
  const label = kind.toUpperCase();
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

  const editor = section.option(
    createFrpExternalConfigEditor({
      kind,
      optionName: "config_content",
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
    "config_content",
    _(`${label} Configuration`),
  );
  editor.modalonly = true;
  editor.rmempty = false;
  editor.depends("config_mode", "external_file");
  editor.depends("config_mode", "external_uci");
}
