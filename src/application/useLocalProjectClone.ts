import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalProjectCloneGateway } from "./ports/localProjectCloneGateway";
import {
  parseLocalProjectCloneRequest,
  type LocalProjectCloneRequest,
  type LocalProjectCloneSnapshot,
} from "../domain/localProjectClone";

export type LocalProjectCloneInput = Omit<LocalProjectCloneRequest, "idempotencyKey">;
type LocalCloneSessionSnapshot = Readonly<{
  gateway: LocalProjectCloneGateway;
  token: object;
  request: LocalProjectCloneRequest;
  job: LocalProjectCloneSnapshot | null;
  name: string;
  error: string | null;
  pending: boolean;
}>;
/** Private Screen-owned state; contains no callbacks and never crosses IPC. */
export interface LocalProjectCloneSession {
  current: LocalCloneSessionSnapshot | null;
}

type Options = Readonly<{
  session?: LocalProjectCloneSession;
  gateway: LocalProjectCloneGateway | null;
  selectionIdentity: unknown;
  onStarted(id: string, name: string, options: Readonly<{ select: boolean }>): void;
  onReady(id: string, path: string): void;
}>;
const message = (error: unknown) =>
  (error instanceof Error ? error.message : "Could not clone the repository.").slice(0, 500);

/** A clone outlives navigation, but its right to select the destination does not. */
export function useLocalProjectClone(options: Options) {
  const { gateway, selectionIdentity, session } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const owner = useRef({ gateway, session });
  if (owner.current.gateway !== gateway || owner.current.session !== session)
    owner.current = { gateway, session };
  const lease = owner.current;
  const selection = useRef({ identity: selectionIdentity });
  if (selection.current.identity !== selectionIdentity)
    selection.current = { identity: selectionIdentity };
  const mounted = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const lock = useRef(false);
  const request = useRef<LocalProjectCloneRequest | null>(null);
  const notified = useRef<string | null>(null);
  const [ownedJob, setOwnedJob] = useState<{
    lease: typeof lease;
    value: LocalProjectCloneSnapshot;
  } | null>(null);
  const job = ownedJob?.lease === lease ? ownedJob.value : null;
  const setJob = (value: LocalProjectCloneSnapshot | null) =>
    setOwnedJob(value ? { lease, value } : null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollRevision, setPollRevision] = useState(0);
  const action = useRef({ job, pending });
  if (action.current.job !== job || action.current.pending !== pending)
    action.current = { job, pending };
  const actionLease = action.current;
  const valid = () => mounted.current && owner.current === lease;
  const actionable = () => valid() && action.current === actionLease;

  function persist(
    next: LocalProjectCloneSnapshot | null,
    nextError: string | null,
    pending: boolean,
  ) {
    const stored = session?.current;
    if (!stored || stored.gateway !== gateway || stored.request !== request.current) return;
    session!.current = { ...stored, job: next, error: nextError, pending };
  }

  useEffect(() => {
    mounted.current = true;
    lock.current = false;
    notified.current = null;
    const saved = session?.current;
    const restored = saved?.gateway === gateway ? saved : null;
    if (session && restored === null) session.current = null;
    request.current = restored?.request ?? null;
    setOwnedJob(restored?.job ? { lease, value: restored.job } : null);
    setName(restored?.name ?? "");
    setError(restored?.error ?? null);
    setPending(restored?.job ? false : (restored?.pending ?? false));
    if (restored?.job)
      callbacks.current.onStarted(restored.job.cloneId, restored.name, { select: false });
    let disposed = false;
    if (restored?.pending && restored.job === null && gateway !== null) {
      lock.current = true;
      const restoreRequest = restored.request;
      void gateway
        .start(restoreRequest)
        .then((next) => {
          if (next.cloneId !== restoreRequest.idempotencyKey)
            throw new Error("The clone response belongs to another operation.");
          const retained = session?.current?.token === restored.token ? session.current : null;
          const authoritative = retained?.job ?? next;
          if (retained?.job === null)
            session!.current = { ...retained, job: next, error: next.error, pending: false };
          if (disposed || owner.current !== lease) return;
          setOwnedJob({ lease, value: authoritative });
          setError(authoritative.error);
          callbacks.current.onStarted(authoritative.cloneId, restored.name, { select: false });
        })
        .catch((failure: unknown) => {
          const retained = session?.current?.token === restored.token ? session.current : null;
          if (retained?.job === null)
            session!.current = { ...retained, error: message(failure), pending: false };
          if (!disposed && owner.current === lease) {
            if (retained?.job) {
              setOwnedJob({ lease, value: retained.job });
              setError(retained.job.error);
              callbacks.current.onStarted(retained.job.cloneId, retained.name, { select: false });
            } else setError(message(failure));
          }
        })
        .finally(() => {
          if (!disposed && owner.current === lease) {
            lock.current = false;
            setPending(false);
          }
        });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      invalidate();
    };
  }, [gateway, session, lease, invalidate]);

  const cloneId = job?.cloneId;
  const running = job?.status === "running";
  useEffect(() => {
    if (!gateway || !cloneId || !running || pending) return;
    let disposed = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const revision = generation.current;
    const current = () =>
      !disposed && mounted.current && owner.current === lease && generation.current === revision;
    const poll = async () => {
      try {
        const next = await gateway.get({ cloneId });
        if (!current()) return;
        if (next.cloneId !== cloneId)
          throw new Error("The clone response belongs to another operation.");
        failures = 0;
        setOwnedJob({ lease, value: next });
        const saved = session?.current;
        if (saved?.gateway === gateway && saved.job?.cloneId === cloneId)
          session!.current = { ...saved, job: next, error: next.error, pending: false };
        setError(next.error);
        if (next.status === "running") timer = setTimeout(() => void poll(), 1500);
      } catch (failure) {
        if (!current()) return;
        setError(message(failure));
        if (++failures < 3) timer = setTimeout(() => void poll(), 5000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [gateway, session, lease, cloneId, running, pending, pollRevision]);

  useEffect(() => {
    if (job?.status !== "completed" || notified.current === job.cloneId) return;
    notified.current = job.cloneId;
    callbacks.current.onReady(job.cloneId, job.path);
  }, [job]);

  async function start(input: LocalProjectCloneInput) {
    if (!actionable() || !gateway || lock.current || running) return;
    let nextRequest: LocalProjectCloneRequest;
    try {
      nextRequest = parseLocalProjectCloneRequest({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      setError("Check the repository URL, folder name, destination and branch.");
      return;
    }
    const previous = request.current;
    if (
      !job &&
      previous &&
      JSON.stringify({ ...previous, idempotencyKey: "" }) ===
        JSON.stringify({ ...nextRequest, idempotencyKey: "" })
    )
      nextRequest = previous;
    request.current = nextRequest;
    const operationToken = {};
    if (session)
      session.current = {
        gateway,
        token: operationToken,
        request: nextRequest,
        job: null,
        name: input.name,
        error: null,
        pending: true,
      };
    lock.current = true;
    const revision = ++generation.current;
    const selected = selection.current;
    setPending(true);
    setError(null);
    setName(input.name);
    setJob(null);
    try {
      const next = await gateway.start(nextRequest);
      if (next.cloneId !== nextRequest.idempotencyKey)
        throw new Error("The clone response belongs to another operation.");
      if (session?.current?.token === operationToken && session.current.job === null)
        session.current = { ...session.current, job: next, error: next.error, pending: false };
      if (!valid() || generation.current !== revision) return;
      setJob(next);
      setError(next.error);
      callbacks.current.onStarted(next.cloneId, input.name, {
        select: selection.current === selected,
      });
    } catch (failure) {
      if (session?.current?.token === operationToken && session.current.job === null)
        session.current = { ...session.current, error: message(failure), pending: false };
      if (valid() && generation.current === revision) setError(message(failure));
    } finally {
      if (valid() && generation.current === revision) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function cancel() {
    if (!actionable() || !gateway || !job || !running || lock.current) return;
    lock.current = true;
    const revision = ++generation.current;
    setPending(true);
    try {
      const next = await gateway.cancel({ cloneId: job.cloneId });
      if (!valid() || generation.current !== revision) return;
      if (next.cloneId !== job.cloneId)
        throw new Error("The clone response belongs to another operation.");
      setJob(next);
      persist(next, next.error, false);
      setError(next.error);
    } catch (failure) {
      if (valid() && generation.current === revision) setError(message(failure));
    } finally {
      if (valid() && generation.current === revision) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  function retry() {
    if (!actionable() || lock.current) return;
    if (running) {
      setError(null);
      setPollRevision((value) => value + 1);
      return;
    }
    if (request.current) {
      const { url, name: folderName, parentPath, branch } = request.current;
      void start({ url, name: folderName, parentPath, ...(branch ? { branch } : {}) });
    }
  }
  function dismiss() {
    if (!actionable() || lock.current || running) return;
    generation.current++;
    request.current = null;
    if (session) session.current = null;
    setJob(null);
    setName("");
    setError(null);
  }
  return { job, name, busy: pending || running, pending, error, start, cancel, retry, dismiss };
}
