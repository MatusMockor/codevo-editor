import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import type {
  RemoteRepositoryIdentityGateway,
  RemoteRepositoryIdentityRequest,
} from "../domain/remoteRepositoryIdentity";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";
import {
  SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  repositoryIdentityRetryDelay,
  type RepositoryIdentityTimers,
} from "./repositoryIdentityRetry";

export type RepositoryIdentityTarget = Readonly<{ key: string; root: string; authority: string }>;

export type RepositoryIdentityOutcome =
  | Readonly<{ kind: "identity"; identity: string }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "failed"; retrying: boolean }>;

export type RepositoryIdentityOutcomes = ReadonlyMap<string, RepositoryIdentityOutcome>;

export const MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS = 4;
const MAX_REPOSITORY_IDENTITY_LOOKUPS = 2;
const MAX_DROPPED_REPOSITORY_IDENTITY_LOOKUPS =
  MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS - MAX_REPOSITORY_IDENTITY_LOOKUPS;
export const LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS = 10_000;
export const REMOTE_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS = 60_000;

type Attempt =
  Exclude<RepositoryIdentityOutcome, { kind: "failed" }> | Readonly<{ kind: "rejected" }>;
type Phase = "queued" | "running" | "waiting" | "paused" | "exhausted" | "settled";
type Entry = {
  readonly id: string;
  readonly target: RepositoryIdentityTarget;
  phase: Phase;
  failures: number;
  retryAt: number;
  outcome: RepositoryIdentityOutcome | null;
  cancelRetry: (() => void) | null;
};
type Flight = {
  readonly entry: Entry;
  readonly deadline: number;
  abandoned: boolean;
  cancelTimeout: (() => void) | null;
};
type Pass = Readonly<{
  order: readonly string[];
  local: RepositoryIdentityGateway | null;
  remote: RemoteRepositoryIdentityGateway | null;
  publish(outcomes: RepositoryIdentityOutcomes): void;
}>;

const NONE: Attempt = Object.freeze({ kind: "none" });
const UNAVAILABLE: Attempt = Object.freeze({ kind: "unavailable" });
const REJECTED: Attempt = Object.freeze({ kind: "rejected" });
const FAILED_RETRYING: RepositoryIdentityOutcome = Object.freeze({
  kind: "failed",
  retrying: true,
});
const FAILED_EXHAUSTED: RepositoryIdentityOutcome = Object.freeze({
  kind: "failed",
  retrying: false,
});
const NOTHING_PUBLISHED: RepositoryIdentityOutcomes = new Map();

export function repositoryIdentityTargetId(target: RepositoryIdentityTarget): string {
  return JSON.stringify([target.key, target.root, target.authority]);
}

function isRemoteTarget(target: RepositoryIdentityTarget): boolean {
  return target.key.startsWith("remote:");
}

function lookupTimeout(target: RepositoryIdentityTarget): number {
  return isRemoteTarget(target)
    ? REMOTE_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS
    : LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS;
}

function sameOutcomes(
  left: RepositoryIdentityOutcomes,
  right: RepositoryIdentityOutcomes,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, outcome] of left) if (right.get(id) !== outcome) return false;
  return true;
}

export class ProjectRepositoryIdentityDiscovery {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Set<Flight>();
  private pass: Pass | null = null;
  private abandoned = 0;
  private local: RepositoryIdentityGateway | null = null;
  private remote: RemoteRepositoryIdentityGateway | null = null;
  private published: RepositoryIdentityOutcomes = NOTHING_PUBLISHED;

  constructor(
    private readonly timers: RepositoryIdentityTimers = SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  ) {}

  start(
    targets: readonly RepositoryIdentityTarget[],
    local: RepositoryIdentityGateway | null,
    remote: RemoteRepositoryIdentityGateway | null,
    publish: Pass["publish"],
  ): () => void {
    this.halt();
    if (this.local !== local || this.remote !== remote) this.entries.clear();
    this.local = local;
    this.remote = remote;
    const wanted = new Map(
      targets
        .slice(0, MAX_AGENT_PROJECT_ROOTS)
        .map((target) => [repositoryIdentityTargetId(target), target]),
    );
    for (const id of [...this.entries.keys()]) if (!wanted.has(id)) this.entries.delete(id);
    for (const flight of [...this.flights]) this.abandonDropped(flight);
    for (const [id, target] of wanted) this.admit(id, target);
    const pass: Pass = { order: [...wanted.keys()], local, remote, publish };
    this.pass = pass;
    for (const flight of this.flights) this.watch(flight);
    for (const entry of this.entries.values()) if (entry.phase === "paused") this.arm(entry);
    this.emit();
    this.pump();
    return () => {
      if (this.pass === pass) this.halt();
    };
  }

  private admit(id: string, target: RepositoryIdentityTarget): void {
    if (this.entries.has(id)) return;
    this.entries.set(id, {
      id,
      target,
      phase: "queued",
      failures: 0,
      retryAt: 0,
      outcome: null,
      cancelRetry: null,
    });
  }

