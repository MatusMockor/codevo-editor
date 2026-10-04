import type { RepositoryIdentityTimers } from "../application/repositoryIdentityRetry";
import type {
  RemoteRepositoryIdentityGateway,
  RemoteRepositoryIdentityRequest,
} from "../domain/remoteRepositoryIdentity";

interface ScheduledTimer {
  readonly at: number;
  readonly delayMs: number;
  readonly run: () => void;
}

export function manualIdentityTimers() {
  const pending: ScheduledTimer[] = [];
  const scheduled: number[] = [];
  let now = 0;
  const timers: RepositoryIdentityTimers = {
    now: () => now,
    schedule(delayMs, run) {
      const timer = { at: now + delayMs, delayMs, run };
      pending.push(timer);
      scheduled.push(delayMs);
      return () => {
        const index = pending.indexOf(timer);
        if (index >= 0) pending.splice(index, 1);
      };
    },
  };
  const nextDue = (limit: number): ScheduledTimer | null => {
    const due = pending.filter((timer) => timer.at <= limit).sort((a, b) => a.at - b.at)[0];
    return due ?? null;
  };
  const advance = (ms: number): void => {
    const limit = now + ms;
    for (let due = nextDue(limit); due !== null; due = nextDue(limit)) {
      pending.splice(pending.indexOf(due), 1);
      now = due.at;
      due.run();
    }
    now = limit;
  };
  return {
    timers,
    scheduled,
    advance,
    pendingDelays: () => pending.map((timer) => timer.delayMs),
    pendingCount: () => pending.length,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Reply = () => Promise<string | null>;

export function recordingRemoteIdentityGateway(
  reply: (request: RemoteRepositoryIdentityRequest, call: number) => Promise<string | null>,
) {
  const requests: RemoteRepositoryIdentityRequest[] = [];
  const activeByServer = new Map<string, number>();
  let maximumPerServer = 0;
  const enter = (serverId: string): void => {
    const active = (activeByServer.get(serverId) ?? 0) + 1;
    activeByServer.set(serverId, active);
    maximumPerServer = Math.max(maximumPerServer, active);
  };
  const leave = (serverId: string): void => {
    activeByServer.set(serverId, (activeByServer.get(serverId) ?? 1) - 1);
  };
  const tracked = async (serverId: string, read: Reply): Promise<string | null> => {
    enter(serverId);
    try {
      return await read();
    } finally {
      leave(serverId);
    }
  };
  const gateway: RemoteRepositoryIdentityGateway = {
    discover(request) {
      requests.push(request);
      const call = requests.length;
      return tracked(request.serverId, () => reply(request, call));
    },
  };
  return {
    gateway,
    requests,
    maximumPerServer: () => maximumPerServer,
    active: (serverId: string) => activeByServer.get(serverId) ?? 0,
  };
}
