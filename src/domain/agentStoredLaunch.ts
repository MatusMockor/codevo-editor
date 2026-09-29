import {
  agentLaunchIsDangerous,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeLaunchOptions,
} from "./agentLaunch";
import { BUNDLED_CLAUDE_MODEL_MANIFEST, type ClaudeManifestModel } from "./claudeModelCatalog";

export type StoredAgentLaunchAdmission =
  | {
      readonly kind: "ready";
      readonly launch: AgentLaunchOptions;
      readonly dangerousLaunchConfirmed: boolean;
    }
  | { readonly kind: "needsConfirmation"; readonly launch: AgentLaunchOptions };

export function normalizeStoredAgentLaunch(launch: AgentLaunchOptions): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    return {
      ...launch,
      mode: launch.mode === "default" ? "bypassPermissions" : launch.mode,
      effort: storedClaudeEffort(launch),
      context: launch.context ?? "1m",
    };
  }
  return {
    ...launch,
    mode: launch.mode === "default" ? "dangerFullAccess" : launch.mode,
  };
}

function storedClaudeEffort(launch: ClaudeLaunchOptions): ClaudeEffortChoice {
  const entry = catalogClaudeModel(launch.model);
  if (entry !== null && entry.efforts.length === 0) return "default";
  if (launch.effort !== "default") return launch.effort;
  if (entry === null) return "default";
  if (entry.efforts.includes("high")) return "high";
  return entry.defaultEffort;
}

function catalogClaudeModel(model: ClaudeLaunchOptions["model"]): ClaudeManifestModel | null {
  const models = BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode;
  if (model === "default") return models.find((entry) => entry.isDefault === true) ?? null;
  return models.find((entry) => entry.choice === model || entry.runtimeIds.includes(model)) ?? null;
}

export function admitStoredAgentLaunch(
  stored: AgentLaunchOptions,
  callerConfirmed: boolean,
): StoredAgentLaunchAdmission {
  const launch = normalizeStoredAgentLaunch(stored);
  if (!agentLaunchIsDangerous(launch))
    return { kind: "ready", launch, dangerousLaunchConfirmed: false };
  const promoted = stored.mode !== launch.mode;
  const confirmed = promoted ? callerConfirmed : agentLaunchIsDangerous(stored);
  if (!confirmed) return { kind: "needsConfirmation", launch };
  return { kind: "ready", launch, dangerousLaunchConfirmed: true };
}
