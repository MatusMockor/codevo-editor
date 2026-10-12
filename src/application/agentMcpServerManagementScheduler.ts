export interface AgentMcpServerManagementScheduler {
  schedule(delayMs: number, task: () => void): () => void;
}

export const timerAgentMcpServerManagementScheduler: AgentMcpServerManagementScheduler =
  Object.freeze({
    schedule(delayMs: number, task: () => void): () => void {
      const handle = globalThis.setTimeout(task, delayMs);
      return () => globalThis.clearTimeout(handle);
    },
  });
