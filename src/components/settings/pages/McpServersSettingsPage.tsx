import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import {
  useAgentMcpServersState,
  useAgentMcpServersTarget,
} from "../../../application/useAgentMcpServers";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import {
  selectedMcpProjectKey,
  type McpProjectNote,
  type McpProjectOption,
} from "./mcpProjectOptions";
import {
  MCP_NO_PROJECT_NOTICE,
  MCP_REFRESH_LABEL,
  MCP_UNAVAILABLE_NOTICE,
  mcpCheckNotice,
} from "./mcpServersPresentation";
import {
  useMcpServerProjectsLoad,
  useMcpServersProject,
  type McpServersProject,
} from "./useMcpServersProject";
import { McpServerGroups } from "./McpServerGroups";
import "./mcpServersSettings.css";

const NO_NOTES: ReadonlyArray<McpProjectNote> = [];

export function McpServersSettingsPage({ env }: SettingsPageProps) {
  const rowRef = useSettingsRowTarget("mcp.servers");
  return (
    <div className="settings-stack" data-settings-row="mcp.servers" ref={rowRef} tabIndex={-1}>
      <McpServersContent env={env} />
    </div>
  );
}

export function McpServersPageActions({ env }: { readonly env: SettingsEnvironment }) {
  const surface = env.agentMcpServers ?? null;
  const store = surface?.store ?? null;
  const project = useMcpServersProject(env);
  const projectKey = selectedMcpProjectKey(project.selection);
  const claudeTarget = useAgentMcpServersTarget(projectKey, "claudeCode");
  const codexTarget = useAgentMcpServersTarget(projectKey, "codex");
  const claude = useAgentMcpServersState(store, claudeTarget);
  const codex = useAgentMcpServersState(store, codexTarget);
  if (surface === null || store === null) return null;
  const targets = [claudeTarget, codexTarget].flatMap((target) => target ?? []);
  if (targets.length === 0 && !project.serversKnown) return null;
  const checking = claude.kind === "loading" || codex.kind === "loading";
  const refresh = () => {
    surface.serverProjects.load();
    for (const target of targets) store.refresh(target);
  };
  return (
    <span className="settings-page-actions">
      <IconButton
        disabled={checking}
        icon={<RefreshCw aria-hidden="true" size={14} />}
        label={MCP_REFRESH_LABEL}
        onClick={refresh}
      />
    </span>
  );
}

function McpServersContent({ env }: { readonly env: SettingsEnvironment }) {
  const surface = env.agentMcpServers ?? null;
  const project = useMcpServersProject(env);
  const nowMs = useNowMs();
  useMcpServerProjectsLoad(surface?.serverProjects ?? null);
  if (surface === null) return <McpNotice notes={NO_NOTES} text={MCP_UNAVAILABLE_NOTICE} />;
  const selection = project.selection;
  switch (selection.kind) {
    case "none":
      return <McpNotice notes={project.notes} text={MCP_NO_PROJECT_NOTICE} />;
    case "waiting":
      return <McpNotice notes={project.notes} text={null} />;
    case "selected":
      return (
        <>
          <McpProjectSection project={project} selected={selection.option} />
          <McpServerGroups
            key={selection.option.key}
            nowMs={nowMs}
            onCopy={env.onCopyInstallCommand}
            place={selection.option.project.kind}
            projectKey={selection.option.key}
            surface={surface}
          />
        </>
      );
    default: {
      const unreachable: never = selection;
      return unreachable;
    }
  }
}

function McpNotice({
  notes,
  text,
}: {
  readonly notes: ReadonlyArray<McpProjectNote>;
  readonly text: string | null;
}) {
  return (
    <SettingsSectionHeading title="MCP servers">
      {text === null ? null : <p className="settings-empty">{text}</p>}
      <McpProjectNotes className="settings-empty" notes={notes} />
    </SettingsSectionHeading>
  );
}

function McpProjectNotes({
  className,
  notes,
}: {
  readonly className: string;
  readonly notes: ReadonlyArray<McpProjectNote>;
}) {
  return notes.map((note) => (
    <p
      className={className}
      data-mcp-project-note={note.tone}
      key={note.serverId === null ? "list" : `server:${note.serverId}`}
      role={note.tone === "problem" ? "alert" : "status"}
    >
      {note.text}
    </p>
  ));
}

function McpProjectSection({
  project,
  selected,
}: {
  readonly project: McpServersProject;
  readonly selected: McpProjectOption;
}) {
  const options = useMemo(
    () => project.options.map(({ key, label }) => ({ label, value: key })),
    [project.options],
  );
  return (
    <SettingsSectionHeading title="Project">
      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__head">
            <h3 className="settings-row__title">{selected.name}</h3>
          </div>
          <p
            className="settings-row__description settings-mcp-project__location"
            data-place={selected.project.kind}
          >
            {selected.location}
          </p>
        </div>
        {options.length < 2 ? null : (
          <div className="settings-row__control">
            <SettingsSelect
              label="Project"
              onChange={project.select}
              options={options}
              value={selected.key}
              width="md"
            />
          </div>
        )}
      </div>
      <div className="settings-row" data-layout="stacked">
        <p className="settings-row__description">{mcpCheckNotice(selected.project.kind)}</p>
        <McpProjectNotes className="settings-row__description" notes={project.notes} />
      </div>
    </SettingsSectionHeading>
  );
}
