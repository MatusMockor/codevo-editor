import { agentLaunchIsDangerous, type AgentLaunchOptions } from "./agentLaunch";

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
      effort: launch.effort === "default" ? "high" : launch.effort,
      context: launch.context ?? "1m",
    };
  }
  return {
    ...launch,
    mode: launch.mode === "default" ? "dangerFullAccess" : launch.mode,
  };
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
