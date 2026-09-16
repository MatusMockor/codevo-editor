import { retainRemoteReplayWindow } from "./remoteAgentReplayWindow";
import { useRemoteRunnerSubmission } from "./useRemoteRunnerSubmission";
import { useRemoteRunnerContinuation } from "./useRemoteRunnerContinuation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptsRemoteTaskUpdate,
  mergeRemoteTasks,
  isRemoteTaskTerminal as terminal,
} from "./remoteRunnerTaskState";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerDiff,
  RemoteRunnerEvent,
  RemoteRunnerGateway,
  RemoteRunnerProject,
  RemoteRunnerProvider,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";

export interface RemoteRunnerSubmission {
  readonly projectId: string;
  readonly provider: RemoteRunnerProvider;
  readonly prompt: string;
  readonly attachments: readonly {
    readonly name: string;
    readonly mediaType: "image/png" | "image/jpeg";
    readonly base64: string;
  }[];
}
export interface RemoteRunnerTasksSurface {
  readonly resume: RemoteRunnerTaskResume | null;
  readonly continuationUncertain: boolean;
  continueTask(input: RemoteRunnerSubmission): Promise<RemoteRunnerTask | null>;
  resetSelection(): void;
  readonly descriptor: RemoteRunnerDescriptor | null;
  readonly projects: readonly RemoteRunnerProject[];
  readonly tasks: readonly RemoteRunnerTask[];
  readonly hasMore: boolean;
  readonly selectedTask: RemoteRunnerTask | null;
  readonly events: readonly RemoteRunnerEvent[];
  readonly diff: RemoteRunnerDiff | null;
  readonly busy: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  submit(input: RemoteRunnerSubmission): Promise<RemoteRunnerTask | null>;
  selectTask(taskId: string): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  cancel(): Promise<void>;
  startDraft(projectId: string): Promise<RemoteRunnerTask | null>;
}
interface Options {
  readonly gateway: RemoteRunnerGateway;
  readonly serverId: string | null;
  readonly workspaceOwner: string | null;
}
class RemoteReplayError extends Error {}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The remote task operation failed.";

