import { useEffect, useRef, useState } from "react";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import {
  startRetryingRepositoryIdentityRead,
  type RepositoryIdentityTimers,
} from "./repositoryIdentityRetry";

export const MAX_REMOTE_SHIP_IDENTITIES = 64;
export const REMOTE_SHIP_IDENTITY_WAIT_MS = 3_000;
export const REMOTE_SHIP_IDENTITY_UNREAD_MESSAGE =
  "Could not read this server project's repository. Commit and push still work, but the compare link is unavailable.";

export type RemoteShipIdentity =
  Readonly<{ kind: "read"; repositoryKey: string | null }> | Readonly<{ kind: "unread" }>;

export type RemoteShipIdentities = ReadonlyMap<string, RemoteShipIdentity>;

export interface RemoteShipIdentitiesOptions {
  readonly identity: RemoteRepositoryIdentityGateway | null;
  readonly timers: RepositoryIdentityTimers;
  readonly wantedKey: string | null;
  readonly report: (message: string) => void;
}

interface IdentityState {
  readonly gateway: RemoteRepositoryIdentityGateway | null;
  readonly values: RemoteShipIdentities;
}

interface Reported {
  readonly gateway: RemoteRepositoryIdentityGateway | null;
  readonly keys: Set<string>;
}

const UNREAD: RemoteShipIdentity = Object.freeze({ kind: "unread" });
const NO_REPOSITORY: RemoteShipIdentity = Object.freeze({ kind: "read", repositoryKey: null });
const NO_IDENTITIES: RemoteShipIdentities = new Map();

function supersedes(existing: RemoteShipIdentity | undefined, next: RemoteShipIdentity): boolean {
  if (existing === undefined) return true;
  if (next.kind === "unread") return false;
  return existing.kind !== "read" || existing.repositoryKey !== next.repositoryKey;
}

function evictOldest<K>(keys: {
  readonly size: number;
  keys(): Iterable<K>;
  delete(key: K): boolean;
}) {
  for (const oldest of keys.keys()) {
    if (keys.size <= MAX_REMOTE_SHIP_IDENTITIES) return;
    keys.delete(oldest);
  }
}

function recorded(
  current: IdentityState,
  gateway: RemoteRepositoryIdentityGateway | null,
  key: string,
  next: RemoteShipIdentity,
): IdentityState {
  const known = current.gateway === gateway ? current.values : NO_IDENTITIES;
  if (!supersedes(known.get(key), next)) return current;
  const values = new Map(known);
  values.set(key, next);
  evictOldest(values);
  return { gateway, values };
}

function reportedKeys(
  reported: { current: Reported },
  gateway: RemoteRepositoryIdentityGateway | null,
): Set<string> {
  if (reported.current.gateway !== gateway) reported.current = { gateway, keys: new Set() };
  return reported.current.keys;
}

export function useRemoteShipIdentities(
  options: RemoteShipIdentitiesOptions,
): RemoteShipIdentities | null {
  const { identity, report, timers, wantedKey } = options;
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);
  const reported = useRef<Reported>({ gateway: identity, keys: new Set() });
  const [state, setState] = useState<IdentityState>({ gateway: identity, values: NO_IDENTITIES });
  const identities = state.gateway === identity ? state.values : null;
  const wantedRead = wantedKey !== null && identities?.get(wantedKey)?.kind === "read";
  useEffect(() => {
    if (wantedKey === null || wantedRead) return;
    const [serverId, runnerId, projectId] = JSON.parse(wantedKey) as [string, string, string];
    const record = (next: RemoteShipIdentity): void => {
      setState((current) => recorded(current, identity, wantedKey, next));
    };
    if (identity === null) {
      record(NO_REPOSITORY);
      return;
    }
    const cancelWait = timers.schedule(REMOTE_SHIP_IDENTITY_WAIT_MS, () => record(UNREAD));
    const stopReading = startRetryingRepositoryIdentityRead({
      read: () => identity.discover({ serverId, runnerId, projectId }),
      timers,
      settle: (repositoryKey) => {
        cancelWait();
        reportedKeys(reported, identity).delete(wantedKey);
        record({ kind: "read", repositoryKey });
      },
      failed: () => {
        cancelWait();
        record(UNREAD);
      },
      exhausted: () => {
        const keys = reportedKeys(reported, identity);
        if (keys.has(wantedKey)) return;
        keys.add(wantedKey);
        evictOldest(keys);
        reportRef.current(REMOTE_SHIP_IDENTITY_UNREAD_MESSAGE);
      },
    });
    return () => {
      cancelWait();
      stopReading();
    };
  }, [identity, timers, wantedKey, wantedRead]);
  return identities;
}
