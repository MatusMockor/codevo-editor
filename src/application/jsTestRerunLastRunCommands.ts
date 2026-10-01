import type { JsTestExplorerScopeRunnerPort } from "./useJsTestRunSelectionCommands";

export interface JsTestRerunLastRunCommands {
  canCancelTestRun(): boolean;
  canRerunFailedTests(): boolean;
  canRerunLastRun(): boolean;
  cancelTestRun(): Promise<boolean>;
  rerunFailedTests(): Promise<boolean>;
  rerunLastRun(): Promise<boolean>;
}

export type JsTestExplorerCommandRunnerPort = JsTestExplorerScopeRunnerPort &
  JsTestRerunLastRunCommands;

/** Projects only fail-closed rerun verbs from the private Test Explorer bridge. */
export function createJsTestRerunLastRunCommands(
  runner: JsTestExplorerCommandRunnerPort | undefined,
): JsTestRerunLastRunCommands {
  return Object.freeze({
    canCancelTestRun: () => {
      try {
        return runner?.canCancelTestRun() === true;
      } catch {
        return false;
      }
    },
    canRerunFailedTests: () => {
      try {
        return runner?.canRerunFailedTests() === true;
      } catch {
        return false;
      }
    },
    canRerunLastRun: () => {
      try {
        return runner?.canRerunLastRun() === true;
      } catch {
        return false;
      }
    },
    cancelTestRun: async () => {
      try {
        return (await runner?.cancelTestRun()) === true;
      } catch {
        return false;
      }
    },
    rerunFailedTests: async () => {
      try {
        return (await runner?.rerunFailedTests()) === true;
      } catch {
        return false;
      }
    },
    rerunLastRun: async () => {
      try {
        return (await runner?.rerunLastRun()) === true;
      } catch {
        return false;
      }
    },
  });
}
