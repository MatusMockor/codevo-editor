import { useCallback, useMemo } from "react";
import { useAgentMcpServersChosenProject } from "../../../application/useAgentMcpServers";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { SettingsEnvironment } from "../settingsPageProps";
import {
  mcpProjectOptions,
  selectedMcpProjectRoot,
  type McpProjectOption,
} from "./mcpServersPresentation";

export interface McpServersProject {
  readonly options: ReadonlyArray<McpProjectOption>;
  readonly selectedRoot: string | null;
  select(repositoryRoot: string): void;
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
  const options = useMemo(
    () => mcpProjectOptions(workspaceRoot, projects),
    [workspaceRoot, projects],
  );
  const chosen = useAgentMcpServersChosenProject(choice, workspaceRoot);
  const select = useCallback(
    (repositoryRoot: string) => choice?.choose(workspaceRoot, repositoryRoot),
    [choice, workspaceRoot],
  );
  return { options, selectedRoot: selectedMcpProjectRoot(options, chosen), select };
}
