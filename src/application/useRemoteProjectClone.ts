import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../domain/remoteRunner";

type Input = Readonly<{ url: string; name: string; branch?: string }>;
type Options = Readonly<{
  gateway: RemoteRunnerGateway;
  serverId: string;
  workspaceOwner: string | null;
}>;
const active = (job: RemoteRunnerCloneJob | null) =>
  job?.status === "queued" || job?.status === "running";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not clone the repository.";

/** One owned clone operation; retries after uncertain submission reuse its idempotency key. */
export function useRemoteProjectClone({ gateway, serverId, workspaceOwner }: Options) {
  const owner = useRef({ gateway, serverId, workspaceOwner });
  if (
    owner.current.gateway !== gateway ||
    owner.current.serverId !== serverId ||
    owner.current.workspaceOwner !== workspaceOwner
  )
    owner.current = { gateway, serverId, workspaceOwner };
  const captured = owner.current;
  const mounted = useRef(false);
  const sequence = useRef(0);
  const lock = useRef(false);
  const request = useRef<{ input: Input; key: string } | null>(null);
  const [job, setJob] = useState<RemoteRunnerCloneJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const valid = useCallback(() => mounted.current && owner.current === captured, [captured]);
  const cloneId = job?.id;
  const polling = active(job);
  useEffect(() => {
    mounted.current = true;
    lock.current = false;
    request.current = null;
    setJob(null);
    setError(null);
    setPending(false);
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, [captured]);

  useEffect(() => {
    if (!cloneId || !polling || pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = sequence.current;
      try {
        const next = await gateway.getProjectClone({ serverId, cloneId });
        if (disposed || !valid() || sequence.current !== revision) return;
        if (next.id !== cloneId)
          throw new Error("The server returned a different clone operation.");
        setJob(next);
        setError(null);
        if (active(next)) timer = setTimeout(() => void poll(), 1500);
      } catch (failure) {
        if (disposed || !valid() || sequence.current !== revision) return;
        setError(message(failure));
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [gateway, serverId, cloneId, polling, pending, valid]);

  async function start(input: Input) {
    if (!valid() || lock.current || active(job)) return;
    lock.current = true;
    sequence.current++;
    setPending(true);
    setError(null);
    if (!request.current || JSON.stringify(request.current.input) !== JSON.stringify(input) || job)
      request.current = { input, key: crypto.randomUUID() };
    const submitted = request.current;
    setJob(null);
    try {
      const next = await gateway.cloneProject({
        serverId,
        ...input,
        idempotencyKey: submitted.key,
      });
      if (!valid()) return;
      setJob(next);
    } catch (failure) {
      if (valid()) setError(message(failure));
    } finally {
      if (valid()) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function cancel() {
    if (!valid() || lock.current || !job || !active(job)) return;
    lock.current = true;
    sequence.current++;
    setPending(true);
    setError(null);
    try {
      const next = await gateway.cancelProjectClone({ serverId, cloneId: job.id });
      if (!valid()) return;
      if (next.id !== job.id) throw new Error("The server returned a different clone operation.");
      setJob(next);
    } catch (failure) {
      if (valid()) setError(message(failure));
    } finally {
      if (valid()) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  return { job, error, pending, busy: pending || active(job), start, cancel };
}
