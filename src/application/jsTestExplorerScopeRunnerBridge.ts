import type { JsTestExplorerScopeRunnerPort } from "./useJsTestRunSelectionCommands";
import type { JsTestRunnableScope } from "../domain/jsTestRunSelection";

export interface JsTestExplorerScopeRunnerBridge {
  readonly runner: JsTestExplorerScopeRunnerPort;
  bind(runner: JsTestExplorerScopeRunnerPort): () => void;
}

type RunnerPublication = Readonly<{ runner: JsTestExplorerScopeRunnerPort }>;
type ActiveStart = Readonly<{
  kind: "failed" | "last" | "scope";
  publication: RunnerPublication;
}>;
type ActiveCancel = Readonly<{
  publication: RunnerPublication;
  start: ActiveStart;
}>;

/**
 * Keeps the Test Explorer runner private while allowing owner-safe editor commands
 * to target the currently mounted explorer lifecycle.
 */
export function createJsTestExplorerScopeRunnerBridge(): JsTestExplorerScopeRunnerBridge {
  let current: RunnerPublication | null = null;
  let activeStart: ActiveStart | null = null;
  let activeCancel: ActiveCancel | null = null;
  const canStart = () => activeStart === null && activeCancel === null;
  const runner: JsTestExplorerScopeRunnerPort = Object.freeze({
    canCancelTestRun: () =>
      activeCancel === null &&
      activeStart?.kind === "failed" &&
      current === activeStart.publication &&
      safelyCanCancel(activeStart.publication.runner),
    canRerunFailedTests: () => canStart() && safelyCanRerunFailed(current?.runner),
    canRerunLastRun: () => canStart() && safelyCanRerunLast(current?.runner),
    canRunScope: (scope: JsTestRunnableScope) => canStart() && safelyCanRun(current?.runner, scope),
    cancelTestRun: async () => {
      if (activeCancel !== null) return false;
      const start = activeStart;
      const publication = current;
      if (
        !start ||
        start.kind !== "failed" ||
        !publication ||
        start.publication !== publication ||
        !safelyCanCancel(publication.runner)
      ) {
        return false;
      }
      const cancellation = Object.freeze({ publication, start });
      activeCancel = cancellation;
      try {
        if (
          current !== publication ||
          activeStart !== start ||
          !safelyCanCancel(publication.runner)
        ) {
          return false;
        }
        const accepted = await publication.runner.cancelTestRun();
        return (
          accepted === true &&
          current === publication &&
          activeStart === start &&
          activeCancel === cancellation
        );
      } catch {
        return false;
      } finally {
        if (activeCancel === cancellation) activeCancel = null;
      }
    },
    rerunFailedTests: () =>
      startRun("failed", safelyCanRerunFailed, (publication) =>
        publication.runner.rerunFailedTests(),
      ),
    rerunLastRun: () =>
      startRun("last", safelyCanRerunLast, (publication) => publication.runner.rerunLastRun()),
    runScope: (scope: JsTestRunnableScope) =>
      startRun(
        "scope",
        (candidate) => safelyCanRun(candidate, scope),
        (publication) => publication.runner.runScope(scope),
      ),
  });
  async function startRun(
    kind: ActiveStart["kind"],
    canRun: (candidate: JsTestExplorerScopeRunnerPort | undefined) => boolean,
    run: (publication: RunnerPublication) => Promise<boolean>,
  ): Promise<boolean> {
    if (!canStart()) return false;
    const publication = current;
    if (!publication || !canRun(publication.runner)) return false;
    const start = Object.freeze({ kind, publication });
    activeStart = start;
    try {
      if (current !== publication || !canRun(publication.runner)) return false;
      const accepted = await run(publication);
      return accepted === true && current === publication && activeStart === start;
    } catch {
      return false;
    } finally {
      if (activeStart === start) activeStart = null;
    }
  }
  return Object.freeze({
    runner,
    bind(nextRunner: JsTestExplorerScopeRunnerPort) {
      const publication = Object.freeze({ runner: nextRunner });
      current = publication;
      return () => {
        if (current === publication) current = null;
      };
    },
  });
}

function safelyCanCancel(runner: JsTestExplorerScopeRunnerPort | undefined): boolean {
  try {
    return runner?.canCancelTestRun() === true;
  } catch {
    return false;
  }
}

function safelyCanRerunFailed(runner: JsTestExplorerScopeRunnerPort | undefined): boolean {
  try {
    return runner?.canRerunFailedTests() === true;
  } catch {
    return false;
  }
}

function safelyCanRerunLast(runner: JsTestExplorerScopeRunnerPort | undefined): boolean {
  try {
    return runner?.canRerunLastRun() === true;
  } catch {
    return false;
  }
}

function safelyCanRun(
  runner: JsTestExplorerScopeRunnerPort | undefined,
  scope: Parameters<JsTestExplorerScopeRunnerPort["canRunScope"]>[0],
): boolean {
  try {
    return runner?.canRunScope(scope) === true;
  } catch {
    return false;
  }
}
