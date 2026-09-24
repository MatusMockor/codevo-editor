import { ChevronDown, Play, Plus, RefreshCw, Square } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type {
  AgentProjectActionRow,
  AgentScriptRow,
  AgentScriptRowState,
  AgentScriptsManifest,
} from "../../../../application/rightPanel/agentScriptsSurfaceModel";
import type { VscodeProcessTaskIdentity } from "../../../../domain/vscodeProcessTasks";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import { StatusLabel } from "../../../../ui/foundation/StatusLabel";
import "./agentScripts.css";

export type AgentScriptsConfigurationAction = "create" | "open";

export interface AgentScriptsSurfaceProps {
  readonly manifests: ReadonlyArray<AgentScriptsManifest>;
  readonly selectedManifest: string | null;
  readonly rows: ReadonlyArray<AgentScriptRow>;
  readonly truncated: boolean;
  readonly actions: ReadonlyArray<AgentProjectActionRow> | null;
  readonly configurationAction: AgentScriptsConfigurationAction | null;
  readonly actionsRunInProjectRoot: boolean;
  onSelectManifest(relativePath: string): void;
  onReload(): void;
  onRun(key: string): void;
  onStop(): void;
  onShowOutput(): void;
  onRunAction(identity: VscodeProcessTaskIdentity): void;
  onStopAction(): void;
  onConfigureActions(): void;
}

export function AgentScriptsSurface(props: AgentScriptsSurfaceProps) {
  const note = scriptsNote(props.rows.length, props.truncated);
  const actions = props.actions ?? [];
  return (
    <section aria-label="Scripts" className="cv-scripts-surface">
      <div className="cv-rp-sub">
        <div className="cv-rp-sub__grow">
          <ManifestControl
            manifests={props.manifests}
            onSelect={props.onSelectManifest}
            selected={props.selectedManifest}
          />
        </div>
        <div className="cv-rp-sub__tools">
          <IconButton
            icon={<RefreshCw size={14} />}
            label="Reload scripts"
            onClick={props.onReload}
            size="xs"
          />
        </div>
      </div>
      <div className="cv-scripts">
        {props.rows.map((row) => (
          <ScriptRow
            key={row.key}
            onRun={props.onRun}
            onShowOutput={props.onShowOutput}
            onStop={props.onStop}
            row={row}
          />
        ))}
        {note !== null && <p className="cv-scripts__note">{note}</p>}
        {actions.length > 0 && (
          <h3 className="cv-scripts__group">
            Project actions
            {props.actionsRunInProjectRoot && (
              <span className="cv-scripts__group-hint">Runs in project root</span>
            )}
          </h3>
        )}
        {actions.map((action) => (
          <ActionRow
            action={action}
            key={action.id}
            onRun={props.onRunAction}
            onStop={props.onStopAction}
          />
        ))}
        {props.actions !== null && props.configurationAction !== null && (
          <button className="cv-scripts__add" onClick={props.onConfigureActions} type="button">
            <Plus aria-hidden="true" size={14} />
            Add action
          </button>
        )}
      </div>
    </section>
  );
}

