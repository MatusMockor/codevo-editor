import {
  reduceVscodeProcessTask,
  reduceVscodeProcessTaskProblems,
  vscodeProcessTaskOwnersEqual,
  type VscodeProcessTaskEvent,
  type VscodeProcessTaskOwner,
  type VscodeProcessTaskProblemsState,
  type VscodeProcessTaskState,
} from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";

export type VscodeProcessTaskStartOutcome =
  | { readonly status: "started" }
  | { readonly status: "rejected" | "stale" }
  | { readonly status: "error" };

export type VscodeProcessTaskCompletion =
  | { readonly status: "exited"; readonly exitCode: number | null }
  | { readonly status: "failed" | "stopped" | "stale" };

export interface VscodeProcessTaskCoordinatorSnapshot {
  readonly activation: number | null;
  readonly owner: VscodeProcessTaskOwner | null;
  readonly problems: VscodeProcessTaskProblemsState | null;
  readonly task: VscodeProcessTaskState | null;
  readonly running: boolean;
  readonly stopping: boolean;
}

export interface VscodeProcessTaskCoordinator {
  cancel(): Promise<boolean>;
  cancelExact(owner: VscodeProcessTaskOwner): Promise<boolean>;
  invalidate(): Promise<boolean>;
  snapshot(): VscodeProcessTaskCoordinatorSnapshot;
  start(request: {
    readonly activation: number;
    readonly owner: VscodeProcessTaskOwner;
  }): Promise<VscodeProcessTaskStartOutcome>;
  waitForTerminal(owner: VscodeProcessTaskOwner): Promise<VscodeProcessTaskCompletion>;
}

interface ActiveTask {
  readonly activation: number;
  disposed: boolean;
  invalidated: boolean;
  lastSequence: number;
  readonly owner: VscodeProcessTaskOwner;
  readonly gateway: VscodeProcessTasksGateway;
  problems: VscodeProcessTaskProblemsState;
  state: VscodeProcessTaskState;
  stopFlight: Promise<boolean> | null;
  stopping: boolean;
  unsubscribe: (() => void) | null;
  readonly completion: Promise<VscodeProcessTaskCompletion>;
  readonly resolveCompletion: (completion: VscodeProcessTaskCompletion) => void;
}

const EMPTY_SNAPSHOT: VscodeProcessTaskCoordinatorSnapshot = Object.freeze({
  activation: null,
  owner: null,
  problems: null,
  task: null,
  running: false,
  stopping: false,
});

