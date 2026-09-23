import type {
  LoopTopologyProject,
  LoopTopologyResponse,
  LoopTopologyRuntime,
} from "@/types/portweaver";
import { rpcClient } from "@/utils/rpc-client";
import { getThemeColors } from "@/utils/theme-utils";

export class EventLoopTopology {
  private contentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private refreshButton: HTMLButtonElement | null = null;
  private loading = false;

  render(): HTMLElement {
    const { isDark } = getThemeColors();
    const panelBg = isDark ? "rgba(255, 255, 255, 0.035)" : "#f7f9fc";
    const cardBg = isDark ? "rgba(255, 255, 255, 0.055)" : "#ffffff";
    const border = isDark
      ? "rgba(255, 255, 255, 0.12)"
      : "rgba(22, 50, 79, 0.13)";
    const muted = isDark ? "#aeb8c4" : "#627184";
    const text = isDark ? "#edf2f7" : "#1d2b3a";

    this.statusEl = (
      <span class="pw-loop-status">{_("Loading topology...")}</span>
    ) as HTMLElement;
    this.refreshButton = (
      <button
        type="button"
        class="cbi-button cbi-button-neutral pw-loop-refresh"
        onclick={() => this.loadTopology()}
      >
        {_("Refresh topology")}
      </button>
    ) as HTMLButtonElement;
    this.contentEl = (
      <div class="pw-loop-content">
        <div class="pw-loop-empty">{_("Loading event-loop topology...")}</div>
      </div>
    ) as HTMLElement;

    const container = (
      <div class="pw-loop-topology">
        <style>
          {`
            .pw-loop-topology {
              --pw-loop-panel: ${panelBg};
              --pw-loop-card: ${cardBg};
              --pw-loop-border: ${border};
              --pw-loop-muted: ${muted};
              --pw-loop-text: ${text};
              color: var(--pw-loop-text);
            }
            .pw-loop-toolbar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 14px;
              padding: 12px 14px;
              border: 1px solid var(--pw-loop-border);
              border-radius: 10px;
              background: var(--pw-loop-panel);
            }
            .pw-loop-heading { font-size: 14px; font-weight: 700; }
            .pw-loop-subtitle, .pw-loop-status {
              color: var(--pw-loop-muted);
              font-size: 12px;
              line-height: 1.5;
            }
            .pw-loop-actions { display: flex; align-items: center; gap: 10px; }
            .pw-loop-refresh[disabled] { opacity: 0.55; cursor: wait; }
            .pw-loop-summary {
              display: grid;
              grid-template-columns: repeat(5, minmax(110px, 1fr));
              gap: 9px;
              margin-bottom: 14px;
            }
            .pw-loop-metric {
              padding: 11px 12px;
              border: 1px solid var(--pw-loop-border);
              border-radius: 9px;
              background: var(--pw-loop-card);
            }
            .pw-loop-metric-value { font-size: 19px; font-weight: 750; line-height: 1.2; }
            .pw-loop-metric-label { color: var(--pw-loop-muted); font-size: 11px; margin-top: 3px; }
            .pw-loop-runtime-list { display: grid; gap: 12px; }
            .pw-loop-runtime {
              overflow: hidden;
              border: 1px solid var(--pw-loop-border);
              border-left: 4px solid var(--pw-loop-accent);
              border-radius: 11px;
              background: var(--pw-loop-card);
            }
            .pw-loop-runtime-header {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
              padding: 13px 15px;
              border-bottom: 1px solid var(--pw-loop-border);
              background: var(--pw-loop-panel);
            }
            .pw-loop-runtime-title { font-size: 14px; font-weight: 750; }
            .pw-loop-runtime-meta { color: var(--pw-loop-muted); font-size: 11px; margin-top: 4px; }
            .pw-loop-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
            .pw-loop-badge {
              display: inline-flex;
              align-items: center;
              padding: 3px 8px;
              border-radius: 999px;
              background: color-mix(in srgb, var(--pw-loop-accent) 14%, transparent);
              color: var(--pw-loop-text);
              font-size: 10px;
              font-weight: 650;
              white-space: nowrap;
            }
            .pw-loop-projects { padding: 8px 15px 13px 21px; }
            .pw-loop-project {
              position: relative;
              margin-top: 9px;
              padding: 9px 11px;
              border-left: 2px solid var(--pw-loop-accent);
              background: var(--pw-loop-panel);
              border-radius: 0 8px 8px 0;
            }
            .pw-loop-project::before {
              content: "";
              position: absolute;
              left: -9px;
              top: 18px;
              width: 8px;
              border-top: 2px solid var(--pw-loop-accent);
            }
            .pw-loop-project-title { font-size: 12px; font-weight: 700; }
            .pw-loop-listeners { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .pw-loop-listener {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              padding: 4px 8px;
              border: 1px solid var(--pw-loop-border);
              border-radius: 6px;
              background: var(--pw-loop-card);
              font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
              font-size: 11px;
            }
            .pw-loop-protocol { color: var(--pw-loop-accent); font-weight: 800; }
            .pw-loop-empty {
              padding: 28px 16px;
              border: 1px dashed var(--pw-loop-border);
              border-radius: 10px;
              color: var(--pw-loop-muted);
              text-align: center;
            }
            .pw-loop-error { color: #d64545; }
            @media (max-width: 800px) {
              .pw-loop-summary { grid-template-columns: repeat(2, minmax(110px, 1fr)); }
              .pw-loop-toolbar, .pw-loop-runtime-header { align-items: stretch; flex-direction: column; }
              .pw-loop-actions, .pw-loop-badges { justify-content: flex-start; }
            }
          `}
        </style>
        <div class="pw-loop-toolbar">
          <div>
            <div class="pw-loop-heading">{_("Observed Event-loop Tree")}</div>
            <div class="pw-loop-subtitle">
              {_(
                "Grouped by actual runtime instances. Runtime IDs are process-local and change after a service restart.",
              )}
            </div>
          </div>
          <div class="pw-loop-actions">
            {this.statusEl}
            {this.refreshButton}
          </div>
        </div>
        {this.contentEl}
      </div>
    ) as HTMLElement;

    this.loadTopology();
    return container;
  }

