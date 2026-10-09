export type AgentThreadIdentifiedObserver = (threadId: string) => void;

export function notifyAgentThreadIdentified(
  observer: AgentThreadIdentifiedObserver | undefined,
  threadId: string,
  reportFailure: (error: unknown) => void,
): void {
  if (observer === undefined) return;
  try {
    observer(threadId);
  } catch (error: unknown) {
    reportObserverFailure(reportFailure, error);
  }
}

function reportObserverFailure(reportFailure: (error: unknown) => void, error: unknown): void {
  try {
    reportFailure(error);
  } catch {
    return;
  }
}
