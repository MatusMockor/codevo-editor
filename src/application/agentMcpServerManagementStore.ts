import {
  AGENT_MCP_SERVER_MANAGEMENT_LIMITS,
  agentMcpServerCallbackUrl,
  agentMcpServerManagementErrorKind,
  agentMcpServerSignInHost,
  type AgentMcpServerChange,
  type AgentMcpServerChangeKind,
  type AgentMcpServerLoginDelivery,
  type AgentMcpServerLoginMode,
  type AgentMcpServerLoginStep,
  type AgentMcpServerManagementErrorKind,
} from "../domain/agentMcpServerManagement";
import {
  agentMcpServersTargetKey,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import type { AgentMcpServerManagementScheduler } from "./agentMcpServerManagementScheduler";
import type {
  AgentMcpServerManagement,
  AgentMcpServerManagementSupport,
} from "./agentMcpServerManagementGateway";
import type { AgentMcpServersStore } from "./agentMcpServersStore";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";

export const AGENT_MCP_SERVER_LOGIN_POLL_MS = 1500;
export const MAX_AGENT_MCP_SERVER_LOGIN_POLL_FAILURES = 3;
export const MAX_AGENT_MCP_SERVER_ACTIVITIES = 64;

export type AgentMcpServerActivityError =
  AgentMcpServerManagementErrorKind | "loginFailed" | "loginExpired";
export type AgentMcpServerActivityAction = AgentMcpServerLoginMode | AgentMcpServerChangeKind;
export type AgentMcpServerSignInPage = "opening" | "opened" | "blocked";
export type AgentMcpServerOperationStart = "started" | "busy" | "full";

export type AgentMcpServerActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly mode: AgentMcpServerLoginMode }
  | {
      readonly kind: "waitingForBrowser";
      readonly mode: AgentMcpServerLoginMode;
      readonly delivery: AgentMcpServerLoginDelivery;
      readonly signInHost: string;
      readonly page: AgentMcpServerSignInPage;
      readonly callbackError: AgentMcpServerActivityError | null;
    }
  | {
      readonly kind: "finishInBrowser";
      readonly mode: AgentMcpServerLoginMode;
      readonly signInHost: string;
      readonly page: AgentMcpServerSignInPage;
      readonly checking: boolean;
    }
  | {
      readonly kind: "submittingCallback";
      readonly mode: AgentMcpServerLoginMode;
      readonly signInHost: string;
    }
  | { readonly kind: "changing"; readonly change: AgentMcpServerChangeKind }
  | { readonly kind: "succeeded"; readonly action: AgentMcpServerActivityAction }
  | {
      readonly kind: "failed";
      readonly action: AgentMcpServerActivityAction;
      readonly error: AgentMcpServerActivityError;
    };

export interface AgentMcpServerManagementStore {
  support(target: AgentMcpServersTarget): AgentMcpServerManagementSupport;
  activity(target: AgentMcpServersTarget, name: string): AgentMcpServerActivity;
  subscribe(listener: () => void): () => void;
  signIn(
    target: AgentMcpServersTarget,
    name: string,
    mode: AgentMcpServerLoginMode,
  ): AgentMcpServerOperationStart;
  openSignInPage(target: AgentMcpServersTarget, name: string): void;
  submitCallback(target: AgentMcpServersTarget, name: string, callbackUrl: string): void;
  checkAgain(target: AgentMcpServersTarget, name: string): void;
  cancel(target: AgentMcpServersTarget, name: string): void;
  change(target: AgentMcpServersTarget, change: AgentMcpServerChange): AgentMcpServerOperationStart;
  dispose(): void;
}

export interface AgentMcpServerManagementPorts {
  readonly management: AgentMcpServerManagement;
  readonly statuses: AgentMcpServersStore;
  readonly urlOpener: ExternalUrlOpenerPort;
  readonly scheduler: AgentMcpServerManagementScheduler;
}

type Settled<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly error: AgentMcpServerManagementErrorKind };

type BrowserStep = Exclude<AgentMcpServerLoginStep, { readonly kind: "completed" }>;

interface Slot {
  readonly owner: object;
  state: AgentMcpServerActivity;
  stopWatch: (() => void) | null;
}