export function createVscodeProcessTaskCoordinator(options: {
  readonly getGateway: () => VscodeProcessTasksGateway;
  readonly isCurrent: (activation: number, owner: VscodeProcessTaskOwner) => boolean;
  readonly onSnapshot?: (snapshot: VscodeProcessTaskCoordinatorSnapshot) => void;
}): VscodeProcessTaskCoordinator {
  let active: ActiveTask | null = null;
  let retained: {
    readonly activation: number;
    readonly problems: VscodeProcessTaskProblemsState;
    readonly state: VscodeProcessTaskState;
  } | null = null;

  const current = (candidate: ActiveTask): boolean => {
    try {
      return (
        active === candidate && options.isCurrent(candidate.activation, candidate.owner) === true
      );
    } catch {
      return false;
    }
  };

  const snapshot = (): VscodeProcessTaskCoordinatorSnapshot => {
    if (active) {
      return Object.freeze({
        activation: active.activation,
        owner: active.owner,
        problems: active.invalidated ? null : active.problems,
        task: active.invalidated ? null : active.state,
        running: !active.stopping,
        stopping: active.stopping,
      });
    }
    if (retained) {
      return Object.freeze({
        activation: retained.activation,
        owner: retained.state.owner,
        problems: retained.problems,
        task: retained.state,
        running: false,
        stopping: false,
      });
    }
    return EMPTY_SNAPSHOT;
  };

  const publish = (): void => {
    try {
      options.onSnapshot?.(snapshot());
    } catch {
      // Presentation observers do not own the process lifecycle.
    }
  };

  const hasRetainedOwner = (owner: VscodeProcessTaskOwner): boolean =>
    retained !== null && vscodeProcessTaskOwnersEqual(retained.state.owner, owner);

  const unlisten = (candidate: ActiveTask): void => {
    const unsubscribe = candidate.unsubscribe;
    candidate.unsubscribe = null;
    if (!unsubscribe) return;
    try {
      unsubscribe();
    } catch {
      // A failed listener cleanup cannot retarget task ownership.
    }
  };

  const settle = (candidate: ActiveTask, keepState: boolean): void => {
    candidate.disposed = true;
    unlisten(candidate);
    if (active !== candidate) return;
    active = null;
    retained =
      keepState && !candidate.invalidated
        ? Object.freeze({
            activation: candidate.activation,
            problems: candidate.problems,
            state: candidate.state,
          })
        : null;
    candidate.resolveCompletion(completionFromState(candidate.state));
    publish();
  };

  const receive = (candidate: ActiveTask, event: VscodeProcessTaskEvent): void => {
    if (
      active !== candidate ||
      !vscodeProcessTaskOwnersEqual(candidate.owner, event.owner) ||
      event.sequence <= candidate.lastSequence
    ) {
      return;
    }
    candidate.lastSequence = event.sequence;
    if (event.kind === "problems") {
      const problems = reduceVscodeProcessTaskProblems(candidate.problems, {
        type: "event",
        event,
      });
      if (!problems || problems === candidate.problems) return;
      candidate.problems = problems;
      if (!candidate.invalidated) publish();
      return;
    }
    const next = reduceVscodeProcessTask(candidate.state, { type: "event", event });
    if (!next || next === candidate.state) return;
    candidate.state = next;
    const terminal =
      next.status === "exited" || next.status === "failed" || next.status === "stopped";
    if (terminal && (next.status !== "exited" || !candidate.problems.complete)) {
      const problems = reduceVscodeProcessTaskProblems(null, {
        type: "own",
        owner: candidate.owner,
      });
      if (problems) candidate.problems = problems;
    }
    if (!candidate.invalidated) publish();
    if (terminal) settle(candidate, true);
  };

  const stop = async (
    invalidated: boolean,
    expectedOwner: VscodeProcessTaskOwner | null = null,
  ): Promise<boolean> => {
    const candidate = active;
    if (
      expectedOwner &&
      (!candidate || !vscodeProcessTaskOwnersEqual(candidate.owner, expectedOwner))
    ) {
      return false;
    }
    if (!candidate) {
      if (invalidated) {
        retained = null;
        publish();
      }
      return false;
    }
    candidate.invalidated ||= invalidated;
    candidate.stopping = true;
    if (invalidated) retained = null;
    publish();
    if (!candidate.stopFlight) {
      candidate.stopFlight = safelyStop(candidate.gateway, candidate.owner).then((stopped) => {
        if (stopped && active === candidate) {
          if (!candidate.invalidated) {
            candidate.state = Object.freeze({ ...candidate.state, status: "stopped" });
            const problems = reduceVscodeProcessTaskProblems(null, {
              type: "own",
              owner: candidate.owner,
            });
            if (problems) candidate.problems = problems;
          }
          settle(candidate, true);
        }
        return stopped;
      });
    }
    return candidate.stopFlight;
  };

  return Object.freeze({
    cancel: () => stop(false),
    cancelExact: (owner: VscodeProcessTaskOwner) => stop(false, owner),
    invalidate: () => stop(true),
    snapshot,
    start: async ({
      activation,
      owner,
    }: {
      readonly activation: number;
      readonly owner: VscodeProcessTaskOwner;
    }): Promise<VscodeProcessTaskStartOutcome> => {
      if (
        active !== null ||
        !Number.isSafeInteger(activation) ||
        activation < 0 ||
        !safeCurrent(options.isCurrent, activation, owner)
      ) {
        return outcome("rejected");
      }
      retained = null;
      const initial = reduceVscodeProcessTask(null, { type: "own", owner });
      const initialProblems = reduceVscodeProcessTaskProblems(null, { type: "own", owner });
      if (!initial || !initialProblems) return outcome("rejected");
      const candidate: ActiveTask = {
        activation,
        disposed: false,
        gateway: options.getGateway(),
        invalidated: false,
        lastSequence: 0,
        owner: initial.owner,
        problems: initialProblems,
        state: initial,
        stopFlight: null,
        stopping: false,
        unsubscribe: null,
        ...completionDeferred(),
      };
      active = candidate;
      publish();
      try {
        try {
          const unsubscribe = await candidate.gateway.subscribeVscodeProcessTaskEvents((event) =>
            receive(candidate, event),
          );
          if (candidate.disposed || active !== candidate) {
            safelyUnsubscribe(unsubscribe);
            return outcome("stale");
          }
          candidate.unsubscribe = unsubscribe;
        } catch {
          settle(candidate, false);
          return outcome("error");
        }
        if (candidate.invalidated) {
          return outcome("stale");
        }
        if (!current(candidate)) {
          settle(candidate, false);
          return outcome("stale");
        }
        let returnedOwner: VscodeProcessTaskOwner;
        try {
          returnedOwner = await candidate.gateway.startVscodeProcessTask(candidate.owner);
        } catch {
          await stop(true);
          return outcome("error");
        }
        if (
          !current(candidate) ||
          candidate.invalidated ||
          !vscodeProcessTaskOwnersEqual(candidate.owner, returnedOwner)
        ) {
          if (active === candidate) void stop(true);
          return outcome("stale");
        }
        try {
          await candidate.gateway.acknowledgeVscodeProcessTaskStart(candidate.owner);
        } catch {
          void stop(false);
          return outcome("error");
        }
        if (candidate.invalidated) return outcome("stale");
        if (candidate.disposed && hasRetainedOwner(candidate.owner)) {
          return outcome("started");
        }
        if (!current(candidate)) return outcome("stale");
        return outcome("started");
      } catch {
        settle(candidate, false);
        return outcome("error");
      }
    },
    waitForTerminal: async (
      owner: VscodeProcessTaskOwner,
    ): Promise<VscodeProcessTaskCompletion> => {
      if (active && vscodeProcessTaskOwnersEqual(active.owner, owner)) {
        return active.completion;
      }
      if (retained && vscodeProcessTaskOwnersEqual(retained.state.owner, owner)) {
        return completionFromState(retained.state);
      }
      return completion("stale");
    },
  });
}

