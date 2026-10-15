export function agentBranchCheckoutBlockedReason(
  rootPath: string,
  threads: ReadonlyArray<{ readonly rootPath: string; readonly running: boolean }>,
  dispatching: boolean,
): string | null {
  if (dispatching) return "Wait for the agent to finish starting before switching branches.";
  if (threads.some((thread) => thread.rootPath === rootPath && thread.running))
    return "Stop the agent working in this checkout before switching branches.";
  return null;
}
