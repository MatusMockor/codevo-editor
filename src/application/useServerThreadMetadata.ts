import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { normalizeAgentThreadTitle } from "../domain/agentThread";
import type { RemoteThreadMetadataPatch } from "../domain/remoteThreadMetadata";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import type { RemoteAgentMetadataRepository } from "./remoteAgentMetadata";
import { remoteAgentThreadKey } from "./remoteAgentProjection";

type Change = Omit<RemoteThreadMetadataPatch, "expectedRevision">;
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly owner: object;
  readonly valid: (owner: object) => boolean;
  readonly report: (message: string) => void;
  readonly refresh: () => Promise<void>;
  readonly repository?: RemoteAgentMetadataRepository;
}
const LIMIT = 4096;

/** Server revisions are authoritative. Legacy preferences migrate once using revision-zero CAS. */
export function useServerThreadMetadata({
  gateway,
  snapshots,
  owner,
  valid,
  report,
  refresh,
  repository,
}: Options) {
  const legacy = useMemo(() => {
    try {
      return new Map(
        (repository?.load() ?? []).slice(-LIMIT).map((record) => [record.threadId, record]),
      );
    } catch {
      return new Map();
    }
  }, [repository]);
  const targets = useMemo(() => {
    const result = new Map<string, { snapshot: RemoteAgentInventorySnapshot; taskId: string }>();
    for (const snapshot of snapshots) {
      if (!snapshot.descriptor) continue;
      for (const task of snapshot.tasks) {
        const taskId = task.conversationId ?? task.id;
        result.set(remoteAgentThreadKey(snapshot.serverId, snapshot.descriptor.runnerId, taskId), {
          snapshot,
          taskId,
        });
      }
    }
    return result;
  }, [snapshots]);
  const connectionKey = JSON.stringify(
    snapshots
      .map((snapshot) => [
        snapshot.serverId,
        snapshot.connected,
        snapshot.descriptor?.runnerId,
        snapshot.descriptor?.capabilities.threadManagement === true,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const committed = useRef({ key: connectionKey, epoch: {}, targets });
  useLayoutEffect(() => {
    committed.current = {
      key: connectionKey,
      epoch: committed.current.key === connectionKey ? committed.current.epoch : {},
      targets,
    };
  }, [connectionKey, targets]);
  const lease = useRef({ owner, busy: new Set<string>(), attempted: new Set<string>() });
  if (lease.current.owner !== owner)
    lease.current = { owner, busy: new Set(), attempted: new Set() };
  const captured = lease.current;
  const live = useCallback(
    () => lease.current === captured && valid(owner),
    [captured, owner, valid],
  );
  const eligible = useCallback(
    (threadId: string) => {
      const target = committed.current.targets.get(threadId);
      if (!live()) return null;
      if (!gateway || !target?.snapshot.connected) {
        report("Connect to the server to change this conversation.");
        return null;
      }
      if (
        target.snapshot.descriptor?.capabilities.threadManagement !== true ||
        !gateway.getThreadMetadata ||
        !gateway.updateThreadMetadata ||
        !gateway.reorderThread
      ) {
        report("Update the server to manage conversations across devices.");
        return null;
      }
      return target;
    },
    [live, gateway, report],
  );
  const legacyChange = useCallback(
    (threadId: string): Change => {
      const previous = legacy.get(threadId);
      if (!previous) return {};
      const { threadId: _id, ...change } = previous;
      const title = normalizeAgentThreadTitle(change.title ?? "");
      return { ...change, ...(change.title === undefined ? {} : { title }) };
    },
    [legacy],
  );
  const update = useCallback(
    async (threadId: string, change: Change) => {
      const endpoint = committed.current.epoch;
      const active = () =>
        live() && committed.current.epoch === endpoint && committed.current.targets.has(threadId);
      const target = eligible(threadId);
      if (!target || !gateway?.getThreadMetadata || !gateway.updateThreadMetadata) return;
      if (captured.busy.has(threadId) || captured.busy.size >= 4) {
        report("Conversation changes are still being saved. Try again shortly.");
        return;
      }
      if (change.title !== undefined && change.title !== null) {
        const title = normalizeAgentThreadTitle(change.title);
        if (title === null || /[\u0000-\u001f\u007f]/u.test(title)) return;
        change = { ...change, title };
      }
      captured.busy.add(threadId);
      try {
        const current = await gateway.getThreadMetadata({
          serverId: target.snapshot.serverId,
          taskId: target.taskId,
        });
        if (!active()) return;
        await gateway.updateThreadMetadata({
          serverId: target.snapshot.serverId,
          taskId: target.taskId,
          patch: {
            ...(current.revision === 0 ? legacyChange(threadId) : {}),
            ...change,
            expectedRevision: current.revision,
          },
        });
        if (!active()) return;
        await refresh();
      } catch {
        if (active()) {
          report(
            "The conversation change could not be saved on the server. Refresh and try again.",
          );
          await refresh().catch(() => undefined);
        }
      } finally {
        captured.busy.delete(threadId);
      }
    },
    [eligible, gateway, captured, report, live, legacyChange, refresh],
  );
  const reorder = useCallback(
    async (threadId: string, targetThreadId: string, placement: "before" | "after") => {
      const endpoint = committed.current.epoch;
      const active = () =>
        live() && committed.current.epoch === endpoint && committed.current.targets.has(threadId);
      const source = eligible(threadId);
      const target = committed.current.targets.get(targetThreadId);
      if (
        !source ||
        !target ||
        !gateway?.reorderThread ||
        source.snapshot.serverId !== target.snapshot.serverId ||
        source.snapshot.descriptor?.runnerId !== target.snapshot.descriptor?.runnerId
      )
        return;
      if (
        captured.busy.has(threadId) ||
        captured.busy.has(targetThreadId) ||
        captured.busy.size >= 3
      )
        return;
      captured.busy.add(threadId);
      captured.busy.add(targetThreadId);
      try {
        await gateway.reorderThread({
          serverId: source.snapshot.serverId,
          taskId: source.taskId,
          targetTaskId: target.taskId,
          placement,
        });
        if (!active()) return;
        await refresh();
      } catch {
        if (active()) report("The conversation order could not be saved on the server.");
      } finally {
        captured.busy.delete(threadId);
        captured.busy.delete(targetThreadId);
      }
    },
    [eligible, gateway, captured, live, refresh, report],
  );
  useEffect(() => {
    let disposed = false;
    const endpoint = committed.current.epoch;
    const current = () => !disposed && live() && committed.current.epoch === endpoint;
    const persist = gateway?.updateThreadMetadata?.bind(gateway);
    if (!persist) return;
    const candidates = [...targets]
      .filter(
        ([id, { snapshot, taskId }]) =>
          legacy.has(id) &&
          snapshot.connected &&
          snapshot.descriptor?.capabilities.threadManagement === true &&
          (snapshot.threadMetadata?.get(taskId)?.revision ?? 0) === 0 &&
          !captured.attempted.has(id),
      )
      .slice(0, LIMIT);
    async function migrate() {
      let changed = false;
      for (const [id, target] of candidates) {
        if (!current()) return;
        if (captured.busy.has(id) || captured.busy.size >= 4) continue;
        captured.attempted.add(id);
        captured.busy.add(id);
        try {
          await persist!({
            serverId: target.snapshot.serverId,
            taskId: target.taskId,
            patch: { ...legacyChange(id), expectedRevision: 0 },
          });
          if (!current()) return;
          changed = true;
        } catch {
          if (!current()) return;
          report(
            "Some earlier conversation preferences could not be moved to the server. Refresh to see the current server state.",
          );
          changed = true;
        } finally {
          captured.busy.delete(id);
        }
      }
      if (changed && current()) await refresh();
    }
    void migrate().catch(() => {
      if (current()) report("Conversation preferences could not be refreshed from the server.");
    });
    return () => {
      disposed = true;
    };
  }, [gateway, targets, legacy, captured, live, legacyChange, report, refresh]);
  const project = useCallback(
    (view: AgentThreadView): AgentThreadView | null => {
      const target = targets.get(view.thread.threadId);
      const canonical = target?.snapshot.threadMetadata?.get(target.taskId);
      const metadata =
        canonical && canonical.revision > 0
          ? canonical
          : (legacy.get(view.thread.threadId) ?? canonical);
      if (metadata?.removed) return null;
      if (!metadata) return view;
      const thread = {
        ...view.thread,
        snoozedUntil: metadata.snoozedUntil ?? null,
        settledAt: metadata.settledAt ?? null,
        sortOrder: metadata.sortOrder ?? null,
        title: normalizeAgentThreadTitle(metadata.title ?? "") ?? view.thread.title,
        pinned: metadata.pinned ?? view.thread.pinned,
        archived: metadata.archived ?? view.thread.archived,
        viewedAtEpochMs:
          metadata.viewedAtEpochMs === undefined
            ? view.thread.viewedAtEpochMs
            : metadata.viewedAtEpochMs,
      };
      return {
        ...view,
        thread,
        lifecycle: thread.archived ? "archived" : view.lifecycle,
        attention: thread.archived ? "archived" : view.attention,
        unread:
          !thread.archived &&
          (thread.viewedAtEpochMs === null || thread.updatedAtEpochMs > thread.viewedAtEpochMs),
      };
    },
    [targets, legacy],
  );
  return { project, update, reorder, persistenceError: null };
}