interface LoginSession {
  readonly key: string;
  readonly target: AgentMcpServersTarget;
  readonly name: string;
  readonly mode: AgentMcpServerLoginMode;
  loginId: string | null;
  authorizationUrl: string | null;
  pollFailures: number;
  cancelPoll: (() => void) | null;
  cancelDeadline: (() => void) | null;
}

export const IDLE_AGENT_MCP_SERVER_ACTIVITY: AgentMcpServerActivity = Object.freeze({
  kind: "idle",
});

export const UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT: AgentMcpServerManagementStore = Object.freeze(
  {
    support: () => "unsupported" as const,
    activity: () => IDLE_AGENT_MCP_SERVER_ACTIVITY,
    subscribe: () => ignoreUnsubscribe,
    signIn: () => "busy" as const,
    openSignInPage: ignoreCall,
    submitCallback: ignoreCall,
    checkAgain: ignoreCall,
    cancel: ignoreCall,
    change: () => "busy" as const,
    dispose: ignoreCall,
  },
);

export function agentMcpServerActivityIsBusy(activity: AgentMcpServerActivity): boolean {
  switch (activity.kind) {
    case "starting":
    case "waitingForBrowser":
    case "finishInBrowser":
    case "submittingCallback":
    case "changing":
      return true;
    case "idle":
    case "succeeded":
    case "failed":
      return false;
    default: {
      const unreachable: never = activity;
      return unreachable;
    }
  }
}

export class AgentMcpServerManagementCoordinator implements AgentMcpServerManagementStore {
  private readonly management: AgentMcpServerManagement;
  private readonly statuses: AgentMcpServersStore;
  private readonly urlOpener: ExternalUrlOpenerPort;
  private readonly scheduler: AgentMcpServerManagementScheduler;
  private readonly maxActivities: number;
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();
  private login: LoginSession | null = null;

  constructor(
    ports: AgentMcpServerManagementPorts,
    maxActivities = MAX_AGENT_MCP_SERVER_ACTIVITIES,
  ) {
    this.management = ports.management;
    this.statuses = ports.statuses;
    this.urlOpener = ports.urlOpener;
    this.scheduler = ports.scheduler;
    this.maxActivities = Math.max(1, maxActivities);
  }

  support(target: AgentMcpServersTarget): AgentMcpServerManagementSupport {
    return this.management.support(target);
  }

