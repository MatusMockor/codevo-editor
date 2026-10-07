import { useCallback, useEffect, useMemo } from "react";
import type { AgentMcpServerProjects } from "../../../application/agentMcpServerProjects";
import {
  useAgentMcpServerHosts,
  useAgentMcpServersChosenProject,
} from "../../../application/useAgentMcpServers";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { SettingsEnvironment } from "../settingsPageProps";
import {
  mcpProjectNotes,
  mcpProjectOptions,
  mcpProjectSelection,
  type McpProjectNote,
  type McpProjectOption,
  type McpProjectSelection,
} from "./mcpProjectOptions";

export interface McpServersProject {
  readonly options: ReadonlyArray<McpProjectOption>;
  readonly notes: ReadonlyArray<McpProjectNote>;
  readonly selection: McpProjectSelection;
  readonly serversKnown: boolean;
  select(key: string): void;
}

type McpServersProjectEnvironment = Pick<
  SettingsEnvironment,
  "agentMcpServers" | "agentProjects" | "workspaceRoot"
>;

const NO_PROJECTS: ReadonlyArray<AgentProjectDescriptor> = [];

export function useMcpServersProject(env: McpServersProjectEnvironment): McpServersProject {
  const choice = env.agentMcpServers?.projectChoice ?? null;
  const workspaceRoot = env.workspaceRoot;
  const projects = env.agentProjects ?? NO_PROJECTS;
  const servers = useAgentMcpServerHosts(env.agentMcpServers?.serverProjects ?? null);
  const options = useMemo(
    () => mcpProjectOptions(workspaceRoot, projects, servers),
    [workspaceRoot, projects, servers],
  );
  const notes = useMemo(() => mcpProjectNotes(servers), [servers]);
  const chosen = useAgentMcpServersChosenProject(choice, workspaceRoot);
  const selection = useMemo(
    () => mcpProjectSelection(options, chosen, servers),
    [options, chosen, servers],
  );
  const select = useCallback(
    (key: string) => {
      const option = options.find((candidate) => candidate.key === key);
      if (option === undefined) return;
      choice?.choose(workspaceRoot, option.project);
    },
    [choice, options, workspaceRoot],
  );
  return { options, notes, selection, serversKnown: servers.hosts.length > 0, select };
}

export function useMcpServerProjectsLoad(serverProjects: AgentMcpServerProjects | null): void {
  useEffect(() => {
    serverProjects?.load();
  }, [serverProjects]);
}
