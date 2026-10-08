import {
  agentLaunchIsDangerous,
  type AgentLaunchOptions,
  type ClaudeContextChoice,
  type ClaudeEffortChoice,
  type ClaudeLaunchOptions,
} from "./agentLaunch";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeManifestModel,
  type ClaudeModelManifest,
} from "./claudeModelCatalog";

export type StoredAgentLaunchAdmission =
  | {
      readonly kind: "ready";
      readonly launch: AgentLaunchOptions;
      readonly dangerousLaunchConfirmed: boolean;
    }
  | { readonly kind: "needsConfirmation"; readonly launch: AgentLaunchOptions };

export function normalizeStoredAgentLaunch(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    return {
      ...launch,
      mode: launch.mode === "default" ? "bypassPermissions" : launch.mode,
      effort: storedClaudeEffort(launch, catalog),
      context: storedClaudeContext(launch, catalog),
    };
  }
  return {
    ...launch,
    mode: launch.mode === "default" ? "dangerFullAccess" : launch.mode,
  };
}

function storedClaudeEffort(
  launch: ClaudeLaunchOptions,
  catalog: ClaudeModelManifest,
): ClaudeEffortChoice {
  const entry = catalogClaudeModel(launch.model, catalog);
  if (entry !== null && entry.efforts.length === 0) return "default";
  if (launch.effort !== "default") return launch.effort;
  if (entry === null) return "default";
  if (entry.efforts.includes("high")) return "high";
  return entry.defaultEffort;
}

function storedClaudeContext(
  launch: ClaudeLaunchOptions,
  catalog: ClaudeModelManifest,
): ClaudeContextChoice | undefined {
  const fixedWindow =
    launch.model !== "default" &&
    catalogClaudeModel(launch.model, catalog)?.contextWindows.length === 0;
  if (fixedWindow) return undefined;
  return launch.context ?? "1m";
}

function catalogClaudeModel(
  model: ClaudeLaunchOptions["model"],
  catalog: ClaudeModelManifest,
): ClaudeManifestModel | null {
  const models = catalog.claudeCode;
  if (model === "default") return models.find((entry) => entry.isDefault === true) ?? null;
  return models.find((entry) => entry.choice === model || entry.runtimeIds.includes(model)) ?? null;
}

export function admitStoredAgentLaunch(
  stored: AgentLaunchOptions,
  callerConfirmed: boolean,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): StoredAgentLaunchAdmission {
  const launch = normalizeStoredAgentLaunch(stored, catalog);
  if (!agentLaunchIsDangerous(launch))
    return { kind: "ready", launch, dangerousLaunchConfirmed: false };
  const promoted = stored.mode !== launch.mode;
  const confirmed = promoted ? callerConfirmed : agentLaunchIsDangerous(stored);
  if (!confirmed) return { kind: "needsConfirmation", launch };
  return { kind: "ready", launch, dangerousLaunchConfirmed: true };
}