  activity(target: AgentMcpServersTarget, name: string): AgentMcpServerActivity {
    return this.slots.get(activityKey(target, name))?.state ?? IDLE_AGENT_MCP_SERVER_ACTIVITY;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  signIn(
    target: AgentMcpServersTarget,
    name: string,
    mode: AgentMcpServerLoginMode,
  ): AgentMcpServerOperationStart {
    const key = activityKey(target, name);
    const occupied = this.slots.get(key);
    if (occupied?.state.kind === "changing" || isSettling(occupied)) return "busy";
    const previous = this.login;
    if (!this.admits(key, previous)) return "full";
    if (previous !== null) this.detach(previous);
    const session: LoginSession = {
      key,
      target: Object.freeze({ ...target }),
      name,
      mode,
      loginId: null,
      authorizationUrl: null,
      pollFailures: 0,
      cancelPoll: null,
      cancelDeadline: null,
    };
    this.login = session;
    session.cancelDeadline = this.scheduler.schedule(
      AGENT_MCP_SERVER_MANAGEMENT_LIMITS.loginDeadlineMs,
      () => this.expire(session),
    );
    this.install(key, session, { kind: "starting", mode });
    if (previous !== null) this.refreshClearedSignIn(previous);
    this.notify();
    void this.start(session);
    return "started";
  }

  openSignInPage(target: AgentMcpServersTarget, name: string): void {
    const session = this.sessionOf(target, name);
    const authorizationUrl = session?.authorizationUrl ?? null;
    if (session === null || authorizationUrl === null) return;
    this.showPage(session, "opening");
    void this.open(session, authorizationUrl);
  }

  submitCallback(target: AgentMcpServersTarget, name: string, callbackUrl: string): void {
    const session = this.sessionOf(target, name);
    const state = session === null ? null : this.stateOf(session);
    const loginId = session?.loginId ?? null;
    if (session === null || loginId === null) return;
    if (state?.kind !== "waitingForBrowser" || state.delivery !== "paste") return;
    const url = agentMcpServerCallbackUrl(callbackUrl);
    if (url === null) {
      this.show(session, { ...state, callbackError: "callbackRejected" });
      return;
    }
    this.show(session, {
      kind: "submittingCallback",
      mode: state.mode,
      signInHost: state.signInHost,
    });
    void this.submit(session, loginId, url, state.signInHost);
  }

  checkAgain(target: AgentMcpServersTarget, name: string): void {
    const session = this.sessionOf(target, name);
    if (session === null) return;
    this.recheck(session);
  }

  cancel(target: AgentMcpServersTarget, name: string): void {
    const key = activityKey(target, name);
    const session = this.login;
    if (session !== null && session.key === key) {
      this.detach(session);
      this.refreshClearedSignIn(session);
      this.notify();
      return;
    }
    const slot = this.slots.get(key);
    if (slot?.state.kind !== "failed") return;
    this.slots.delete(key);
    this.notify();
  }

  change(
    target: AgentMcpServersTarget,
    change: AgentMcpServerChange,
  ): AgentMcpServerOperationStart {
    const key = activityKey(target, change.name);
    const occupied = this.slots.get(key);
    if (occupied !== undefined && agentMcpServerActivityIsBusy(occupied.state)) return "busy";
    if (isSettling(occupied)) return "busy";
    if (!this.admits(key, null)) return "full";
    const owner = {};
    this.install(key, owner, { kind: "changing", change: change.kind });
    this.notify();
    void this.apply(key, owner, Object.freeze({ ...target }), change);
    return "started";
  }

  dispose(): void {
    const session = this.login;
    if (session !== null) this.cancelBackend(session);
    if (session !== null) this.release(session);
    if (this.slots.size === 0) return;
    for (const slot of this.slots.values()) stopWatching(slot);
    this.slots.clear();
    this.notify();
  }

  private async start(session: LoginSession): Promise<void> {
    if (!this.owns(session)) return;
    const outcome = await settled(() =>
      this.management.startLogin(session.target, session.name, session.mode),
    );
    if (!this.owns(session)) {
      this.abandon(session.target, outcome);
      return;
    }
    if (outcome.kind === "failed") {
      this.fail(session, outcome.error);
      return;
    }
    const step = outcome.value;
    switch (step.kind) {
      case "completed":
        this.succeed(session);
        return;
      case "finishInBrowser":
      case "awaitingCallback":
        this.awaitBrowser(session, step);
        return;
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  }

  private awaitBrowser(session: LoginSession, step: BrowserStep): void {
    const signInHost = agentMcpServerSignInHost(step.authorizationUrl);
    if (signInHost === null) {
      this.abandon(session.target, { kind: "ok", value: step });
      this.fail(session, "unavailable");
      return;
    }
    session.authorizationUrl = step.authorizationUrl;
    if (step.kind === "awaitingCallback") session.loginId = step.loginId;
    this.show(session, browserActivity(session.mode, step, signInHost));
    if (!this.owns(session)) return;
    if (step.kind === "awaitingCallback") this.schedulePoll(session);
    void this.open(session, step.authorizationUrl);
  }

  private async open(session: LoginSession, authorizationUrl: string): Promise<void> {
    if (!this.owns(session)) return;
    const outcome = await settled(() => this.urlOpener.openExternal(authorizationUrl));
    if (!this.owns(session)) return;
    this.showPage(session, outcome.kind === "ok" ? "opened" : "blocked");
  }

  private schedulePoll(session: LoginSession): void {
    session.cancelPoll = this.scheduler.schedule(AGENT_MCP_SERVER_LOGIN_POLL_MS, () => {
      session.cancelPoll = null;
      void this.poll(session);
    });
  }

  private async poll(session: LoginSession): Promise<void> {
    const loginId = session.loginId;
    if (!this.owns(session) || loginId === null) return;
    const outcome = await settled(() => this.management.loginState(session.target, loginId));
    if (!this.owns(session)) return;
    if (outcome.kind === "failed") {
      this.pollFailed(session, outcome.error);
      return;
    }
    session.pollFailures = 0;
    switch (outcome.value) {
      case "pending":
        this.schedulePoll(session);
        return;
      case "succeeded":
        this.succeed(session);
        return;
      case "failed":
        this.fail(session, "loginFailed");
        return;
      default: {
        const unreachable: never = outcome.value;
        return unreachable;
      }
    }
  }

  private pollFailed(session: LoginSession, error: AgentMcpServerManagementErrorKind): void {
    session.pollFailures += 1;
    const retry =
      isTransient(error) && session.pollFailures < MAX_AGENT_MCP_SERVER_LOGIN_POLL_FAILURES;
    if (retry) {
      this.schedulePoll(session);
      return;
    }
    if (error !== "loginInactive") this.cancelBackend(session);
    this.fail(session, error);
  }

  private async submit(
    session: LoginSession,
    loginId: string,
    callbackUrl: string,
    signInHost: string,
  ): Promise<void> {
    if (!this.owns(session)) return;
    const outcome = await settled(() =>
      this.management.submitLoginCallback(session.target, loginId, callbackUrl),
    );
    if (!this.owns(session) || outcome.kind === "ok") return;
    if (outcome.error === "loginInactive") {
      this.fail(session, outcome.error);
      return;
    }
    this.show(session, {
      kind: "waitingForBrowser",
      mode: session.mode,
      delivery: "paste",
      signInHost,
      page: "opened",
      callbackError: outcome.error,
    });
  }

  private async apply(
    key: string,
    owner: object,
    target: AgentMcpServersTarget,
    change: AgentMcpServerChange,
  ): Promise<void> {
    if (!this.holds(key, owner)) return;
    const outcome = await settled(() => this.management.change(target, change));
    const slot = this.slots.get(key);
    if (slot?.owner !== owner) return;
    if (outcome.kind === "failed") {
      slot.state = Object.freeze({ kind: "failed", action: change.kind, error: outcome.error });
      this.notify();
      return;
    }
    this.settle(slot, key, target, { kind: "succeeded", action: change.kind });
  }

  private expire(session: LoginSession): void {
    if (!this.owns(session)) return;
    if (this.stateOf(session)?.kind === "finishInBrowser") {
      this.recheck(session);
      return;
    }
    this.cancelBackend(session);
    this.fail(session, "loginExpired");
  }

  private recheck(session: LoginSession): void {
    const state = this.stateOf(session);
    if (state?.kind !== "finishInBrowser" || state.checking) return;
    this.release(session);
    this.settleSession(session, { ...state, checking: true });
  }

  private succeed(session: LoginSession): void {
    this.release(session);
    this.settleSession(session, { kind: "succeeded", action: session.mode });
  }

  private fail(session: LoginSession, error: AgentMcpServerActivityError): void {
    this.release(session);
    const slot = this.slots.get(session.key);
    if (slot?.owner !== session) return;
    slot.state = Object.freeze({ kind: "failed", action: session.mode, error });
    this.refreshClearedSignIn(session);
    this.notify();
  }

  private settleSession(session: LoginSession, state: AgentMcpServerActivity): void {
    const slot = this.slots.get(session.key);
    if (slot?.owner !== session) return;
    this.settle(slot, session.key, session.target, state);
  }

  private settle(
    slot: Slot,
    key: string,
    target: AgentMcpServersTarget,
    state: AgentMcpServerActivity,
  ): void {
    slot.state = Object.freeze(state);
    this.watchRefresh(slot, key, target);
    this.notify();
  }

  private detach(session: LoginSession): void {
    this.cancelBackend(session);
    this.release(session);
    const slot = this.slots.get(session.key);
    if (slot?.owner !== session) return;
    stopWatching(slot);
    this.slots.delete(session.key);
  }

  private release(session: LoginSession): void {
    session.cancelPoll?.();
    session.cancelDeadline?.();
    session.cancelPoll = null;
    session.cancelDeadline = null;
    session.loginId = null;
    session.authorizationUrl = null;
    if (this.login === session) this.login = null;
  }

  private cancelBackend(session: LoginSession): void {
    const loginId = session.loginId;
    if (loginId === null) return;
    void settled(() => this.management.cancelLogin(session.target, loginId));
  }

  private abandon(target: AgentMcpServersTarget, outcome: Settled<AgentMcpServerLoginStep>): void {
    if (outcome.kind !== "ok" || outcome.value.kind !== "awaitingCallback") return;
    const loginId = outcome.value.loginId;
    void settled(() => this.management.cancelLogin(target, loginId));
  }

  private refreshClearedSignIn(session: LoginSession): void {
    if (session.mode !== "signInAgain") return;
    this.statuses.refresh(session.target);
  }

  private watchRefresh(slot: Slot, key: string, target: AgentMcpServersTarget): void {
    if (this.slots.get(key) !== slot || slot.stopWatch !== null) return;
    let awaitingStaleCheck = this.statuses.state(target).kind === "loading";
    const onStatus = (): void => {
      if (this.slots.get(key) !== slot || slot.stopWatch === null) return;
      if (this.statuses.state(target).kind === "loading") return;
      if (awaitingStaleCheck) {
        awaitingStaleCheck = false;
        this.statuses.refresh(target);
        return;
      }
      stopWatching(slot);
      this.slots.delete(key);
      this.notify();
    };
    slot.stopWatch = this.statuses.subscribe(target, onStatus);
    if (!awaitingStaleCheck) this.statuses.refresh(target);
  }

  private admits(key: string, replaced: LoginSession | null): boolean {
    if (this.slots.has(key)) return true;
    if (replaced !== null && this.holds(replaced.key, replaced)) return true;
    if (this.slots.size < this.maxActivities) return true;
    return this.evictOldestFailure();
  }

  private evictOldestFailure(): boolean {
    for (const [key, slot] of this.slots) {
      if (slot.state.kind !== "failed") continue;
      this.slots.delete(key);
      return true;
    }
    return false;
  }

  private sessionOf(target: AgentMcpServersTarget, name: string): LoginSession | null {
    const session = this.login;
    if (session === null || session.key !== activityKey(target, name)) return null;
    return session;
  }

  private stateOf(session: LoginSession): AgentMcpServerActivity | null {
    const slot = this.slots.get(session.key);
    return slot?.owner === session ? slot.state : null;
  }

  private owns(session: LoginSession): boolean {
    return this.login === session;
  }

  private holds(key: string, owner: object): boolean {
    return this.slots.get(key)?.owner === owner;
  }

  private showPage(session: LoginSession, page: AgentMcpServerSignInPage): void {
    const state = this.stateOf(session);
    if (state?.kind !== "waitingForBrowser" && state?.kind !== "finishInBrowser") return;
    this.show(session, { ...state, page });
  }

  private show(session: LoginSession, state: AgentMcpServerActivity): void {
    const slot = this.slots.get(session.key);
    if (slot?.owner !== session) return;
    slot.state = Object.freeze(state);
    this.notify();
  }

  private install(key: string, owner: object, state: AgentMcpServerActivity): void {
    const replaced = this.slots.get(key);
    if (replaced !== undefined) stopWatching(replaced);
    this.slots.delete(key);
    this.slots.set(key, { owner, state: Object.freeze(state), stopWatch: null });
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function isSettling(slot: Slot | undefined): boolean {
  return slot !== undefined && slot.stopWatch !== null;
}

function stopWatching(slot: Slot): void {
  const stop = slot.stopWatch;
  slot.stopWatch = null;
  stop?.();
}

function browserActivity(
  mode: AgentMcpServerLoginMode,
  step: BrowserStep,
  signInHost: string,
): AgentMcpServerActivity {
  switch (step.kind) {
    case "finishInBrowser":
      return { kind: "finishInBrowser", mode, signInHost, page: "opening", checking: false };
    case "awaitingCallback":
      return {
        kind: "waitingForBrowser",
        mode,
        delivery: step.delivery,
        signInHost,
        page: "opening",
        callbackError: null,
      };
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

function ignoreCall(): void {}

function ignoreUnsubscribe(): void {}

function activityKey(target: AgentMcpServersTarget, name: string): string {
  return JSON.stringify([agentMcpServersTargetKey(target), name]);
}

function isTransient(error: AgentMcpServerManagementErrorKind): boolean {
  switch (error) {
    case "busy":
    case "timedOut":
    case "unavailable":
    case "serverUnavailable":
      return true;
    case "unknownWorkspace":
    case "untrustedWorkspace":
    case "providerDisabled":
    case "unsupportedRunner":
    case "invalidRequest":
    case "serverExists":
    case "serverNotFound":
    case "changeUnsupported":
    case "loginUnsupported":
    case "loginInactive":
    case "callbackRejected":
      return false;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

async function settled<T>(work: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { kind: "ok", value: await work() };
  } catch (error) {
    return { kind: "failed", error: agentMcpServerManagementErrorKind(error) };
  }
}
