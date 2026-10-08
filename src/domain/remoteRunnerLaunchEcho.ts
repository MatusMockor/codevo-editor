import type { AgentLaunchOptions } from "./agentLaunch";

export function remoteRunnerLaunchIdentity(launch: AgentLaunchOptions): readonly unknown[] {
  switch (launch.provider) {
    case "codex":
      return [launch.provider, launch.model, launch.mode, launch.effort ?? "default"];
    case "claudeCode":
      return [
        launch.provider,
        launch.model,
        launch.mode,
        launch.effort,
        launch.context ?? "200k",
        launch.fastMode ?? false,
        launch.thinkingMode ?? false,
      ];
    default:
      return unsupportedProvider(launch);
  }
}

export function remoteRunnerEchoesLaunch(
  sent: AgentLaunchOptions,
  echoed: AgentLaunchOptions | undefined,
): boolean {
  if (echoed === undefined) return false;
  return (
    JSON.stringify(remoteRunnerLaunchIdentity(echoed)) ===
    JSON.stringify(remoteRunnerLaunchIdentity(sent))
  );
}

function unsupportedProvider(launch: never): never {
  throw new TypeError(`Unsupported remote launch provider: ${JSON.stringify(launch)}.`);
}
