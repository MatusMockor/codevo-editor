export type LanguageServerRequestPriority =
  "cancellation" | "decorative" | "immediate" | "interactive";

export const MAX_DECORATIVE_REQUEST_DEFERRAL_MS = 250;
export const MAX_DEFERRED_DECORATIVE_REQUESTS = 32;
export const MAX_RETAINED_DISPATCHED_HANDLES = 256;
export const MAX_IMMEDIATE_REQUESTS_IN_FLIGHT = 64;
export const MAX_DECORATIVE_REQUESTS_IN_FLIGHT = 128;
export const MAX_CANCELLATION_REQUESTS_IN_FLIGHT =
  MAX_RETAINED_DISPATCHED_HANDLES + MAX_IMMEDIATE_REQUESTS_IN_FLIGHT;

export type LanguageServerCancellationTarget =
  | { readonly kind: "dropped" }
  | { readonly kind: "dispatched"; readonly wireRequestId: number }
  | { readonly kind: "foreign" }
  | { readonly kind: "unknown" };

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LanguageServerRequestSchedulerPorts {
  readonly allocateRequestId: () => number;
  readonly clearTimer?: (handle: TimerHandle) => void;
  readonly deferralMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
}

interface DeferredRequest {
  readonly handleId: number | undefined;
  readonly release: () => void;
  readonly settleWithFallback: () => void;
  settled: boolean;
  timer: TimerHandle | undefined;
}

interface ScopeState {
  deferred: DeferredRequest[];
  decorativeDispatchInFlight: boolean;
  interactiveInFlight: number;
}

export class LanguageServerInteractiveRequestScheduler {
  private readonly allocateRequestId: () => number;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly deferralMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly scopes = new Map<string, ScopeState>();
  private readonly wireRequestByHandleId = new Map<
    number,
    { readonly scope: string; readonly wireRequestId: number }
  >();
  private readonly deferredByHandleId = new Map<
    number,
    { entry: DeferredRequest; scope: string }
  >();
  private readonly deferredInAdmissionOrder: DeferredRequest[] = [];
  private decorativeRequestsInFlight = 0;
  private cancellationRequestsInFlight = 0;
  private immediateRequestsInFlight = 0;
  private prioritizedDispatchesInFlight = 0;

  constructor(ports: LanguageServerRequestSchedulerPorts) {
    this.allocateRequestId = ports.allocateRequestId;
    this.clearTimer = ports.clearTimer ?? ((handle) => clearTimeout(handle));
    this.deferralMs = ports.deferralMs ?? MAX_DECORATIVE_REQUEST_DEFERRAL_MS;
    this.setTimer = ports.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  }

  schedule<T>(
    scope: string,
    priority: LanguageServerRequestPriority,
    handleId: number | undefined,
    fallback: T,
    dispatch: (wireRequestId: number) => Promise<T>,
  ): Promise<T> {
    if (priority === "cancellation") {
      if (this.cancellationRequestsInFlight >= MAX_CANCELLATION_REQUESTS_IN_FLIGHT) {
        return Promise.reject(new Error("Language-server cancellation capacity was reached."));
      }
      this.cancellationRequestsInFlight += 1;
      return this.dispatchUnscoped(handleId, dispatch, () => {
        this.cancellationRequestsInFlight = Math.max(0, this.cancellationRequestsInFlight - 1);
      });
    }
    if (priority === "immediate") {
      if (this.immediateRequestsInFlight >= MAX_IMMEDIATE_REQUESTS_IN_FLIGHT) {
        return Promise.resolve(fallback);
      }
      this.immediateRequestsInFlight += 1;
      return this.dispatchUnscoped(handleId, dispatch, () => {
        this.immediateRequestsInFlight = Math.max(0, this.immediateRequestsInFlight - 1);
      });
    }
    if (
      priority === "interactive" &&
      this.prioritizedDispatchesInFlight >= MAX_RETAINED_DISPATCHED_HANDLES
    ) {
      return Promise.resolve(fallback);
    }
    const state = this.scopeState(scope);
    if (
      priority === "decorative" &&
      state.interactiveInFlight === 0 &&
      !state.decorativeDispatchInFlight &&
      state.deferred.length === 0
    ) {
      if (!this.canAdmitDecorativeDispatch(handleId, false)) {
        this.pruneScope(scope, state);
        return Promise.resolve(fallback);
      }
      return this.dispatchDecorativeNow(scope, state, handleId, handleId, dispatch);
    }
    const shouldDeferDecorative =
      priority === "decorative" &&
      (state.interactiveInFlight > 0 ||
        state.decorativeDispatchInFlight ||
        state.deferred.length > 0);
    if (!shouldDeferDecorative) {
      this.prioritizedDispatchesInFlight += 1;
      return this.dispatchNow(scope, priority, handleId, handleId, dispatch);
    }

    return new Promise<T>((resolve, reject) => {
      const entry: DeferredRequest = {
        handleId,
        release: () => {
          if (entry.settled) {
            return;
          }
          const currentState = this.scopes.get(scope);
          if (
            !currentState ||
            currentState.interactiveInFlight > 0 ||
            currentState.decorativeDispatchInFlight
          ) {
            return;
          }
          if (!this.canAdmitDecorativeDispatch(handleId, true)) {
            entry.settleWithFallback();
            this.releaseNextDeferred(currentState);
            return;
          }
          this.decorativeRequestsInFlight += 1;
          this.prioritizedDispatchesInFlight += 1;
          currentState.decorativeDispatchInFlight = true;
          this.forgetDeferred(scope, entry);
          let dispatched: Promise<T>;
          try {
            dispatched = this.dispatchNow(scope, "decorative", handleId, undefined, dispatch);
          } catch (error) {
            dispatched = Promise.reject(error);
          }
          dispatched
            .then(resolve, reject)
            .finally(() => this.finishDecorativeDispatch(scope, currentState));
        },
        settleWithFallback: () => {
          if (entry.settled) {
            return;
          }
          this.forgetDeferred(scope, entry);
          resolve(fallback);
        },
        settled: false,
        timer: undefined,
      };
      entry.timer = this.setTimer(() => this.expireDeferred(scope, entry), this.deferralMs);
      this.admitDeferred(scope, state, entry);
    });
  }