/** Remote tasks belong to a server. Switching a local workspace revokes pending UI authority. */
export function useRemoteRunnerTasks({
  gateway,
  serverId,
  workspaceOwner,
}: Options): RemoteRunnerTasksSurface {
  const owner = useRef({ gateway, serverId, workspaceOwner });
  if (
    owner.current.gateway !== gateway ||
    owner.current.serverId !== serverId ||
    owner.current.workspaceOwner !== workspaceOwner
  )
    owner.current = { gateway, serverId, workspaceOwner };
  const renderOwner = owner.current;
  const mounted = useRef(false);
  const active = useRef<RemoteRunnerTask | null>(null);
  const selection = useRef(0);
  const autoChoose = useRef(true);
  const mutation = useRef(false);
  const refreshSequence = useRef(0);
  const cursor = useRef<number | null>(null);
  const projectRef = useRef<readonly RemoteRunnerProject[]>([]);
  const [descriptor, setDescriptor] = useState<RemoteRunnerDescriptor | null>(null);
  const [projects, setProjects] = useState<readonly RemoteRunnerProject[]>([]);
  const [tasks, setTasks] = useState<readonly RemoteRunnerTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<RemoteRunnerTask | null>(null);
  const [events, setEvents] = useState<readonly RemoteRunnerEvent[]>([]);
  const [diff, setDiff] = useState<RemoteRunnerDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const isCurrent = useCallback(
    (captured: object) => mounted.current && owner.current === captured,
    [],
  );
  const publishTask = useCallback((task: RemoteRunnerTask) => {
    const previous = active.current;
    if (previous?.id === task.id && !acceptsRemoteTaskUpdate(previous, task)) return;
    setTasks((previous) => mergeRemoteTasks(previous, [task]));
    active.current = task;
    setSelectedTask(task);
  }, []);
  const choose = useCallback((task: RemoteRunnerTask) => {
    selection.current++;
    active.current = task;
    setSelectedTask(task);
    setEvents([]);
    setDiff(null);
    setPollRevision((value) => value + 1);
  }, []);

  const publishContinuation = useCallback(
    (task: RemoteRunnerTask) => {
      choose(task);
      publishTask(task);
    },
    [choose, publishTask],
  );
  const continuation = useRemoteRunnerContinuation({
    gateway,
    serverId,
    owner: renderOwner,
    supported: descriptor?.capabilities.taskContinuation === true,
    selectedTask,
    selection,
    mutation,
    valid: isCurrent,
    publish: publishContinuation,
    setBusy,
    setError,
  });
  const continuationRef = useRef(continuation);
  continuationRef.current = continuation;
  const resetSelection = useCallback(() => {
    if (!isCurrent(renderOwner) || mutation.current || continuationRef.current.locked()) return;
    autoChoose.current = false;
    selection.current++;
    active.current = null;
    setSelectedTask(null);
    setEvents([]);
    setDiff(null);
    setError(null);
  }, [isCurrent, renderOwner]);

  const refresh = useCallback(async () => {
    if (serverId === null || !isCurrent(renderOwner) || mutation.current) return;
    const captured = renderOwner;
    const sequence = ++refreshSequence.current;
    const valid = () => isCurrent(captured) && sequence === refreshSequence.current;
    setLoading(true);
    setError(null);
    try {
      const info = await gateway.getRunner({ serverId });
      if (!valid()) return;
      if (!info.capabilities.taskExecution || !info.capabilities.eventReplay)
        throw new Error("This runner does not support durable task execution.");
      const projectPage = await gateway.listProjects({ serverId });
      if (!valid()) return;
      const page = await gateway.listTasks({ serverId, after: 0 });
      if (!valid()) return;
      if (page.items.some((task) => task.runnerId !== info.runnerId))
        throw new Error("The runner returned tasks belonging to another server.");
      setDescriptor(info);
      projectRef.current = projectPage.items;
      setProjects(projectPage.items);
      setTasks((previous) => mergeRemoteTasks(previous, page.items));
      cursor.current = page.nextCursor;
      setHasMore(page.nextCursor !== null);
      if (autoChoose.current && active.current === null && page.items.length > 0)
        choose(page.items[page.items.length - 1]!);
      await continuationRef.current.reconcile();
      if (!valid()) return;
    } catch (failure) {
      if (valid()) setError(message(failure));
    } finally {
      if (valid()) setLoading(false);
    }
  }, [gateway, serverId, isCurrent, choose, renderOwner]);

  const invalidatePending = useCallback(() => {
    selection.current++;
    refreshSequence.current++;
  }, []);

  useEffect(() => {
    mounted.current = true;
    mutation.current = false;
    active.current = null;
    autoChoose.current = true;
    projectRef.current = [];
    selection.current++;
    setDescriptor(null);
    setProjects([]);
    setTasks([]);
    setSelectedTask(null);
    setEvents([]);
    setDiff(null);
    setBusy(false);
    setHasMore(false);
    setError(null);
    void refresh();
    return () => {
      mounted.current = false;
      invalidatePending();
    };
  }, [refresh, workspaceOwner, invalidatePending]);

  const selectedTaskId = selectedTask?.id;
  const selectedRunnerId = selectedTask?.runnerId;
  useEffect(() => {
    if (serverId === null || selectedTaskId === undefined || active.current?.id !== selectedTaskId)
      return;
    const captured = renderOwner;
    const taskId = selectedTaskId;
    const selected = selection.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let after = 0;
    let retained: readonly RemoteRunnerEvent[] = [];
    let caughtUp = false;
    let replayError: string | null = null;
    const valid = () => !disposed && isCurrent(captured) && selected === selection.current;
    const poll = async () => {
      try {
        const task = await gateway.getTask({ serverId, taskId });
        if (!valid()) return;
        if (task.id !== taskId || task.runnerId !== selectedRunnerId)
          throw new Error("The runner returned a different task.");
        publishTask(task);
        try {
          for (let pageNumber = 0; pageNumber < 24; pageNumber++) {
            const page = await gateway.listEvents({ serverId, taskId, after });
            if (!valid()) return;
            const incoming = page.items;
            let nextAfter = after;
            for (const event of incoming) {
              if (event.taskId !== taskId || event.sequence <= nextAfter)
                throw new RemoteReplayError(
                  "The runner returned invalid event ordering; displayed output is incomplete.",
                );
              nextAfter = event.sequence;
            }
            if (
              page.nextCursor !== null &&
              (page.nextCursor !== nextAfter || incoming.length === 0)
            )
              throw new RemoteReplayError(
                "The runner returned an invalid event page; displayed output is incomplete.",
              );
            after = nextAfter;
            const window = retainRemoteReplayWindow([...retained, ...incoming], 3_000_000);
            retained = window.events;
            if (window.truncated || page.outputTruncatedBeforeSequence !== undefined)
              replayError = "Showing recent server output; earlier output is incomplete.";
            caughtUp = page.nextCursor === null;
            if (caughtUp) break;
          }
        } catch (failure) {
          if (!(failure instanceof RemoteReplayError)) throw failure;
          replayError = failure.message;
        }
        if (!valid()) return;
        setEvents(retained);
        if (terminal(task) && task.projectId !== undefined) {
          const patch = await gateway.getDiff({ serverId, taskId });
          if (!valid()) return;
          setDiff(patch);
        }
        setError(replayError);
        if (!terminal(task) || !caughtUp) timer = setTimeout(() => void poll(), 2000);
      } catch (failure) {
        if (!valid()) return;
        setError(message(failure));
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // A status update must not restart event replay; only a selection/reconnect does.
  }, [
    gateway,
    serverId,
    renderOwner,
    selectedTaskId,
    selectedRunnerId,
    pollRevision,
    isCurrent,
    publishTask,
  ]);

  const loadMore = useCallback(async () => {
    if (!isCurrent(renderOwner) || serverId === null || cursor.current === null || loading) return;
    const captured = renderOwner;
    const after = cursor.current;
    const sequence = ++refreshSequence.current;
    const valid = () => isCurrent(captured) && sequence === refreshSequence.current;
    setLoading(true);
    try {
      const page = await gateway.listTasks({ serverId, after });
      if (!valid()) return;
      if (
        page.items.some((task) => task.runnerId !== descriptor?.runnerId || task.sequence <= after)
      )
        throw new Error("The runner returned invalid task history.");
      cursor.current = page.nextCursor;
      setHasMore(page.nextCursor !== null);
      setTasks((previous) => mergeRemoteTasks(previous, page.items));
    } catch (failure) {
      if (valid()) setError(message(failure));
    } finally {
      if (valid()) setLoading(false);
    }
  }, [gateway, serverId, loading, descriptor, isCurrent, renderOwner]);

  const submission = useRemoteRunnerSubmission({
    gateway,
    serverId,
    owner: renderOwner,
    descriptor,
    valid: isCurrent,
    mutation,
    refreshSequence,
    projects: projectRef,
    locked: () => continuationRef.current.locked(),
    setLoading,
    setBusy,
    setError,
    publish: publishTask,
    choose,
    poll: () => setPollRevision((value) => value + 1),
  });

  const submissionRef = useRef(submission);
  submissionRef.current = submission;

  const startDraft = useCallback(
    async (projectId: string): Promise<RemoteRunnerTask | null> => {
      const task = active.current;
      if (
        serverId === null ||
        !isCurrent(renderOwner) ||
        task?.status !== "draft" ||
        mutation.current ||
        continuationRef.current.locked() ||
        !projectRef.current.some((project) => project.id === projectId)
      )
        return null;
      const captured = renderOwner;
      const selected = selection.current;
      mutation.current = true;
      refreshSequence.current++;
      setLoading(false);
      setBusy(true);
      try {
        if (!submissionRef.current.canStartDraft(task.id, projectId))
          throw new Error(
            "This draft has no confirmed instruction snapshot. Send it as a new message.",
          );
        const started = await gateway.startTask({ serverId, taskId: task.id, projectId });
        if (!isCurrent(captured) || selection.current !== selected) return null;
        if (
          started.id !== task.id ||
          started.runnerId !== task.runnerId ||
          started.projectId !== projectId
        )
          throw new Error("The runner returned a different started task.");
        submissionRef.current.confirmStarted(started);
        publishTask(started);
        setError(null);
        setPollRevision((value) => value + 1);
        return started;
      } catch (failure) {
        if (isCurrent(captured)) setError(message(failure));
        return null;
      } finally {
        if (isCurrent(captured)) {
          mutation.current = false;
          setBusy(false);
        }
      }
    },
    [gateway, serverId, isCurrent, publishTask, renderOwner],
  );
  const cancel = useCallback(async () => {
    const task = active.current;
    if (
      !isCurrent(renderOwner) ||
      serverId === null ||
      task === null ||
      terminal(task) ||
      mutation.current
    )
      return;
    const captured = renderOwner;
    const selected = selection.current;
    mutation.current = true;
    setBusy(true);
    try {
      const stopped = await gateway.cancelTask({ serverId, taskId: task.id });
      if (!isCurrent(captured) || selection.current !== selected) return;
      if (stopped.id !== task.id || stopped.runnerId !== task.runnerId)
        throw new Error("The runner returned a different cancelled task.");
      publishTask(stopped);
      setError(null);
      setPollRevision((value) => value + 1);
    } catch (failure) {
      if (isCurrent(captured)) setError(message(failure));
    } finally {
      if (isCurrent(captured)) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }, [gateway, serverId, isCurrent, publishTask, renderOwner]);
  const selectTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (
        task !== undefined &&
        isCurrent(renderOwner) &&
        !mutation.current &&
        !continuationRef.current.locked()
      )
        choose(task);
    },
    [tasks, choose, isCurrent, renderOwner],
  );
  return {
    resume: continuation.resume,
    continuationUncertain: continuation.uncertain,
    continueTask: continuation.continueTask,
    resetSelection,
    descriptor,
    projects,
    tasks,
    hasMore,
    selectedTask,
    events,
    diff,
    busy,
    loading,
    error,
    submit: submission.submit,
    selectTask,
    refresh,
    loadMore,
    cancel,
    startDraft,
  };
}