  private abandonDropped(flight: Flight): void {
    if (this.entries.get(flight.entry.id) === flight.entry) return;
    if (this.abandoned >= MAX_DROPPED_REPOSITORY_IDENTITY_LOOKUPS) return;
    this.flights.delete(flight);
    flight.abandoned = true;
    this.abandoned += 1;
  }

  private halt(): void {
    this.pass = null;
    for (const flight of this.flights) {
      flight.cancelTimeout?.();
      flight.cancelTimeout = null;
    }
    for (const entry of this.entries.values()) {
      if (entry.phase !== "waiting") continue;
      entry.cancelRetry?.();
      entry.cancelRetry = null;
      entry.phase = "paused";
    }
  }

  private pump(): void {
    const pass = this.pass;
    if (pass === null) return;
    for (const id of pass.order) {
      if (this.flights.size >= MAX_REPOSITORY_IDENTITY_LOOKUPS) return;
      const entry = this.entries.get(id);
      if (entry?.phase === "queued") this.launch(entry, pass);
    }
  }

  private launch(entry: Entry, pass: Pass): void {
    entry.phase = "running";
    const flight: Flight = {
      entry,
      deadline: this.timers.now() + lookupTimeout(entry.target),
      abandoned: false,
      cancelTimeout: null,
    };
    this.flights.add(flight);
    this.watch(flight);
    void lookup(entry.target, pass.local, pass.remote).then((attempt) =>
      this.land(flight, attempt),
    );
  }

  private watch(flight: Flight): void {
    const remaining = Math.max(0, flight.deadline - this.timers.now());
    flight.cancelTimeout = this.timers.schedule(remaining, () => this.land(flight, REJECTED));
  }

  private land(flight: Flight, attempt: Attempt): void {
    if (flight.abandoned) {
      flight.abandoned = false;
      this.abandoned -= 1;
      return;
    }
    if (!this.flights.delete(flight)) return;
    flight.cancelTimeout?.();
    flight.cancelTimeout = null;
    const entry = flight.entry;
    if (this.entries.get(entry.id) === entry) {
      this.apply(entry, attempt);
      this.emit();
    }
    this.pump();
  }

  private apply(entry: Entry, attempt: Attempt): void {
    if (attempt.kind !== "rejected") {
      entry.phase = "settled";
      entry.outcome = attempt;
      return;
    }
    entry.failures += 1;
    const delay = repositoryIdentityRetryDelay(entry.failures);
    if (delay === null) {
      entry.phase = "exhausted";
      entry.outcome = FAILED_EXHAUSTED;
      return;
    }
    entry.phase = "paused";
    entry.outcome = FAILED_RETRYING;
    entry.retryAt = this.timers.now() + delay;
    if (this.pass !== null) this.arm(entry);
  }

  private arm(entry: Entry): void {
    const remaining = Math.max(0, entry.retryAt - this.timers.now());
    entry.phase = "waiting";
    entry.cancelRetry = this.timers.schedule(remaining, () => this.resume(entry));
  }

  private resume(entry: Entry): void {
    if (this.entries.get(entry.id) !== entry || entry.phase !== "waiting") return;
    entry.cancelRetry = null;
    entry.phase = "queued";
    this.pump();
  }

  private emit(): void {
    const pass = this.pass;
    if (pass === null) return;
    const outcomes = new Map<string, RepositoryIdentityOutcome>();
    for (const id of pass.order) {
      const outcome = this.entries.get(id)?.outcome ?? null;
      if (outcome !== null) outcomes.set(id, outcome);
    }
    if (sameOutcomes(this.published, outcomes)) return;
    this.published = outcomes;
    pass.publish(outcomes);
  }
}

function remoteRequest(key: string): RemoteRepositoryIdentityRequest | null {
  const parts = key.split(":");
  if (parts.length !== 4) return null;
  const [serverId, runnerId, projectId] = parts.slice(1).map(decodeComponent);
  if (!serverId || !runnerId || !projectId) return null;
  const exact = [serverId, runnerId, projectId].every(
    (part, index) => encodeURIComponent(part) === parts[index + 1],
  );
  return exact ? { serverId, runnerId, projectId } : null;
}

function decodeComponent(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function identityAttempt(identity: string | null): Attempt {
  return identity ? { kind: "identity", identity } : NONE;
}

async function read(
  target: RepositoryIdentityTarget,
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): Promise<Attempt> {
  if (!isRemoteTarget(target)) {
    if (local === null) return UNAVAILABLE;
    return identityAttempt(await local.discover(target.root));
  }
  const request = remoteRequest(target.key);
  if (remote === null || request === null) return UNAVAILABLE;
  return identityAttempt(await remote.discover(request));
}

async function lookup(
  target: RepositoryIdentityTarget,
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): Promise<Attempt> {
  try {
    return await read(target, local, remote);
  } catch {
    return REJECTED;
  }
}
