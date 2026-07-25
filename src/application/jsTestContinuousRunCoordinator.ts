export const JS_TEST_CONTINUOUS_RUN_DEBOUNCE_MS = 250;

export type JsTestContinuousRunStrategy = "debounced-rescope" | "native-watch";

export interface JsTestContinuousRunOwner {
  /** Monotonic owner epoch; the same workspace after A-B-A receives a new epoch. */
  readonly epoch: number;
  readonly rootKey: string;
  readonly workspaceId: string;
}

export interface JsTestContinuousRunLease {
  readonly owner: JsTestContinuousRunOwner;
  readonly sequence: number;
}

export interface JsTestContinuousRunSnapshot {
  readonly changeVersion: number | null;
  readonly enabled: boolean;
  readonly owner: JsTestContinuousRunOwner | null;
  readonly pending: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
}

export interface JsTestContinuousRunScheduler {
  clear(handle: unknown): void;
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface JsTestContinuousRunCoordinator {
  disable(owner: JsTestContinuousRunOwner): Promise<boolean>;
  enable(owner: JsTestContinuousRunOwner, changeVersion: number): boolean;
  invalidate(): Promise<boolean>;
  observeChange(owner: JsTestContinuousRunOwner, changeVersion: number): boolean;
  snapshot(): JsTestContinuousRunSnapshot;
}

export interface JsTestContinuousRunCoordinatorOptions {
  readonly cancel: (lease: JsTestContinuousRunLease) => Promise<boolean>;
  readonly onSnapshot?: (snapshot: JsTestContinuousRunSnapshot) => void;
  /**
   * Returns false only when admission was temporarily busy. Failures after an
   * admitted attempt should settle as true and wait for the next file change.
   */
  readonly run: (lease: JsTestContinuousRunLease) => Promise<boolean>;
  readonly scheduler?: JsTestContinuousRunScheduler;
  readonly strategy?: JsTestContinuousRunStrategy | (() => JsTestContinuousRunStrategy);
  /** Test/recovery seam; the next lease always remains a safe integer. */
  readonly initialSequence?: number;
}

interface Selection {
  readonly identity: object;
  readonly owner: JsTestContinuousRunOwner;
  changeVersion: number;
  dirty: boolean;
  notBefore: number;
  readonly strategy: JsTestContinuousRunStrategy;
}

interface ActiveRun {
  cancelFlight: Promise<boolean> | null;
  readonly lease: JsTestContinuousRunLease;
  readonly selectionIdentity: object;
}

interface ScheduledRun {
  readonly generation: number;
  handle: unknown;
}

const EMPTY_SNAPSHOT: JsTestContinuousRunSnapshot = Object.freeze({
  changeVersion: null,
  enabled: false,
  owner: null,
  pending: false,
  running: false,
  stopping: false,
});

/**
 * Serializes workspace-wide Continuous Run without owning a runner process.
 * Every callback carries an immutable lease, so stale completion/cancel work
 * cannot target a later A-B-A owner.
 */
export function createJsTestContinuousRunCoordinator({
  cancel,
  onSnapshot,
  run,
  scheduler = defaultScheduler,
  strategy = "debounced-rescope",
  initialSequence = 0,
}: JsTestContinuousRunCoordinatorOptions): JsTestContinuousRunCoordinator {
  let selection: Selection | null = null;
  let active: ActiveRun | null = null;
  let retainedNativeRun: ActiveRun | null = null;
  let timer: ScheduledRun | null = null;
  let timerGeneration = 0;
  let sequence =
    Number.isSafeInteger(initialSequence) && initialSequence >= 0 ? initialSequence : 0;
  let highestInvalidatedEpoch = -1;

  const publish = (): void => {
    try {
      onSnapshot?.(snapshot());
    } catch {
      // Presentation observers cannot affect lifecycle ownership.
    }
  };

  const clearTimer = (): void => {
    timerGeneration += 1;
    const scheduled = timer;
    timer = null;
    if (scheduled === null) return;
    try {
      scheduler.clear(scheduled.handle);
    } catch {
      // The generation token fences a callback even when clearing fails.
    }
  };

  const schedule = (candidate: Selection, delayMs: number): boolean => {
    clearTimer();
    const generation = timerGeneration + 1;
    timerGeneration = generation;
    const scheduled: ScheduledRun = { generation, handle: null };
    timer = scheduled;
    try {
      const handle = scheduler.schedule(
        () => {
          if (timer?.generation !== generation) return;
          timer = null;
          if (selection !== candidate || active !== null || !candidate.dirty) return;
          const now = safeNow(scheduler);
          const remaining = now === null ? 0 : candidate.notBefore - now;
          if (remaining > 0) {
            schedule(candidate, remaining);
            return;
          }
          candidate.dirty = false;
          if (sequence >= Number.MAX_SAFE_INTEGER) {
            selection = null;
            highestInvalidatedEpoch = Math.max(highestInvalidatedEpoch, candidate.owner.epoch);
            publish();
            return;
          }
          sequence += 1;
          const lease = Object.freeze({
            owner: candidate.owner,
            sequence,
          });
          const flight: ActiveRun = {
            cancelFlight: null,
            lease,
            selectionIdentity: candidate.identity,
          };
          active = flight;
          publish();
          void safelyRun(run, lease).then((admitted) => {
            if (active !== flight) return;
            active = null;
            const current = selection;
            if (current && current.identity === flight.selectionIdentity) {
              if (candidate.strategy === "native-watch" && admitted) {
                retainedNativeRun = flight;
              }
              if (!admitted) {
                // A temporarily busy admission remains armed but retries only
                // after a newer file-change version, never in an endless loop.
                current.dirty = false;
              }
              if (current.dirty) {
                const now = safeNow(scheduler);
                schedule(current, now === null ? 0 : Math.max(0, current.notBefore - now));
              }
            }
            publish();
          });
        },
        Math.max(0, delayMs),
      );
      scheduled.handle = handle;
      return true;
    } catch {
      timer = null;
      candidate.dirty = false;
      return false;
    }
  };

  const stopSelection = async (
    expectedOwner: JsTestContinuousRunOwner | null,
  ): Promise<boolean> => {
    const candidate = selection;
    if (!candidate) {
      const retained = retainedNativeRun;
      if (!retained || (expectedOwner && !ownersEqual(retained.lease.owner, expectedOwner))) {
        return false;
      }
      if (!retained.cancelFlight) {
        retained.cancelFlight = safelyCancel(cancel, retained.lease).then((stopped) => {
          retained.cancelFlight = null;
          if (stopped && retainedNativeRun === retained) {
            retainedNativeRun = null;
            publish();
          }
          return stopped;
        });
      }
      return retained.cancelFlight;
    }
    if (expectedOwner && !ownersEqual(candidate.owner, expectedOwner)) return false;
    highestInvalidatedEpoch = Math.max(highestInvalidatedEpoch, candidate.owner.epoch);
    selection = null;
    clearTimer();
    const flight = active;
    const retained = retainedNativeRun;
    publish();
    if (flight && flight.selectionIdentity === candidate.identity) {
      if (!flight.cancelFlight) {
        flight.cancelFlight = safelyCancel(cancel, flight.lease).then((stopped) => {
          flight.cancelFlight = null;
          if (!stopped && candidate.strategy === "native-watch" && retainedNativeRun === null) {
            retainedNativeRun = flight;
            publish();
          }
          return stopped;
        });
      }
      return flight.cancelFlight;
    }
    if (!retained || retained.selectionIdentity !== candidate.identity) return true;
    if (!retained.cancelFlight) {
      retained.cancelFlight = safelyCancel(cancel, retained.lease).then((stopped) => {
        retained.cancelFlight = null;
        if (stopped && retainedNativeRun === retained) {
          retainedNativeRun = null;
          publish();
        }
        return stopped;
      });
    }
    return retained.cancelFlight;
  };

  const snapshot = (): JsTestContinuousRunSnapshot => {
    const current = selection;
    const currentRun = current && active?.selectionIdentity === current.identity ? active : null;
    const stopping = current === null && (active !== null || retainedNativeRun !== null);
    if (!current) {
      return stopping
        ? Object.freeze({
            changeVersion: null,
            enabled: false,
            owner: (active ?? retainedNativeRun)!.lease.owner,
            pending: false,
            running: false,
            stopping: true,
          })
        : EMPTY_SNAPSHOT;
    }
    return Object.freeze({
      changeVersion: current.changeVersion,
      enabled: true,
      owner: current.owner,
      pending: current.dirty,
      running: currentRun !== null,
      stopping: false,
    });
  };

  const coordinator: JsTestContinuousRunCoordinator = {
    disable: (owner: JsTestContinuousRunOwner) => stopSelection(owner),
    enable: (owner: JsTestContinuousRunOwner, changeVersion: number) => {
      const immutableOwner = validatedOwner(owner);
      if (
        !immutableOwner ||
        !validVersion(changeVersion) ||
        immutableOwner.epoch <= highestInvalidatedEpoch ||
        selection !== null ||
        active !== null ||
        retainedNativeRun !== null
      ) {
        return false;
      }
      const candidate: Selection = {
        changeVersion,
        dirty: true,
        identity: Object.freeze({}),
        notBefore: safeNow(scheduler) ?? 0,
        owner: immutableOwner,
        strategy: resolvedStrategy(strategy),
      };
      selection = candidate;
      if (!schedule(candidate, 0)) {
        selection = null;
        publish();
        return false;
      }
      publish();
      return true;
    },
    invalidate: async () => {
      const owner = selection?.owner ?? retainedNativeRun?.lease.owner ?? null;
      if (owner) highestInvalidatedEpoch = Math.max(highestInvalidatedEpoch, owner.epoch);
      return stopSelection(null);
    },
    observeChange: (owner: JsTestContinuousRunOwner, changeVersion: number) => {
      const current = selection;
      if (
        !current ||
        !ownersEqual(current.owner, owner) ||
        !validVersion(changeVersion) ||
        changeVersion <= current.changeVersion
      ) {
        return false;
      }
      const previousVersion = current.changeVersion;
      if (current.strategy === "native-watch") {
        current.changeVersion = changeVersion;
        publish();
        return true;
      }
      const previousDirty = current.dirty;
      const previousNotBefore = current.notBefore;
      current.changeVersion = changeVersion;
      current.dirty = true;
      current.notBefore = (safeNow(scheduler) ?? 0) + JS_TEST_CONTINUOUS_RUN_DEBOUNCE_MS;
      if (active === null && !schedule(current, JS_TEST_CONTINUOUS_RUN_DEBOUNCE_MS)) {
        current.changeVersion = previousVersion;
        current.dirty = previousDirty;
        current.notBefore = previousNotBefore;
        publish();
        return false;
      }
      publish();
      return true;
    },
    snapshot,
  };
  return Object.freeze(coordinator);
}

const defaultScheduler: JsTestContinuousRunScheduler = Object.freeze({
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  schedule: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
});

function validatedOwner(owner: JsTestContinuousRunOwner): JsTestContinuousRunOwner | null {
  if (
    !owner ||
    !Number.isSafeInteger(owner.epoch) ||
    owner.epoch < 0 ||
    !validOwnerText(owner.rootKey, 16 * 1_024) ||
    !validOwnerText(owner.workspaceId, 1_024)
  ) {
    return null;
  }
  return Object.freeze({
    epoch: owner.epoch,
    rootKey: owner.rootKey,
    workspaceId: owner.workspaceId,
  });
}

function validOwnerText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    isWellFormedUnicode(value) &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  );
}

function validVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function ownersEqual(left: JsTestContinuousRunOwner, right: JsTestContinuousRunOwner): boolean {
  return (
    left.epoch === right.epoch &&
    left.rootKey === right.rootKey &&
    left.workspaceId === right.workspaceId
  );
}

function safeNow(scheduler: JsTestContinuousRunScheduler): number | null {
  try {
    const value = scheduler.now();
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function resolvedStrategy(
  strategy: JsTestContinuousRunCoordinatorOptions["strategy"],
): JsTestContinuousRunStrategy {
  try {
    const resolved = typeof strategy === "function" ? strategy() : strategy;
    return resolved === "native-watch" ? "native-watch" : "debounced-rescope";
  } catch {
    return "debounced-rescope";
  }
}

async function safelyRun(
  run: JsTestContinuousRunCoordinatorOptions["run"],
  lease: JsTestContinuousRunLease,
): Promise<boolean> {
  try {
    return (await run(lease)) === true;
  } catch {
    // A failed run settles the lease and remains armed for the next change.
    return true;
  }
}

async function safelyCancel(
  cancel: JsTestContinuousRunCoordinatorOptions["cancel"],
  lease: JsTestContinuousRunLease,
): Promise<boolean> {
  try {
    return (await cancel(lease)) === true;
  } catch {
    return false;
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
