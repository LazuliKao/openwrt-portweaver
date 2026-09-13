import {
  createFrpConfigEditor,
  MONACO_SOURCE_OPTIONS,
  type FrpEditorFormat,
  type FrpEditorKind,
  type MonacoSource,
  type MonacoTextEditor,
} from "@/utils/frp-editor/monaco";
import { rpcClient } from "@/utils/rpc-client";

type EditorOptions = {
  kind: FrpEditorKind;
  optionName: string;
  getMode: (sectionId: string) => string;
  getFormat: (sectionId: string) => FrpEditorFormat;
  getPath: (sectionId: string) => string;
  subscribeSourceChanges: (
    sectionId: string,
    listener: () => void,
  ) => () => void;
};

type EditorSession = {
  textarea: HTMLTextAreaElement;
  editor?: MonacoTextEditor;
  editorFormat?: FrpEditorFormat;
  editorRequest: number;
  editorContainer: HTMLElement;
  editorSettings: HTMLElement;
  editorSource: HTMLSelectElement;
  editorButton: HTMLButtonElement;
  fileActions: HTMLElement;
  message: HTMLElement;
  unsubscribe: () => void;
};

class FrpExternalConfigEditor extends L.form.Value {
  private sessions = new Map<string, EditorSession>();

  protected readonly editorOptions!: EditorOptions;

  private getSession(sectionId: string): EditorSession | undefined {
    return this.sessions.get(sectionId);
  }

  private getValue(sectionId: string): string {
    const session = this.getSession(sectionId);
    return session?.editor?.getValue() ?? session?.textarea.value ?? "";
  }

  private setValue(sectionId: string, value: string): void {
    const session = this.getSession(sectionId);
    if (!session) return;
    session.textarea.value = value;
    session.editor?.setValue(value);
  }

  private setMessage(sectionId: string, message: string, color = ""): void {
    const session = this.getSession(sectionId);
    if (!session) return;
    session.message.style.color = color;
    session.message.textContent = message;
  }

  private updateSourceControls(sectionId: string): void {
    const session = this.getSession(sectionId);
    if (!session) return;
    session.fileActions.style.display = this.isFileMode(sectionId)
      ? "flex"
      : "none";
    if (
      session.editor &&
      session.editorFormat !== this.currentFormat(sectionId)
    ) {
      this.startAdvancedEditor(sectionId, session);
    }
  }

  private currentFormat(sectionId: string): FrpEditorFormat {
    return this.editorOptions.getFormat(sectionId);
  }

  private isFileMode(sectionId: string): boolean {
    return this.editorOptions.getMode(sectionId) === "external_file";
  }

  private validateContent(sectionId: string): void {
    this.setMessage(sectionId, _("Validating configuration..."));
    void rpcClient
      .validateFrpConfig(
        this.editorOptions.kind,
        this.currentFormat(sectionId),
        this.getValue(sectionId),
      )
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
    if (!this.isFileMode(sectionId)) {
      this.setMessage(
        sectionId,
        _("File actions are available only for the External File source."),
        "#c60",
      );
      return;
    }
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
      .readFrpConfig(this.editorOptions.kind, path)
      .then((response) => {
        if (!response?.success)
          throw new Error(
            response?.error || _("Unable to load configuration file."),
          );
        this.setValue(sectionId, response.content || "");
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
    if (!this.isFileMode(sectionId)) {
      this.setMessage(
        sectionId,
        _("File actions are available only for the External File source."),
        "#c60",
      );
      return;
    }
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
      .writeFrpConfig(
        this.editorOptions.kind,
        this.currentFormat(sectionId),
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

  private startAdvancedEditor(sectionId: string, session: EditorSession): void {
    const value = session.editor?.getValue() ?? session.textarea.value;
    session.editor?.dispose();
    session.editor = undefined;
    session.editorContainer.replaceChildren();

    const format = this.currentFormat(sectionId);
    const source = session.editorSource.value as MonacoSource;
    const request = ++session.editorRequest;
    session.editorButton.disabled = true;
    session.editorSource.disabled = true;
    this.setMessage(
      sectionId,
      session.editorFormat
        ? _("Updating advanced editor...")
        : _("Loading advanced editor..."),
    );
    void createFrpConfigEditor(
      session.editorContainer,
      () => value,
      (value) => {
        session.textarea.value = value;
      },
      this.editorOptions.kind,
      format,
      source,
    )
      .then((editor) => {
        if (
          this.getSession(sectionId) !== session ||
          !session.editorContainer.isConnected ||
          session.editorRequest !== request
        ) {
          editor.dispose();
          return;
        }
        if (this.currentFormat(sectionId) !== format) {
          editor.dispose();
          this.startAdvancedEditor(sectionId, session);
          return;
        }
        session.editor = editor;
        session.editorFormat = format;
        session.textarea.style.display = "none";
        session.editorContainer.style.display = "block";
        session.editorSettings.style.display = "none";
        this.setMessage(sectionId, "");
      })
      .catch((error: unknown) => {
        console.error("Failed to load advanced editor:", error);
        if (error instanceof Error && error.cause) {
          console.error("Caused by:", error.cause);
        }
        if (
          this.getSession(sectionId) !== session ||
          session.editorRequest !== request
        )
          return;
        session.editorButton.disabled = false;
        session.editorSource.disabled = false;
        session.editorSettings.style.display = "";
        session.textarea.style.display = "";
        session.editorContainer.style.display = "none";
        this.setMessage(
          sectionId,
          _(
            "Advanced editor could not be loaded; using the plain text editor.",
          ),
          "#c60",
        );
      });
  }

  private enableEditor(sectionId: string): void {
    const session = this.getSession(sectionId);
    if (!session) return;
    this.startAdvancedEditor(sectionId, session);
  }

  renderWidget(sectionId: string, _optionIndex: number, cfgvalue: string) {
    const previousSession = this.sessions.get(sectionId);
    previousSession?.unsubscribe();
    previousSession?.editor?.dispose();
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
    const editorSource = (
      <select class="cbi-input-select"></select>
    ) as HTMLSelectElement;
    editorSource.replaceChildren(
      ...MONACO_SOURCE_OPTIONS.map((source) => (
        <option value={source.value}>{source.label}</option>
      )),
    );
    const editorSettings = (
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:0.75em;">
        <span>{_("Advanced editor source")}</span>
        {editorSource}
        {editorButton}
      </div>
    ) as HTMLElement;
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
      editorContainer,
      editorSettings,
      editorSource,
      editorButton,
      editorRequest: 0,
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
    editorButton.onclick = () => this.enableEditor(sectionId);
    loadButton.onclick = () => this.loadFile(sectionId);
    validateButton.onclick = () => this.validateContent(sectionId);
    saveButton.onclick = () => this.saveFile(sectionId, false);
    saveReloadButton.onclick = () => this.saveFile(sectionId, true);

    return (
      <div class="cbi-value-field">
        <p style="margin-top:0;">
          {_(
            "JSON and YAML provide schema validation and completion. TOML provides schema-based option completion; saving always uses the official FRP validator.",
          )}
        </p>
        {editorSettings}
        {textarea}
        {editorContainer}
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
