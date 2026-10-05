import { useMemo, type ReactNode } from "react";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import { availableNewThreadDefaults } from "./agentComposerLaunch";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import {
  AgentNewThreadDefaultsContext,
  type AgentNewThreadDefaultsByTarget,
} from "./useAgentNewThreadDefaults";

const UNSET_DEFAULTS = defaultAgentNewThreadDefaults();

export function AgentNewThreadDefaultsProvider({
  settings,
  localClaudeCliVersion = null,
  children,
}: {
  readonly settings: AgentNewThreadDefaults | undefined;
  readonly localClaudeCliVersion?: string | null;
  readonly children: ReactNode;
}) {
  const catalog = useAgentClaudeModelCatalog();
  const { source, claudeCode, codex } = settings ?? UNSET_DEFAULTS;
  const claudeModel = claudeCode.model;
  const claudeEffort = claudeCode.effort;
  const codexModel = codex.model;
  const codexEffort = codex.effort;
  const configured = useMemo<AgentNewThreadDefaults>(
    () => ({
      source,
      claudeCode: { model: claudeModel, effort: claudeEffort },
      codex: { model: codexModel, effort: codexEffort },
    }),
    [source, claudeModel, claudeEffort, codexModel, codexEffort],
  );
  const server = useMemo(
    () => availableNewThreadDefaults(configured, catalog),
    [configured, catalog],
  );
  const local = useMemo(
    () => availableNewThreadDefaults(server, catalog, localClaudeCliVersion),
    [server, catalog, localClaudeCliVersion],
  );
  const value = useMemo<AgentNewThreadDefaultsByTarget>(() => ({ local, server }), [local, server]);
  return (
    <AgentNewThreadDefaultsContext.Provider value={value}>
      {children}
    </AgentNewThreadDefaultsContext.Provider>
  );
}