  private loadTopology(): void {
    if (this.loading) return;

    this.loading = true;
    this.setLoading(true);
    rpcClient
      .getLoopTopology()
      .then((topology) => {
        this.renderTopology(topology);
        if (this.statusEl) {
          this.statusEl.textContent = _("Live snapshot");
          this.statusEl.classList.remove("pw-loop-error");
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load event-loop topology:", error);
        this.renderError(error);
      })
      .finally(() => {
        this.loading = false;
        this.setLoading(false);
      });
  }

  private setLoading(loading: boolean): void {
    if (this.refreshButton) this.refreshButton.disabled = loading;
    if (this.statusEl && loading) {
      this.statusEl.textContent = _("Loading topology...");
      this.statusEl.classList.remove("pw-loop-error");
    }
  }

  private renderTopology(topology: LoopTopologyResponse): void {
    if (!this.contentEl) return;

    const runtimes = topology?.runtimes ?? [];
    const summary = (
      <div class="pw-loop-summary">
        {this.metric(String(topology?.generation ?? 0), _("Generation"))}
        {this.metric(topology?.backend || _("Unknown"), _("Backend"))}
        {this.metric(String(topology?.runtime_count ?? 0), _("Runtimes"))}
        {this.metric(String(topology?.project_count ?? 0), _("Projects"))}
        {this.metric(String(topology?.listener_count ?? 0), _("Listeners"))}
      </div>
    ) as HTMLElement;

    if (runtimes.length === 0) {
      this.contentEl.replaceChildren(
        summary,
        (
          <div class="pw-loop-empty">
            {_("No active application-forwarding event loops were found.")}
          </div>
        ) as HTMLElement,
      );
      return;
    }

    const runtimeList = (<div class="pw-loop-runtime-list" />) as HTMLElement;
    for (const runtime of runtimes) {
      runtimeList.appendChild(this.renderRuntime(runtime));
    }
    this.contentEl.replaceChildren(summary, runtimeList);
  }

  private metric(value: string, label: string): HTMLElement {
    return (
      <div class="pw-loop-metric">
        <div class="pw-loop-metric-value">{value}</div>
        <div class="pw-loop-metric-label">{label}</div>
      </div>
    ) as HTMLElement;
  }

  private renderRuntime(runtime: LoopTopologyRuntime): HTMLElement {
    const accent = this.modeAccent(runtime.mode);
    const projects = runtime.projects ?? [];
    const projectList = (<div class="pw-loop-projects" />) as HTMLElement;

    if (projects.length === 0) {
      projectList.appendChild(
        (
          <div class="pw-loop-empty">
            {_("No active listeners are attached to this runtime.")}
          </div>
        ) as HTMLElement,
      );
    } else {
      for (const project of projects) {
        projectList.appendChild(this.renderProject(project));
      }
    }

    return (
      <div class="pw-loop-runtime" style={`--pw-loop-accent: ${accent};`}>
        <div class="pw-loop-runtime-header">
          <div>
            <div class="pw-loop-runtime-title">
              {_("Runtime #%s").format(String(runtime.runtime_id))}
            </div>
            <div class="pw-loop-runtime-meta">
              {_("%d project(s), %d listener(s), %d reference(s)").format(
                runtime.project_count ?? projects.length,
                runtime.listener_count ?? 0,
                runtime.reference_count ?? 0,
              )}
            </div>
          </div>
          <div class="pw-loop-badges">
            <span class="pw-loop-badge">{this.modeLabel(runtime.mode)}</span>
            <span class="pw-loop-badge">{this.stateLabel(runtime.state)}</span>
          </div>
        </div>
        {projectList}
      </div>
    ) as HTMLElement;
  }

  private renderProject(project: LoopTopologyProject): HTMLElement {
    const listeners = project.listeners ?? [];
    const listenerList = (<div class="pw-loop-listeners" />) as HTMLElement;
    for (const listener of listeners) {
      listenerList.appendChild(
        (
          <span class="pw-loop-listener">
            <span class="pw-loop-protocol">
              {(listener.protocol || "?").toUpperCase()}
            </span>
            <span>{String(listener.local_port ?? 0)}</span>
          </span>
        ) as HTMLElement,
      );
    }

    return (
      <div class="pw-loop-project">
        <div class="pw-loop-project-title">
          {project.section_name || _("Unnamed project")}
        </div>
        <div class="pw-loop-runtime-meta">
          {_("Project ID: %s").format(String(project.id))}
        </div>
        {listenerList}
      </div>
    ) as HTMLElement;
  }

  private modeLabel(mode: string): string {
    switch (mode) {
      case "global":
        return _("Globally shared");
      case "per_project":
        return _("Project-shared");
      case "per_listener":
        return _("Listener-dedicated");
      default:
        return mode || _("Unknown mode");
    }
  }

  private stateLabel(state: string): string {
    switch (state) {
      case "starting":
        return _("Starting");
      case "running":
        return _("Running");
      case "stopping":
        return _("Stopping");
      case "stopped":
        return _("Stopped");
      default:
        return state || _("Unknown state");
    }
  }

  private modeAccent(mode: string): string {
    switch (mode) {
      case "global":
        return "#6c63ff";
      case "per_listener":
        return "#e17b31";
      default:
        return "#2188b6";
    }
  }

  private renderError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.statusEl) {
      this.statusEl.textContent = _("Topology unavailable");
      this.statusEl.classList.add("pw-loop-error");
    }
    if (this.contentEl) {
      this.contentEl.replaceChildren(
        (
          <div class="pw-loop-empty pw-loop-error">
            {_("Failed to load event-loop topology: %s").format(message)}
          </div>
        ) as HTMLElement,
      );
    }
  }
}
