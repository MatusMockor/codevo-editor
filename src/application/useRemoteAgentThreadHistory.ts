import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerTask,
  RemoteRunnerEvent,
} from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import type {
  AgentThreadHistoryPageView,
  AgentThreadHistorySurface,
} from "./useAgentThreadHistory";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { RemoteAgentProjection, type RemoteAgentProjectionInput } from "./remoteAgentProjection";
import { retainRemoteReplayWindow } from "./remoteAgentReplayWindow";

interface Dependencies {
  readonly gateway: RemoteRunnerGateway | null;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly views: readonly AgentThreadView[];
  readonly selectedThreadId: string | null;
  readonly owner: object;
}
interface DisplayPage {
  readonly owner: object;
  readonly view: AgentThreadHistoryPageView;
  readonly first: RemoteRunnerTask | null;
  readonly anchors: readonly RemoteRunnerTask[];
}

/** A bounded display-only ancestor page; it never changes continuation authority. */
export function useRemoteAgentThreadHistory(dependencies: Dependencies): AgentThreadHistorySurface {
  const deps = useRef(dependencies);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const current = useRef<DisplayPage | null>(null);
  const [page, setPage] = useState<DisplayPage | null>(null);
  const latest = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setPage(null);
  }, []);
  useLayoutEffect(() => {
    if (
      deps.current.owner !== dependencies.owner ||
      deps.current.gateway !== dependencies.gateway ||
      deps.current.selectedThreadId !== dependencies.selectedThreadId ||
      (current.current && !resolve(dependencies, current.current.view.threadId))
    )
      latest();
    deps.current = dependencies;
  }, [dependencies, latest]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);
  const navigate = useCallback(
    async (threadId: string, direction: "older" | "newer") => {
      const captured = deps.current;
      const resolved = resolve(captured, threadId);
      if (!mounted.current || !resolved || !captured.gateway) return;
      const previous = current.current;
      if (previous?.view.loading || (direction === "older" && previous?.view.hasEarlier === false))
        return;
      if (direction === "newer" && (!previous || previous.anchors.length < 2)) {
        latest();
        return;
      }
      const first =
        direction === "newer"
          ? previous!.anchors[previous!.anchors.length - 2]
          : (previous?.first ??
            resolved.snapshot.tasks.find(
              (task) => task.id === resolved.view.thread.turns[0]?.turnId,
            ));
      if (!first?.parentTaskId) return;
      const anchors =
        direction === "older"
          ? [...(previous?.anchors ?? []), { ...first, parts: [] }].slice(-64)
          : previous!.anchors.slice(0, -1);
      const ticket = ++epoch.current;
      const valid = () =>
        mounted.current &&
        epoch.current === ticket &&
        deps.current.owner === captured.owner &&
        deps.current.gateway === captured.gateway &&
        deps.current.selectedThreadId === threadId &&
        resolve(deps.current, threadId)?.runnerId === resolved.runnerId;
      const publish = (next: DisplayPage) => {
        current.current = next;
        setPage(next);
      };
      const loading: DisplayPage = {
        owner: captured.owner,
        first: previous?.first ?? null,
        anchors: previous?.anchors ?? [],
        view: {
          threadId,
          turns: previous?.view.turns ?? [],
          hasEarlier: true,
          loading: true,
          error: null,
        },
      };
      publish(loading);
      try {
        const tasks: RemoteRunnerTask[] = [];
        let child = first;
        for (let index = 0; index < 32 && child.parentTaskId; index++) {
          const parent = await captured.gateway.getTask({
            serverId: resolved.snapshot.serverId,
            taskId: child.parentTaskId,
          });
          if (!valid()) return;
          validateParent(parent, child, resolved.runnerId);
          tasks.push(parent);
          child = parent;
        }
        const input: RemoteAgentProjectionInput = {
          serverId: resolved.snapshot.serverId,
          runnerId: resolved.runnerId,
          projects: resolved.snapshot.projects,
          tasks,
          replays: new Map(),
          resumes: new Map(),
          replayComplete: new Set(),
          replayTruncated: new Set(),
          replayGaps: new Map(),
          subagentLifecycles: new Map(),
        };
        // Retain at most three megabytes of output across this whole historical page.
        const replays = new Map(input.replays);
        const complete = new Set<string>();
        const truncated = new Set<string>();
        const gaps = new Map(input.replayGaps);
        const lifecycles = new Map(input.subagentLifecycles);
        for (const task of tasks) {
          let events: readonly RemoteRunnerEvent[] = [];
          let cursor = 0;
          let exhausted = false;
          let gap = gaps.get(task.id);
          for (let number = 0; number < 24; number++) {
            const result = await captured.gateway.listEvents({
              serverId: resolved.snapshot.serverId,
              taskId: task.id,
              after: cursor,
            });
            if (!valid()) return;
            if (result.items.length > 50) throw new Error("Oversized remote history page.");
            let next = cursor;
            for (const event of result.items) {
              if (event.taskId !== task.id || event.sequence <= next)
                throw new Error("Invalid remote history event ordering.");
              next = event.sequence;
            }
            if (result.nextCursor !== null && (result.nextCursor !== next || next === cursor))
              throw new Error("Invalid remote history cursor.");
            if (
              result.outputTruncatedBeforeSequence !== undefined &&
              result.outputTruncatedBeforeSequence > (gap?.throughSequence ?? 0)
            ) {
              gap = {
                throughSequence: result.outputTruncatedBeforeSequence,
                startsAtLineBoundary: result.outputStartsAtLineBoundary === true,
              };
              truncated.add(task.id);
            }
            const retained = retainRemoteReplayWindow(
              [...events, ...result.items],
              Math.floor(3_000_000 / tasks.length),
              gap,
            );
            events = retained.events;
            gap = retained.gap;
            if (retained.truncated) truncated.add(task.id);
            if (result.subagentLifecycle) lifecycles.set(task.id, result.subagentLifecycle);
            cursor = next;
            if (result.nextCursor === null) {
              exhausted = true;
              break;
            }
          }
          if (exhausted) complete.add(task.id);
          else truncated.add(task.id);
          if (gap) gaps.set(task.id, gap);
          replays.set(task.id, events);
        }
        if (!valid()) return;
        const turns =
          new RemoteAgentProjection().project({
            ...input,
            replays,
            replayComplete: complete,
            replayTruncated: truncated,
            replayGaps: gaps,
            subagentLifecycles: lifecycles,
          })[0]?.thread.turns ?? [];
        publish({
          owner: captured.owner,
          first: child,
          anchors,
          view: {
            threadId,
            turns,
            hasEarlier: child.parentTaskId !== undefined,
            loading: false,
            error: null,
          },
        });
      } catch {
        if (valid())
          publish({
            ...loading,
            view: {
              ...loading.view,
              loading: false,
              error: "Could not load earlier server turns. Try again.",
            },
          });
      }
    },
    [latest],
  );
  const older = useCallback((threadId: string) => navigate(threadId, "older"), [navigate]);
  const newer = useCallback((threadId: string) => navigate(threadId, "newer"), [navigate]);
  return {
    page:
      page?.owner === dependencies.owner && resolve(dependencies, page.view.threadId)
        ? page.view
        : null,
    older,
    newer,
    latest,
  };
}
function resolve(deps: Dependencies, threadId: string) {
  if (deps.selectedThreadId !== threadId) return null;
  const view = deps.views.find((item) => item.thread.threadId === threadId);
  if (view?.execution?.kind !== "remote") return null;
  const { serverId, runnerId } = view.execution;
  const snapshot = deps.snapshots.find(
    (item) =>
      item.serverId === serverId && item.descriptor?.runnerId === runnerId && item.connected,
  );
  return snapshot ? { snapshot, view, runnerId } : null;
}
function validateParent(parent: RemoteRunnerTask, child: RemoteRunnerTask, runnerId: string) {
  if (
    parent.id !== child.parentTaskId ||
    parent.runnerId !== runnerId ||
    (parent.conversationId ?? parent.id) !== (child.conversationId ?? child.id) ||
    parent.provider !== child.provider ||
    parent.projectId !== child.projectId ||
    (parent.isolation ?? "worktree") !== (child.isolation ?? "worktree") ||
    parent.sequence >= child.sequence ||
    parent.id === parent.parentTaskId
  )
    throw new Error("Invalid remote conversation ancestry.");
}
