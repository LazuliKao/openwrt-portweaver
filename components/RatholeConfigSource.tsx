import type { RatholeMode } from "@/types/portweaver/rathole";
import { rpcClient } from "@/utils/rpc-client";

const form = L.form;

type SourceField = "mode" | "path";

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

function uciOptionValue(
  sectionId: string,
  optionName: string,
  fallback: string,
): string {
  const value = L.uci.get("portweaver", sectionId, optionName);
  return typeof value === "string" && value ? value : fallback;
}

type EditorOptions = {
  mode: RatholeMode;
  getMode: (sectionId: string) => string;
  getPath: (sectionId: string) => string;
  subscribeSourceChanges: (
    sectionId: string,
    listener: () => void,
  ) => () => void;
};

type EditorSession = {
  textarea: HTMLTextAreaElement;
  fileActions: HTMLElement;
  message: HTMLElement;
  unsubscribe: () => void;
};

class RatholeConfigEditor extends L.form.Value {
  private sessions = new Map<string, EditorSession>();
  protected readonly editorOptions!: EditorOptions;

  private getValue(sectionId: string): string {
    return this.sessions.get(sectionId)?.textarea.value || "";
  }

  private setMessage(sectionId: string, message: string, color = ""): void {
    const session = this.sessions.get(sectionId);
    if (!session) return;
    session.message.style.color = color;
    session.message.textContent = message;
  }

  private updateSourceControls(sectionId: string): void {
    const session = this.sessions.get(sectionId);
    if (!session) return;
    session.fileActions.style.display =
      this.editorOptions.getMode(sectionId) === "external_file"
        ? "flex"
        : "none";
  }

  private validate(sectionId: string): void {
    this.setMessage(sectionId, _("Validating configuration..."));
    void rpcClient
      .validateRatholeConfig(this.editorOptions.mode, this.getValue(sectionId))
      .then((response) => {
        if (!response?.success)
          throw new Error(response?.error || _("Configuration is invalid."));
        this.setMessage(sectionId, _("Configuration is valid."), "#1a7f37");
      })
      .catch((error: unknown) => {
        this.setMessage(
          sectionId,
          error instanceof Error
            ? error.message
            : _("Configuration validation failed."),
          "#cf222e",
        );
      });
  }

  private loadFile(sectionId: string): void {
    const path = this.editorOptions.getPath(sectionId).trim();
    if (!path) {
      this.setMessage(
        sectionId,
        _("Enter a configuration file path first."),
        "#cf222e",
      );
      return;
    }
    this.setMessage(sectionId, _("Loading configuration file..."));
    void rpcClient
      .readRatholeConfig(this.editorOptions.mode, path)
      .then((response) => {
        if (!response?.success)
          throw new Error(
            response?.error || _("Unable to load configuration file."),
          );
        const session = this.sessions.get(sectionId);
        if (session) session.textarea.value = response.content || "";
        this.setMessage(sectionId, _("Configuration file loaded."), "#1a7f37");
      })
      .catch((error: unknown) => {
        this.setMessage(
          sectionId,
          error instanceof Error
            ? error.message
            : _("Unable to load configuration file."),
          "#cf222e",
        );
      });
  }

  private saveFile(sectionId: string, reload: boolean): void {
    const path = this.editorOptions.getPath(sectionId).trim();
    if (!path) {
      this.setMessage(
        sectionId,
        _("Enter a configuration file path first."),
        "#cf222e",
      );
      return;
    }
    this.setMessage(
      sectionId,
      reload ? _("Saving and reloading...") : _("Saving configuration file..."),
    );
    void rpcClient
      .writeRatholeConfig(
        this.editorOptions.mode,
        path,
        this.getValue(sectionId),
        reload,
      )
      .then((response) => {
        if (!response?.success)
          throw new Error(
            response?.error || _("Unable to save configuration file."),
          );
        this.setMessage(
          sectionId,
          reload
            ? _("Configuration file saved and reload requested.")
            : _("Configuration file saved."),
          "#1a7f37",
        );
      })
      .catch((error: unknown) => {
        this.setMessage(
          sectionId,
          error instanceof Error
            ? error.message
            : _("Unable to save configuration file."),
          "#cf222e",
        );
      });
  }

