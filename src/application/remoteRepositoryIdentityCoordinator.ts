import type {
  RemoteRepositoryIdentityGateway,
  RemoteRepositoryIdentityRequest,
} from "../domain/remoteRepositoryIdentity";
import {
  SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  type RepositoryIdentityTimers,
} from "./repositoryIdentityRetry";

export const MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY = 2;
export const MAX_REMOTE_REPOSITORY_IDENTITY_QUEUE = 64;
export const MAX_REMOTE_REPOSITORY_IDENTITY_SERVERS = 64;
export const MAX_REMOTE_REPOSITORY_IDENTITY_CACHE = 64;
export const REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS = 30_000;
export const REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS = 45_000;

type Settled = Readonly<{ value: string | null; settledAt: number }>;
type Job = Readonly<{
  key: string;
  request: RemoteRepositoryIdentityRequest;
  resolve(value: string | null): void;
  reject(reason: unknown): void;
}>;
type Lane = { active: number; readonly waiting: Job[] };
type Attempt =
  Readonly<{ ok: true; value: string | null }> | Readonly<{ ok: false; reason: unknown }>;

async function attempt(
  gateway: RemoteRepositoryIdentityGateway,
  request: RemoteRepositoryIdentityRequest,
): Promise<Attempt> {
  try {
    return { ok: true, value: await gateway.discover(request) };
  } catch (reason) {
    return { ok: false, reason };
  }
}

function busy(): Promise<never> {
  return Promise.reject(new Error("Remote repository identity lookups are busy."));
}

function timedOut(): Attempt {
  return { ok: false, reason: new Error("Remote repository identity lookup timed out.") };
}

export class RemoteRepositoryIdentityCoordinator implements RemoteRepositoryIdentityGateway {
  private readonly settled = new Map<string, Settled>();
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private readonly lanes = new Map<string, Lane>();

  constructor(
    private readonly gateway: RemoteRepositoryIdentityGateway,
    private readonly timers: RepositoryIdentityTimers = SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  ) {}

  discover(request: RemoteRepositoryIdentityRequest): Promise<string | null> {
    const exact: RemoteRepositoryIdentityRequest = {
      serverId: request.serverId,
      runnerId: request.runnerId,
      projectId: request.projectId,
    };
    const key = JSON.stringify([exact.serverId, exact.runnerId, exact.projectId]);
    const cached = this.fresh(key);
    if (cached !== null) return Promise.resolve(cached.value);
    const shared = this.inFlight.get(key);
    if (shared !== undefined) return shared;
    const lane = this.lane(exact.serverId);
    if (lane === null || lane.waiting.length >= MAX_REMOTE_REPOSITORY_IDENTITY_QUEUE) return busy();
    const pending = new Promise<string | null>((resolve, reject) => {
      lane.waiting.push({ key, request: exact, resolve, reject });
    });
    this.inFlight.set(key, pending);
    this.lanes.set(exact.serverId, lane);
    this.pump(exact.serverId);
    return pending;
  }

  private lane(serverId: string): Lane | null {
    const known = this.lanes.get(serverId);
    if (known !== undefined) return known;
    if (this.lanes.size >= MAX_REMOTE_REPOSITORY_IDENTITY_SERVERS) return null;
    return { active: 0, waiting: [] };
  }

  private pump(serverId: string): void {
    const lane = this.lanes.get(serverId);
    if (lane === undefined) return;
    while (lane.active < MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY) {
      const job = lane.waiting.shift();
      if (job === undefined) break;
      this.run(lane, job);
    }
    if (lane.active === 0 && lane.waiting.length === 0) this.lanes.delete(serverId);
  }

  private run(lane: Lane, job: Job): void {
    let open = true;
    let cancelTimeout: (() => void) | null = null;
    const close = (result: Attempt): void => {
      if (!open) return;
      open = false;
      cancelTimeout?.();
      lane.active -= 1;
      this.inFlight.delete(job.key);
      this.finish(job, result);
      this.pump(job.request.serverId);
    };
    lane.active += 1;
    cancelTimeout = this.timers.schedule(REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS, () =>
      close(timedOut()),
    );
    void attempt(this.gateway, job.request).then((result) => {
      if (open) {
        close(result);
        return;
      }
      this.rememberLate(job.key, result);
    });
  }

  private rememberLate(key: string, result: Attempt): void {
    if (!result.ok || this.fresh(key) !== null) return;
    this.remember(key, result.value);
  }

  private finish(job: Job, result: Attempt): void {
    if (!result.ok) {
      job.reject(result.reason);
      return;
    }
    this.remember(job.key, result.value);
    job.resolve(result.value);
  }

  private remember(key: string, value: string | null): void {
    this.settled.delete(key);
    this.settled.set(key, { value, settledAt: this.timers.now() });
    for (const oldest of this.settled.keys()) {
      if (this.settled.size <= MAX_REMOTE_REPOSITORY_IDENTITY_CACHE) return;
      this.settled.delete(oldest);
    }
  }

  private fresh(key: string): Settled | null {
    const entry = this.settled.get(key);
    if (entry === undefined) return null;
    const age = this.timers.now() - entry.settledAt;
    if (age >= 0 && age < REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS) return entry;
    this.settled.delete(key);
    return null;
  }
}
