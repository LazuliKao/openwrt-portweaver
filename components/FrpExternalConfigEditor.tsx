import {
  createFrpConfigEditor,
  type FrpEditorFormat,
  type FrpEditorKind,
  type MonacoTextEditor,
} from "@/utils/frp-editor/monaco";
import { rpcClient } from "@/utils/rpc-client";

type EditorOptions = {
  kind: FrpEditorKind;
  optionName: string;
  getMode: (sectionId: string) => string;
  getFormat: (sectionId: string) => FrpEditorFormat;
  getPath: (sectionId: string) => string;
};

class FrpExternalConfigEditor extends L.form.Value {
  private textarea?: HTMLTextAreaElement;
  private editor?: MonacoTextEditor;
  private editorContainer?: HTMLElement;
  private editorButton?: HTMLButtonElement;
  private message?: HTMLElement;

  protected readonly editorOptions!: EditorOptions;

  private getValue(): string {
    return this.editor?.getValue() ?? this.textarea?.value ?? "";
  }

  private setValue(value: string): void {
    if (this.textarea) this.textarea.value = value;
    this.editor?.setValue(value);
  }

  private setMessage(message: string, color = ""): void {
    if (!this.message) return;
    this.message.style.color = color;
    this.message.textContent = message;
  }

  private currentFormat(sectionId: string): FrpEditorFormat {
    return this.editorOptions.getFormat(sectionId);
  }

  private isFileMode(sectionId: string): boolean {
    return this.editorOptions.getMode(sectionId) === "external_file";
  }

  private validateContent(sectionId: string): void {
    this.setMessage(_("Validating configuration..."));
    void rpcClient
      .validateFrpConfig(
        this.editorOptions.kind,
        this.currentFormat(sectionId),
        this.getValue(),
      )
      .then((response) => {
        if (!response?.success)
          throw new Error(response?.error || _("Configuration is invalid."));
        this.setMessage(_("Configuration is valid."), "#1a7f37");
      })
      .catch((error: unknown) => {
        this.setMessage(
          error instanceof Error
            ? error.message
            : _("Configuration validation failed."),
          "#cf222e",
        );
      });
  }

  private loadFile(sectionId: string): void {
    if (!this.isFileMode(sectionId)) {
      this.setMessage(
        _("File actions are available only for the External File source."),
        "#c60",
      );
      return;
    }
    const path = this.editorOptions.getPath(sectionId).trim();
    if (!path) {
      this.setMessage(_("Enter a configuration file path first."), "#cf222e");
      return;
    }
    this.setMessage(_("Loading configuration file..."));
    void rpcClient
      .readFrpConfig(this.editorOptions.kind, path)
      .then((response) => {
        if (!response?.success)
          throw new Error(
            response?.error || _("Unable to load configuration file."),
          );
        this.setValue(response.content || "");
        this.setMessage(_("Configuration file loaded."), "#1a7f37");
      })
      .catch((error: unknown) => {
        this.setMessage(
          error instanceof Error
            ? error.message
            : _("Unable to load configuration file."),
          "#cf222e",
        );
      });
  }

  private saveFile(sectionId: string, reload: boolean): void {
    if (!this.isFileMode(sectionId)) {
      this.setMessage(
        _("File actions are available only for the External File source."),
        "#c60",
      );
      return;
    }
    const path = this.editorOptions.getPath(sectionId).trim();
    if (!path) {
      this.setMessage(_("Enter a configuration file path first."), "#cf222e");
      return;
    }
    this.setMessage(
      reload ? _("Saving and reloading...") : _("Saving configuration file..."),
    );
    void rpcClient
      .writeFrpConfig(
        this.editorOptions.kind,
        this.currentFormat(sectionId),
        path,
        this.getValue(),
        reload,
      )
      .then((response) => {
        if (!response?.success)
          throw new Error(
            response?.error || _("Unable to save configuration file."),
          );
        this.setMessage(
          reload
            ? _("Configuration file saved and reload requested.")
            : _("Configuration file saved."),
          "#1a7f37",
        );
      })
      .catch((error: unknown) => {
        this.setMessage(
          error instanceof Error
            ? error.message
            : _("Unable to save configuration file."),
          "#cf222e",
        );
      });
  }

  private enableEditor(sectionId: string): void {
    if (!this.editorButton || !this.editorContainer || !this.textarea) return;
    this.editorButton.disabled = true;
    this.setMessage(_("Loading advanced editor..."));
    void createFrpConfigEditor(
      this.editorContainer,
      () => this.textarea?.value || "",
      (value) => {
        if (this.textarea) this.textarea.value = value;
      },
      this.editorOptions.kind,
      this.currentFormat(sectionId),
    )
      .then((editor) => {
        if (!this.editorContainer?.isConnected) {
          editor.dispose();
          return;
        }
        this.editor = editor;
        if (this.textarea) this.textarea.style.display = "none";
        if (this.editorContainer) this.editorContainer.style.display = "block";
        if (this.editorButton) this.editorButton.style.display = "none";
        this.setMessage("");
      })
      .catch(() => {
        if (this.editorButton) this.editorButton.disabled = false;
        this.setMessage(
          _(
            "Advanced editor could not be loaded; using the plain text editor.",
          ),
          "#c60",
        );
      });
  }

  renderWidget(sectionId: string, _optionIndex: number, cfgvalue: string) {
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
    const editorContainer = (
      <div style="display:none; height:36em;"></div>
    ) as HTMLElement;
    const editorButton = (
      <button type="button" class="cbi-button cbi-button-action">
        {_("Enable advanced editor")}
      </button>
    ) as HTMLButtonElement;
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
    const message = (
      <div style="min-height:1.2em; margin-top:0.75em;"></div>
    ) as HTMLElement;

    this.textarea = textarea;
    this.editorContainer = editorContainer;
    this.editorButton = editorButton;
    this.message = message;
    editorButton.onclick = () => this.enableEditor(sectionId);
    loadButton.onclick = () => this.loadFile(sectionId);
    validateButton.onclick = () => this.validateContent(sectionId);
    saveButton.onclick = () => this.saveFile(sectionId, false);
    saveReloadButton.onclick = () => this.saveFile(sectionId, true);

    return (
      <div class="cbi-value-field">
        <p style="margin-top:0;">
          {_(
            "Use the advanced editor for JSON schema validation and completion. YAML and TOML receive schema-based option completion; saving always uses the official FRP validator.",
          )}
        </p>
        <div style="margin-bottom:0.75em;">{editorButton}</div>
        {textarea}
        {editorContainer}
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:0.75em;">
          {loadButton}
          {validateButton}
          {saveButton}
          {saveReloadButton}
        </div>
        {message}
      </div>
    );
  }

  formvalue(_sectionId: string): string {
    return this.getValue();
  }

  write(sectionId: string, formvalue: string): null {
    if (this.editorOptions.getMode(sectionId) === "external_uci") {
      L.uci.set(
        "portweaver",
        sectionId,
        this.editorOptions.optionName,
        formvalue,
      );
    } else {
      L.uci.unset("portweaver", sectionId, this.editorOptions.optionName);
    }
    return null;
  }
}

export function createFrpExternalConfigEditor(
  options: EditorOptions,
): typeof L.form.Value {
  return class extends FrpExternalConfigEditor {
    protected override readonly editorOptions = options;
  } as unknown as typeof L.form.Value;
}
