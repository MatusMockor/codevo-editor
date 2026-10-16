import { useMemo, type ReactNode } from "react";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  availableNewThreadDefaults,
  newThreadClaudeModelFallback,
  newThreadDefaultsWithConfiguredModels,
} from "./agentComposerLaunch";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import { useAgentCodexModelCatalog } from "./useAgentCodexModelCatalog";
import {
  AgentNewThreadDefaultsContext,
  AgentNewThreadModelFallbackContext,
  type AgentNewThreadDefaultsByTarget,
} from "./useAgentNewThreadDefaults";

const UNSET_DEFAULTS = defaultAgentNewThreadDefaults();
const UNDETECTED_MODELS: Readonly<Record<AgentCliKind, string | null>> = {
  claudeCode: null,
  codex: null,
};

export function AgentNewThreadDefaultsProvider({
  settings,
  localClaudeCliVersion = null,
  localConfiguredModels = UNDETECTED_MODELS,
  children,
}: {
  readonly settings: AgentNewThreadDefaults | undefined;
  readonly localClaudeCliVersion?: string | null;
  readonly localConfiguredModels?: Readonly<Record<AgentCliKind, string | null>>;
  readonly children: ReactNode;
}) {
  const catalog = useAgentClaudeModelCatalog();
  const codexCatalog = useAgentCodexModelCatalog();
  const localClaudeModel = localConfiguredModels.claudeCode;
  const localCodexModel = localConfiguredModels.codex;
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
  const offered = useMemo(
    () => availableNewThreadDefaults(configured, catalog),
    [configured, catalog],
  );
  const local = useMemo(
    () => availableNewThreadDefaults(offered, catalog, localClaudeCliVersion),
    [offered, catalog, localClaudeCliVersion],
  );
  const server = useMemo(
    () =>
      newThreadDefaultsWithConfiguredModels(
        offered,
        { claudeCode: localClaudeModel, codex: localCodexModel },
        catalog,
        codexCatalog,
      ),
    [offered, localClaudeModel, localCodexModel, catalog, codexCatalog],
  );
  const value = useMemo<AgentNewThreadDefaultsByTarget>(() => ({ local, server }), [local, server]);
  const fallback = useMemo(
    () => ({ local: newThreadClaudeModelFallback(offered, local, catalog), server: null }),
    [offered, local, catalog],
  );
  return (
    <AgentNewThreadDefaultsContext.Provider value={value}>
      <AgentNewThreadModelFallbackContext.Provider value={fallback}>
        {children}
      </AgentNewThreadModelFallbackContext.Provider>
    </AgentNewThreadDefaultsContext.Provider>
  );
}