  resolveCancellation(scope: string, handleId: number): LanguageServerCancellationTarget {
    const deferred = this.deferredByHandleId.get(handleId);
    if (deferred) {
      if (deferred.scope !== scope) {
        return { kind: "foreign" };
      }
      deferred.entry.settleWithFallback();
      return { kind: "dropped" };
    }
    const dispatched = this.wireRequestByHandleId.get(handleId);
    if (!dispatched) {
      return { kind: "unknown" };
    }
    if (dispatched.scope !== scope) {
      return { kind: "foreign" };
    }
    return { kind: "dispatched", wireRequestId: dispatched.wireRequestId };
  }

  retireScope(scope: string): void {
    const state = this.scopes.get(scope);
    if (!state) {
      return;
    }
    for (const entry of [...state.deferred]) {
      entry.settleWithFallback();
    }
    this.pruneScope(scope, state);
  }

  private admitDeferred(scope: string, state: ScopeState, entry: DeferredRequest): void {
    while (this.deferredInAdmissionOrder.length >= MAX_DEFERRED_DECORATIVE_REQUESTS) {
      const oldest = this.deferredInAdmissionOrder[0];
      if (!oldest) {
        break;
      }
      oldest.settleWithFallback();
    }
    state.deferred.push(entry);
    this.deferredInAdmissionOrder.push(entry);
    if (entry.handleId !== undefined) {
      this.deferredByHandleId.set(entry.handleId, { entry, scope });
    }
  }

  private forgetDeferred(scope: string, entry: DeferredRequest): void {
    entry.settled = true;
    if (entry.timer !== undefined) {
      this.clearTimer(entry.timer);
      entry.timer = undefined;
    }
    if (entry.handleId !== undefined) {
      this.deferredByHandleId.delete(entry.handleId);
    }
    const state = this.scopes.get(scope);
    const globalIndex = this.deferredInAdmissionOrder.indexOf(entry);
    if (globalIndex >= 0) {
      this.deferredInAdmissionOrder.splice(globalIndex, 1);
    }
    if (!state) {
      return;
    }
    const index = state.deferred.indexOf(entry);
    if (index >= 0) {
      state.deferred.splice(index, 1);
    }
    this.pruneScope(scope, state);
  }

  private dispatchNow<T>(
    scope: string,
    priority: LanguageServerRequestPriority,
    handleId: number | undefined,
    reusableWireRequestId: number | undefined,
    dispatch: (wireRequestId: number) => Promise<T>,
  ): Promise<T> {
    const wireRequestId = reusableWireRequestId ?? this.allocateRequestId();
    if (handleId !== undefined) {
      this.rememberDispatchedHandle(scope, handleId, wireRequestId);
    }
    if (priority !== "interactive") {
      let dispatched: Promise<T>;
      try {
        dispatched = dispatch(wireRequestId);
      } catch (error) {
        dispatched = Promise.reject(error);
      }
      return Promise.resolve(dispatched).finally(() => this.settle(scope, handleId, false));
    }

    const state = this.scopeState(scope);
    state.interactiveInFlight += 1;
    let dispatched: Promise<T>;
    try {
      dispatched = dispatch(wireRequestId);
    } catch (error) {
      dispatched = Promise.reject(error);
    }
    return Promise.resolve(dispatched).finally(() => this.settle(scope, handleId, true));
  }