function completionFromState(state: VscodeProcessTaskState): VscodeProcessTaskCompletion {
  if (state.status === "exited") {
    return Object.freeze({ status: "exited", exitCode: state.exitCode });
  }
  if (state.status === "failed" || state.status === "stopped") {
    return completion(state.status);
  }
  return completion("stale");
}

function completionDeferred(): {
  readonly completion: Promise<VscodeProcessTaskCompletion>;
  readonly resolveCompletion: (completion: VscodeProcessTaskCompletion) => void;
} {
  let resolveCompletion!: (completion: VscodeProcessTaskCompletion) => void;
  const taskCompletion = new Promise<VscodeProcessTaskCompletion>((resolve) => {
    resolveCompletion = resolve;
  });
  return { completion: taskCompletion, resolveCompletion };
}

function completion<T extends VscodeProcessTaskCompletion["status"]>(
  status: T,
): Extract<VscodeProcessTaskCompletion, { status: T }> {
  return Object.freeze({ status }) as Extract<VscodeProcessTaskCompletion, { status: T }>;
}

async function safelyStop(
  gateway: VscodeProcessTasksGateway,
  owner: VscodeProcessTaskOwner,
): Promise<boolean> {
  try {
    await gateway.stopVscodeProcessTask(owner);
    return true;
  } catch {
    return false;
  }
}

function safeCurrent(
  isCurrent: (activation: number, owner: VscodeProcessTaskOwner) => boolean,
  activation: number,
  owner: VscodeProcessTaskOwner,
): boolean {
  try {
    return isCurrent(activation, owner) === true;
  } catch {
    return false;
  }
}

function safelyUnsubscribe(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    // A late listener is still fenced even when transport cleanup throws.
  }
}

function outcome<T extends VscodeProcessTaskStartOutcome["status"]>(
  status: T,
): Extract<VscodeProcessTaskStartOutcome, { status: T }> {
  return Object.freeze({ status }) as Extract<VscodeProcessTaskStartOutcome, { status: T }>;
}
