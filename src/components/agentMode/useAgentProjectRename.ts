import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearProjectDisplayName,
  projectDisplayNameWriteMessage,
  randomProjectDisplayNameToken,
  saveProjectDisplayName,
  type ProjectDisplayNameTokenSource,
  type ProjectDisplayNameWrite,
} from "../../application/projectDisplayNames";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import {
  useProjectDisplayNameEntries,
  useProjectDisplayNames,
} from "../../application/useProjectDisplayNames";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  parseProjectDisplayName,
  projectDisplayNameRejectionMessage,
  type ProjectDisplayNameInput,
} from "../../domain/projectDisplayName";
import {
  agentProjectDisplayLabels,
  agentProjectGroupsWithDisplayLabels,
  agentProjectRenameTarget,
  agentProjectsWithDisplayLabels,
  type AgentProjectRenameTarget,
} from "./agentProjectDisplayNames";
import type { AgentProjectGroup } from "./agentModePresentation";

export type AgentProjectRenameOutcome =
  { readonly kind: "applied" } | { readonly kind: "rejected"; readonly message: string };

export interface AgentProjectRenameSources {
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly executionGroups: ReadonlyArray<AgentProjectGroup>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly catalog: AgentHistoryCatalogSurface | undefined;
  readonly generateToken?: ProjectDisplayNameTokenSource;
}

export interface AgentProjectRenameSurface {
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly executionGroups: ReadonlyArray<AgentProjectGroup>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly catalog: AgentHistoryCatalogSurface | undefined;
  readonly target: AgentProjectRenameTarget | null;
  request(projectRootKey: string): void;
  cancel(): void;
  submit(input: string): AgentProjectRenameOutcome;
}

const PROJECT_GONE: AgentProjectRenameOutcome = {
  kind: "rejected",
  message: projectDisplayNameWriteMessage("invalidProject"),
};

export function useAgentProjectRename({
  catalog,
  executionGroups,
  generateToken = randomProjectDisplayNameToken,
  groups,
  projects,
}: AgentProjectRenameSources): AgentProjectRenameSurface {
  const names = useProjectDisplayNames();
  const entries = useProjectDisplayNameEntries();
  const [requested, setRequested] = useState<string | null>(null);
  const labels = useMemo(() => agentProjectDisplayLabels(groups, names), [groups, names]);
  const namedGroups = useMemo(
    () => agentProjectGroupsWithDisplayLabels(groups, labels),
    [groups, labels],
  );
  const namedExecutionGroups = useMemo(
    () => agentProjectGroupsWithDisplayLabels(executionGroups, labels),
    [executionGroups, labels],
  );
  const namedProjects = useMemo(
    () => agentProjectsWithDisplayLabels(projects, labels),
    [labels, projects],
  );
  const namedCatalog = useMemo(() => catalogWithDisplayLabels(catalog, labels), [catalog, labels]);
  const target = useMemo(
    () => (requested === null ? null : agentProjectRenameTarget(groups, names, requested, entries)),
    [entries, groups, names, requested],
  );
  const abandoned = requested !== null && target === null;
  useEffect(() => {
    if (abandoned) setRequested(null);
  }, [abandoned]);

  const request = useCallback((projectRootKey: string) => setRequested(projectRootKey), []);
  const cancel = useCallback(() => setRequested(null), []);
  const submit = useCallback(
    (input: string): AgentProjectRenameOutcome => {
      if (target === null) return PROJECT_GONE;
      const outcome = applyProjectRename(target, parseProjectDisplayName(input), generateToken);
      if (outcome.kind === "applied") setRequested(null);
      return outcome;
    },
    [generateToken, target],
  );

  return useMemo(
    () => ({
      groups: namedGroups,
      executionGroups: namedExecutionGroups,
      projects: namedProjects,
      catalog: namedCatalog,
      target,
      request,
      cancel,
      submit,
    }),
    [
      cancel,
      namedCatalog,
      namedExecutionGroups,
      namedGroups,
      namedProjects,
      request,
      submit,
      target,
    ],
  );
}

function catalogWithDisplayLabels(
  catalog: AgentHistoryCatalogSurface | undefined,
  labels: ReadonlyMap<string, string>,
): AgentHistoryCatalogSurface | undefined {
  if (catalog === undefined) return undefined;
  const projects = agentProjectsWithDisplayLabels(catalog.projects, labels);
  if (projects === catalog.projects) return catalog;
  return { ...catalog, projects };
}

function applyProjectRename(
  target: AgentProjectRenameTarget,
  input: ProjectDisplayNameInput,
  generateToken: ProjectDisplayNameTokenSource,
): AgentProjectRenameOutcome {
  switch (input.kind) {
    case "invalid":
      return { kind: "rejected", message: projectDisplayNameRejectionMessage(input.reason) };
    case "reset":
      return renameOutcome(
        clearProjectDisplayName(target.memberRootKeys, target.displayedElsewhereRootKeys),
      );
    case "name":
      return renameOutcome(
        saveProjectDisplayName(
          target.memberRootKeys,
          input.name,
          generateToken,
          target.displayedElsewhereRootKeys,
        ),
      );
    default:
      return unsupportedInput(input);
  }
}

function renameOutcome(write: ProjectDisplayNameWrite): AgentProjectRenameOutcome {
  if (write.kind === "saved") return { kind: "applied" };
  return { kind: "rejected", message: projectDisplayNameWriteMessage(write.reason) };
}

function unsupportedInput(input: never): never {
  throw new TypeError(`Unsupported project display name input: ${JSON.stringify(input)}.`);
}
