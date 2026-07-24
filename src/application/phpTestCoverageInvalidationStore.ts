import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { workspaceFileChangeInvalidatesPhpTestCoverage } from "../domain/phpTestCoverageInvalidation";

export interface PhpTestCoverageInvalidationStore {
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  handleWorkspaceFileChange(event: WorkspaceFileChangeEvent): void;
}

/** Observable monotonic fence whose bumps do not render the workbench controller. */
export function createPhpTestCoverageInvalidationStore(): PhpTestCoverageInvalidationStore {
  let snapshot = 0;
  const listeners = new Set<() => void>();
  return Object.freeze({
    getSnapshot: () => snapshot,
    handleWorkspaceFileChange: (event: WorkspaceFileChangeEvent) => {
      if (!workspaceFileChangeInvalidatesPhpTestCoverage(event)) return;
      snapshot += 1;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