  renderWidget(sectionId: string, _optionIndex: number, cfgvalue: string) {
    this.sessions.get(sectionId)?.unsubscribe();
    const textarea = (
      <textarea
        class="cbi-input-text"
        rows={18}
        spellcheck={false}
        wrap="off"
        style="box-sizing: border-box; font-family: monospace; resize: vertical; width: 100%;"
      >
        {cfgvalue || ""}
      </textarea>
    ) as HTMLTextAreaElement;
    const loadButton = (
      <button type="button" class="cbi-button cbi-button-action">
        {_("Load File")}
      </button>
    ) as HTMLButtonElement;
    const validateButton = (
      <button type="button" class="cbi-button cbi-button-apply">
        {_("Validate")}
      </button>
    ) as HTMLButtonElement;
    const saveButton = (
      <button type="button" class="cbi-button cbi-button-save">
        {_("Save File")}
      </button>
    ) as HTMLButtonElement;
    const saveReloadButton = (
      <button type="button" class="cbi-button cbi-button-apply">
        {_("Save File & Reload")}
      </button>
    ) as HTMLButtonElement;
    const fileActions = (
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:0.75em;">
        {loadButton}
        {saveButton}
        {saveReloadButton}
      </div>
    ) as HTMLElement;
    const message = (
      <div style="min-height:1.2em; margin-top:0.75em;"></div>
    ) as HTMLElement;
    const session: EditorSession = {
      textarea,
      fileActions,
      message,
      unsubscribe: () => {},
    };
    session.unsubscribe = this.editorOptions.subscribeSourceChanges(
      sectionId,
      () => this.updateSourceControls(sectionId),
    );
    this.sessions.set(sectionId, session);
    this.updateSourceControls(sectionId);
    loadButton.onclick = () => this.loadFile(sectionId);
    validateButton.onclick = () => this.validate(sectionId);
    saveButton.onclick = () => this.saveFile(sectionId, false);
    saveReloadButton.onclick = () => this.saveFile(sectionId, true);

    return (
      <div class="cbi-value-field">
        <p style="margin-top:0;">
          {_("Rathole accepts TOML only. Validate before saving or reloading.")}
        </p>
        {textarea}
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:0.75em;">
          {validateButton}
        </div>
        {fileActions}
        {message}
      </div>
    );
  }

  formvalue(sectionId: string): string {
    return this.getValue(sectionId);
  }

  write(sectionId: string, formvalue: string): null {
    if (this.editorOptions.getMode(sectionId) === "external_uci") {
      L.uci.set("portweaver", sectionId, "config_content", formvalue);
    } else {
      L.uci.unset("portweaver", sectionId, "config_content");
    }
    return null;
  }
}

/** Adds the mutually exclusive built-in and external TOML source controls. */
export function addRatholeNodeConfigSource(
  section: LuCI.form.GridSection,
  mode: RatholeMode,
): void {
  const values = new NodeSourceValues();
  const source = section.option(
    form.ListValue,
    "config_mode",
    _("Configuration Source"),
  );
  source.modalonly = true;
  source.rmempty = false;
  source.default = "builtin";
  source.value("builtin", _("Built-in Configuration"));
  source.value("external_file", _("External TOML File"));
  source.value("external_uci", _("UCI TOML Text"));
  source.description = _(
    "External TOML replaces this node's built-in settings and services. Existing built-in values are retained for later use.",
  );
  source.onchange = (_element: Element, sectionId: string, value: unknown) =>
    values.set(sectionId, "mode", String(value));
  source.write = (sectionId: string, formvalue: string): null => {
    const selected = String(formvalue);
    L.uci.set("portweaver", sectionId, "config_mode", selected);
    if (selected === "external_file")
      L.uci.unset("portweaver", sectionId, "config_content");
    else if (selected === "external_uci")
      L.uci.unset("portweaver", sectionId, "config_path");
    else {
      L.uci.unset("portweaver", sectionId, "config_path");
      L.uci.unset("portweaver", sectionId, "config_content");
    }
    return null;
  };

  const path = section.option(form.Value, "config_path", _("TOML File Path"));
  path.modalonly = true;
  path.rmempty = false;
  path.placeholder = `/etc/portweaver/rathole-${mode}.toml`;
  path.description = _(
    "Absolute .toml path below the configured external configuration root. Parent directories must already exist.",
  );
  path.depends("config_mode", "external_file");
  path.onchange = (_element: Element, sectionId: string, value: unknown) =>
    values.set(sectionId, "path", String(value));

  const editor = section.option(
    class extends RatholeConfigEditor {
      protected override readonly editorOptions = {
        mode,
        getMode: (sectionId: string) =>
          values.get(
            sectionId,
            "mode",
            uciOptionValue(sectionId, "config_mode", "builtin"),
          ),
        getPath: (sectionId: string) =>
          values.get(
            sectionId,
            "path",
            uciOptionValue(sectionId, "config_path", ""),
          ),
        subscribeSourceChanges: (sectionId, listener) =>
          values.subscribe(sectionId, listener),
      };
    } as unknown as typeof L.form.Value,
    "config_content",
    _("Rathole TOML Configuration"),
  );
  editor.modalonly = true;
  editor.rmempty = false;
  editor.depends("config_mode", "external_file");
  editor.depends("config_mode", "external_uci");
}