function ManifestControl(props: {
  readonly manifests: ReadonlyArray<AgentScriptsManifest>;
  readonly selected: string | null;
  onSelect(relativePath: string): void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const current = props.manifests.find((manifest) => manifest.relativePath === props.selected);
  const label = current?.label ?? "package.json";
  if (props.manifests.length < 2) {
    return (
      <span className="cv-scripts__manifest" title={label}>
        {label}
      </span>
    );
  }
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Package: ${label}`}
        className="cv-rp-ctl cv-scripts__manifest-button"
        onClick={() => setOpen((value) => !value)}
        ref={anchorRef}
        title={label}
        type="button"
      >
        <span className="cv-scripts__manifest">{label}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <Menu anchorRef={anchorRef} label="Package" onClose={() => setOpen(false)} open={open}>
        {props.manifests.map((manifest) => (
          <MenuItem
            checked={manifest.relativePath === props.selected}
            key={manifest.relativePath}
            onSelect={() => props.onSelect(manifest.relativePath)}
          >
            {manifest.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function ScriptRow(props: {
  readonly row: AgentScriptRow;
  onRun(key: string): void;
  onStop(): void;
  onShowOutput(): void;
}) {
  const { row } = props;
  const running = row.state.kind === "running";
  const stoppable = row.state.kind === "running" && row.state.stoppable;
  const disabled = running ? !stoppable : row.blockedReason !== null;
  return (
    <div className="cv-script-row" data-kind="script" data-state={row.state.kind}>
      <button
        aria-label={`${running ? "Stop" : "Run"} ${row.name}`}
        className="cv-script-row__go"
        disabled={disabled}
        onClick={() => (running ? props.onStop() : props.onRun(row.key))}
        title={disabled ? (row.blockedReason ?? undefined) : undefined}
        type="button"
      >
        {goIcon(running)}
      </button>
      <span className="cv-script-row__name">{row.name}</span>
      {row.command === null ? (
        <span className="cv-script-row__fill" />
      ) : (
        <span className="cv-script-row__cmd" title={row.command}>
          {row.command}
        </span>
      )}
      <ScriptStatus onShowOutput={props.onShowOutput} state={row.state} />
    </div>
  );
}

function ScriptStatus(props: { readonly state: AgentScriptRowState; onShowOutput(): void }) {
  const { state } = props;
  switch (state.kind) {
    case "idle":
      return null;
    case "running":
      return (
        <span className="cv-script-row__status">
          <StatusLabel kind="work">Running</StatusLabel>
          <button className="cv-rp-link" onClick={props.onShowOutput} type="button">
            Show output
          </button>
        </span>
      );
    case "exited":
      return (
        <span className="cv-script-row__status">
          <StatusLabel kind={state.exitCode === 0 ? "ok" : "fail"}>
            {state.exitCode === null ? "Exited" : `Exit ${state.exitCode}`}
          </StatusLabel>
          <button className="cv-rp-link" onClick={props.onShowOutput} type="button">
            Show output
          </button>
        </span>
      );
    case "failed":
      return (
        <span className="cv-script-row__status" title={state.message}>
          <StatusLabel kind="fail">Failed</StatusLabel>
        </span>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function ActionRow(props: {
  readonly action: AgentProjectActionRow;
  onRun(identity: VscodeProcessTaskIdentity): void;
  onStop(): void;
}) {
  const { action } = props;
  const running = action.state.kind === "running";
  const stopping = action.state.kind === "running" && action.state.stopping;
  const identity = action.identity;
  const disabled = running ? stopping : identity === null || action.blockedReason !== null;
  const run = (): void => {
    if (running) {
      props.onStop();
      return;
    }
    if (identity !== null) props.onRun(identity);
  };
  return (
    <div className="cv-script-row" data-kind="action" data-state={running ? "running" : "idle"}>
      <button
        aria-label={`${running ? "Stop" : "Run"} ${action.label}`}
        className="cv-script-row__go"
        disabled={disabled}
        onClick={run}
        title={disabled && !running ? (action.blockedReason ?? undefined) : undefined}
        type="button"
      >
        {goIcon(running)}
      </button>
      <span className="cv-script-row__name">{action.label}</span>
      {action.detail === null ? (
        <span className="cv-script-row__fill" />
      ) : (
        <span className="cv-script-row__cmd" title={action.detail}>
          {action.detail}
        </span>
      )}
      {running && (
        <span className="cv-script-row__status">
          <StatusLabel kind="work" spinner={stopping}>
            {stopping ? "Stopping…" : "Running"}
          </StatusLabel>
        </span>
      )}
    </div>
  );
}

function goIcon(running: boolean): ReactNode {
  if (running) return <Square aria-hidden="true" size={12} />;
  return <Play aria-hidden="true" size={14} />;
}

function scriptsNote(count: number, truncated: boolean): string | null {
  if (count === 0) return "No package scripts found.";
  if (truncated) return "Only the first scripts are listed.";
  return null;
}
