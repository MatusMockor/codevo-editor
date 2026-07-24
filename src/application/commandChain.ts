import type { CommandExecutionRunner } from "./commandRegistry";

interface CommandExecutionRunnerRef {
  readonly current: CommandExecutionRunner | undefined;
}

export function runCommandChain(
  runCommand: CommandExecutionRunner | undefined,
  commandIds: readonly string[],
): void {
  if (!runCommand) {
    return;
  }

  for (const commandId of commandIds) {
    if (runCommand(commandId) === "executed") {
      return;
    }
  }
}

export function runRegisteredCommand(
  runnerRef: CommandExecutionRunnerRef,
  commandId: string,
  fallback: () => void,
): void {
  const outcome = runnerRef.current?.(commandId);
  if (outcome === undefined || outcome === "missing") {
    fallback();
  }
}

export function requestRegisteredCommand(
  runnerRef: CommandExecutionRunnerRef,
  commandId: string,
): void {
  runnerRef.current?.(commandId);
}
