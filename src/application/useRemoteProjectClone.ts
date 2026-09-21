import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../domain/remoteRunner";

type Input = Readonly<{ url: string; name: string; branch?: string }>;
type Snapshot = {
  readonly gateway: RemoteRunnerGateway | null;
  readonly serverId: string;
  readonly workspaceOwner: string | null;
  request: { input: Input; key: string } | null;
  job: RemoteRunnerCloneJob | null;
  operation: Promise<RemoteRunnerCloneJob> | null;
  error: string | null;
  pending: boolean;
  requestedName: string | null;
};
/** Screen-owned private operation state; never retains component callbacks. */
export type RemoteProjectCloneSession = { current: Snapshot | null };
type Options = Readonly<{
  gateway: RemoteRunnerGateway | null;
  serverId: string;
  workspaceOwner: string | null;
  session?: RemoteProjectCloneSession;
}>;
export type RemoteProjectCloneStart =
  | Readonly<{ status: "started"; job: RemoteRunnerCloneJob }>
  | Readonly<{ status: "orphaned"; job: RemoteRunnerCloneJob }>
  | Readonly<{ status: "failed"; error: string }>
  | Readonly<{ status: "ignored" }>;
const IGNORED: RemoteProjectCloneStart = Object.freeze({ status: "ignored" });
const active = (job: RemoteRunnerCloneJob | null) =>
  job?.status === "queued" || job?.status === "running";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not clone the repository.";

function dispatch(call: () => Promise<RemoteRunnerCloneJob>): Promise<RemoteRunnerCloneJob> {
  try {
    return Promise.resolve(call());
  } catch (error) {
    return Promise.reject(error);
  }
}

/** One owned operation; uncertain retries and keyed-leaf remounts retain its identity. */
export function useRemoteProjectClone({ gateway, serverId, workspaceOwner, session }: Options) {
  const fallback = useRef<RemoteProjectCloneSession>({ current: null });
  const holder = session ?? fallback.current;
  if (
    holder.current === null ||
    holder.current.gateway !== gateway ||
    holder.current.serverId !== serverId ||
    holder.current.workspaceOwner !== workspaceOwner
  ) {
    holder.current = {
      gateway,
      serverId,
      workspaceOwner,
      request: null,
      job: null,
      operation: null,
      error: null,
      pending: false,
      requestedName: null,
    };
  }
  const snapshot = holder.current;
  const current = useRef({ holder, snapshot });
  if (
    current.current.holder !== holder &&
    current.current.holder.current === current.current.snapshot
  )
    current.current.holder.current = null;
  current.current = { holder, snapshot };
  const mounted = useRef(false);
  const sequence = useRef(0);
  const invalidatePending = useCallback(() => {
    sequence.current++;
  }, []);
  const [, render] = useState(0);
  const valid = useCallback(
    () => mounted.current && current.current.snapshot === snapshot && holder.current === snapshot,
    [holder, snapshot],
  );
  const publish = useCallback(() => {
    if (valid()) render((value) => value + 1);
  }, [valid]);
  const accept = useCallback(
    (next: RemoteRunnerCloneJob) => {
      // A delayed running acknowledgement may never replace an already settled job.
      if (snapshot.job?.id === next.id && !active(snapshot.job) && active(next)) return;
      snapshot.job = next;
      snapshot.error = null;
    },
    [snapshot],
  );
  const settle = useCallback(
    async (operation: Promise<RemoteRunnerCloneJob>) => {
      try {
        const next = await operation;
        if (holder.current === snapshot && snapshot.operation === operation) accept(next);
      } catch (error) {
        if (holder.current === snapshot && snapshot.operation === operation)
          snapshot.error = message(error);
      } finally {
        if (holder.current === snapshot && snapshot.operation === operation) {
          snapshot.operation = null;
          snapshot.pending = false;
        }
        publish();
      }
    },
    [accept, holder, snapshot, publish],
  );
  useEffect(() => {
    mounted.current = true;
    if (snapshot.operation !== null) void settle(snapshot.operation);
    return () => {
      mounted.current = false;
      invalidatePending();
    };
  }, [snapshot, settle, invalidatePending]);

  const job = snapshot.job;
  const pending = snapshot.pending;
  const cloneId = job?.id;
  const polling = active(job);
  useEffect(() => {
    if (gateway === null || !cloneId || !polling || pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = sequence.current;
      try {
        const next = await gateway.getProjectClone({ serverId, cloneId });
        if (disposed || !valid() || sequence.current !== revision) return;
        if (next.id !== cloneId)
          throw new Error("The server returned a different clone operation.");
        accept(next);
        publish();
        if (active(next)) timer = setTimeout(() => void poll(), 1500);
      } catch (error) {
        if (disposed || !valid() || sequence.current !== revision) return;
        snapshot.error = message(error);
        publish();
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [gateway, serverId, cloneId, polling, pending, valid, accept, publish, snapshot]);

  async function start(input: Input): Promise<RemoteProjectCloneStart> {
    if (!valid() || gateway === null || snapshot.pending || active(snapshot.job)) return IGNORED;
    invalidatePending();
    if (
      !snapshot.request ||
      JSON.stringify(snapshot.request.input) !== JSON.stringify(input) ||
      snapshot.job
    )
      snapshot.request = { input: { ...input }, key: crypto.randomUUID() };
    const submitted = snapshot.request;
    snapshot.job = null;
    snapshot.requestedName = input.name;
    snapshot.error = null;
    snapshot.pending = true;
    const operation = dispatch(() =>
      gateway.cloneProject({ serverId, ...submitted.input, idempotencyKey: submitted.key }),
    );
    snapshot.operation = operation;
    publish();
    await settle(operation);
    try {
      const next = await operation;
      if (!valid())
        return session && holder.current === snapshot ? IGNORED : { status: "orphaned", job: next };
      return { status: "started", job: snapshot.job ?? next };
    } catch (error) {
      return valid() ? { status: "failed", error: message(error) } : IGNORED;
    }
  }
  async function runExisting(cloneId: string, cancel: boolean) {
    if (!valid() || gateway === null || snapshot.pending) return;
    if (cancel ? !active(snapshot.job) : snapshot.job !== null) return;
    invalidatePending();
    snapshot.pending = true;
    snapshot.error = null;
    const operation = dispatch(async () => {
      const next = await (cancel
        ? gateway.cancelProjectClone({ serverId, cloneId })
        : gateway.getProjectClone({ serverId, cloneId }));
      if (next.id !== cloneId) throw new Error("The server returned a different clone operation.");
      return next;
    });
    snapshot.operation = operation;
    publish();
    await settle(operation);
  }
  function dismiss() {
    if (!valid() || snapshot.pending || active(snapshot.job)) return;
    invalidatePending();
    snapshot.request = null;
    snapshot.job = null;
    snapshot.error = null;
    snapshot.requestedName = null;
    publish();
  }
  return {
    job,
    error: snapshot.error,
    pending,
    requestedName: snapshot.requestedName,
    busy: pending || active(job),
    start,
    resume: (cloneId: string) => runExisting(cloneId, false),
    cancel: () => (snapshot.job ? runExisting(snapshot.job.id, true) : Promise.resolve()),
    dismiss,
  };
}