  private dispatchUnscoped<T>(
    handleId: number | undefined,
    dispatch: (wireRequestId: number) => Promise<T>,
    settle: () => void,
  ): Promise<T> {
    let dispatched: Promise<T>;
    try {
      const wireRequestId = handleId ?? this.allocateRequestId();
      dispatched = dispatch(wireRequestId);
    } catch (error) {
      dispatched = Promise.reject(error);
    }
    return Promise.resolve(dispatched).finally(settle);
  }

  private settle(scope: string, handleId: number | undefined, interactive: boolean): void {
    if (handleId !== undefined) {
      this.wireRequestByHandleId.delete(handleId);
    }
    const state = this.scopes.get(scope);
    if (!state) {
      return;
    }
    if (!interactive) {
      this.pruneScope(scope, state);
      return;
    }
    this.prioritizedDispatchesInFlight = Math.max(0, this.prioritizedDispatchesInFlight - 1);
    state.interactiveInFlight = Math.max(0, state.interactiveInFlight - 1);
    if (state.interactiveInFlight > 0) {
      this.pruneScope(scope, state);
      return;
    }
    this.releaseNextDeferred(state);
    this.pruneScope(scope, state);
  }

  private expireDeferred(scope: string, entry: DeferredRequest): void {
    const state = this.scopes.get(scope);
    if (!state || state.interactiveInFlight > 0 || state.decorativeDispatchInFlight) {
      entry.settleWithFallback();
      return;
    }
    entry.release();
  }

  private dispatchDecorativeNow<T>(
    scope: string,
    state: ScopeState,
    handleId: number | undefined,
    reusableWireRequestId: number | undefined,
    dispatch: (wireRequestId: number) => Promise<T>,
  ): Promise<T> {
    this.decorativeRequestsInFlight += 1;
    this.prioritizedDispatchesInFlight += 1;
    state.decorativeDispatchInFlight = true;
    let dispatched: Promise<T>;
    try {
      dispatched = this.dispatchNow(scope, "decorative", handleId, reusableWireRequestId, dispatch);
    } catch (error) {
      dispatched = Promise.reject(error);
    }
    return dispatched.finally(() => this.finishDecorativeDispatch(scope, state));
  }

  private finishDecorativeDispatch(scope: string, state: ScopeState): void {
    this.decorativeRequestsInFlight = Math.max(0, this.decorativeRequestsInFlight - 1);
    this.prioritizedDispatchesInFlight = Math.max(0, this.prioritizedDispatchesInFlight - 1);
    state.decorativeDispatchInFlight = false;
    if (this.scopes.get(scope) !== state) {
      return;
    }
    this.releaseNextDeferred(state);
    this.pruneScope(scope, state);
  }

  private releaseNextDeferred(state: ScopeState): void {
    if (state.interactiveInFlight > 0 || state.decorativeDispatchInFlight) {
      return;
    }
    state.deferred[0]?.release();
  }

  private rememberDispatchedHandle(scope: string, handleId: number, wireRequestId: number): void {
    this.wireRequestByHandleId.set(handleId, { scope, wireRequestId });
  }

  private canAdmitDecorativeDispatch(
    handleId: number | undefined,
    requiresRestamp: boolean,
  ): boolean {
    if (
      this.decorativeRequestsInFlight >= MAX_DECORATIVE_REQUESTS_IN_FLIGHT ||
      this.prioritizedDispatchesInFlight >= MAX_RETAINED_DISPATCHED_HANDLES
    ) {
      return false;
    }
    return !requiresRestamp || handleId === undefined || !this.wireRequestByHandleId.has(handleId);
  }

  private scopeState(scope: string): ScopeState {
    const existing = this.scopes.get(scope);
    if (existing) {
      return existing;
    }
    const created: ScopeState = {
      deferred: [],
      decorativeDispatchInFlight: false,
      interactiveInFlight: 0,
    };
    this.scopes.set(scope, created);
    return created;
  }

  private pruneScope(scope: string, state: ScopeState): void {
    if (
      state.interactiveInFlight > 0 ||
      state.decorativeDispatchInFlight ||
      state.deferred.length > 0
    ) {
      return;
    }
    this.scopes.delete(scope);
  }
}
