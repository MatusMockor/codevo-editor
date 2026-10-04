import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment } from "../domain/agentAttachment";
import type { RemoteRunnerPart, RemoteRunnerTask } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  MAX_REMOTE_TASK_ATTACHMENTS,
  remoteAttachmentDisplayId,
  remoteAttachmentLoadRetriesQuietly,
  RemoteAttachmentUnavailableError,
} from "./remoteAttachmentHistory";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";
import type { RemoteAttachmentHistoryLoad } from "./useRemoteAgentAttachments";

type AttachmentPart = Extract<RemoteRunnerPart, { readonly type: "attachment" }>;
export type RemoteAttachmentValues = ReadonlyMap<string, readonly AgentAttachment[]>;

export interface RemoteAttachmentHistoryOptions {
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly selectedThreadId: string | null;
  readonly owner: object;
  readonly epoch: number;
  readonly valid: (owner: object) => boolean;
  readonly resolveOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly loadTaskAttachments: (
    task: RemoteRunnerTask,
    serverId: string,
    owner: AgentAttachmentOwner,
    epoch: number,
  ) => Promise<RemoteAttachmentHistoryLoad>;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface PendingRemoteAttachmentLoad {
  readonly key: string;
  readonly serverId: string;
  readonly projectKey: string;
  readonly task: RemoteRunnerTask;
  readonly batches: readonly (readonly AttachmentPart[])[];
  readonly truncated: boolean;
}

interface MissingAttachments {
  readonly batches: readonly (readonly AttachmentPart[])[];
  readonly truncated: boolean;
}

export interface RemoteAttachmentHistoryState {
  readonly owner: object;
  readonly epoch: number;
  readonly values: RemoteAttachmentValues;
}

const SOURCE = "remote-attachments";
const MAX_TASKS = 512;
const MAX_BATCHES = 8;
const MAX_LIMIT_NOTICES = 64;
export const MAX_REMOTE_TURN_ATTACHMENTS = MAX_REMOTE_TASK_ATTACHMENTS * MAX_BATCHES;
export const REMOTE_ATTACHMENTS_TRUNCATED_NOTICE = `Only the first ${MAX_REMOTE_TURN_ATTACHMENTS} attachments of this turn are shown.`;
const NO_VALUES: RemoteAttachmentValues = new Map();
const NO_ATTACHMENTS: readonly AgentAttachment[] = [];

export const remoteAttachmentTaskKey = (serverId: string, taskId: string): string =>
  `${serverId}\u0000${taskId}`;

export function mergeRemoteAttachments(
  existing: readonly AgentAttachment[],
  loaded: readonly AgentAttachment[],
): readonly AgentAttachment[] {
  const known = new Set(existing.flatMap(attachmentIds));
  const added: AgentAttachment[] = [];
  for (const attachment of loaded) {
    const [id] = attachmentIds(attachment);
    if (id === undefined || known.has(id)) continue;
    known.add(id);
    added.push(attachment);
  }
  return added.length === 0 ? existing : [...existing, ...added];
}

export function pendingRemoteAttachmentLoads(
  snapshots: readonly RemoteAgentInventorySnapshot[],
  selectedThreadId: string | null,
  values: RemoteAttachmentValues,
): readonly PendingRemoteAttachmentLoad[] {
  if (selectedThreadId === null) return [];
  const pending: PendingRemoteAttachmentLoad[] = [];
  for (const snapshot of snapshots)
    for (const task of snapshot.tasks) {
      if (task.projectId === undefined) continue;
      const threadId = remoteAgentThreadKey(
        snapshot.serverId,
        task.runnerId,
        task.conversationId ?? task.id,
      );
      if (threadId !== selectedThreadId) continue;
      const key = remoteAttachmentTaskKey(snapshot.serverId, task.id);
      const missing = missingAttachments(snapshot, task, values.get(key) ?? NO_ATTACHMENTS);
      if (missing.batches.length === 0) continue;
      pending.push({
        key,
        serverId: snapshot.serverId,
        projectKey: remoteAgentProjectKey(snapshot.serverId, task.runnerId, task.projectId),
        task,
        batches: missing.batches,
        truncated: missing.truncated,
      });
    }
  return pending;
}

export function announcesRemoteAttachmentLimit(
  notices: Map<string, number>,
  owner: AgentAttachmentOwner,
): boolean {
  if (notices.get(owner.workspaceId) === owner.generation) return false;
  notices.delete(owner.workspaceId);
  notices.set(owner.workspaceId, owner.generation);
  for (const oldest of notices.keys()) {
    if (notices.size <= MAX_LIMIT_NOTICES) break;
    notices.delete(oldest);
  }
  return true;
}

export function useRemoteAttachmentHistory(
  options: RemoteAttachmentHistoryOptions,
): RemoteAttachmentValues {
  const {
    snapshots,
    selectedThreadId,
    owner,
    epoch,
    valid,
    resolveOwner,
    loadTaskAttachments,
    reportError,
  } = options;
  const [state, setState] = useState<RemoteAttachmentHistoryState>({
    owner,
    epoch,
    values: NO_VALUES,
  });
  const values = useMemo(
    () => (state.owner === owner && state.epoch === epoch ? state.values : NO_VALUES),
    [state, owner, epoch],
  );
  const limitNotices = useRef(new Map<string, number>());
  const truncationNotices = useRef<{ owner: object; keys: Set<string> }>({
    owner,
    keys: new Set(),
  });
  useEffect(() => {
    let disposed = false;
    const live = (): boolean => !disposed && valid(owner);
    const announceTruncation = (key: string): void => {
      if (truncationNotices.current.owner !== owner)
        truncationNotices.current = { owner, keys: new Set() };
      if (truncationNotices.current.keys.has(key)) return;
      truncationNotices.current.keys.add(key);
      reportError(SOURCE, new Error(REMOTE_ATTACHMENTS_TRUNCATED_NOTICE));
    };
    const announceFailures = (
      loaded: RemoteAttachmentHistoryLoad,
      attachmentOwner: AgentAttachmentOwner,
    ): void => {
      for (const reason of loaded.discovered) {
        if (
          reason === "limit" &&
          !announcesRemoteAttachmentLimit(limitNotices.current, attachmentOwner)
        )
          continue;
        reportError(SOURCE, new RemoteAttachmentUnavailableError(reason));
      }
    };
    const loadBatch = async (
      pending: PendingRemoteAttachmentLoad,
      parts: readonly AttachmentPart[],
      attachmentOwner: AgentAttachmentOwner,
    ): Promise<boolean> => {
      try {
        const loaded = await loadTaskAttachments(
          { ...pending.task, parts },
          pending.serverId,
          attachmentOwner,
          epoch,
        );
        if (!live()) return false;
        announceFailures(loaded, attachmentOwner);
        setState((previous) => mergeRemoteAttachmentHistory(previous, owner, pending.key, loaded));
        return true;
      } catch (error) {
        if (live() && !remoteAttachmentLoadRetriesQuietly(error)) reportError(SOURCE, error);
        return false;
      }
    };
    const load = async (): Promise<void> => {
      for (const pending of pendingRemoteAttachmentLoads(snapshots, selectedThreadId, values)) {
        const attachmentOwner = resolveOwner(pending.projectKey);
        if (attachmentOwner === null) continue;
        if (pending.truncated) announceTruncation(pending.key);
        for (const parts of pending.batches) {
          if (!live()) return;
          if (!(await loadBatch(pending, parts, attachmentOwner))) break;
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [
    snapshots,
    selectedThreadId,
    owner,
    epoch,
    resolveOwner,
    valid,
    reportError,
    loadTaskAttachments,
    values,
  ]);
  return values;
}

function attachmentIds(attachment: AgentAttachment): readonly string[] {
  if (attachment.kind === "reference") return [];
  return [attachment.attachmentId];
}

function missingAttachments(
  snapshot: RemoteAgentInventorySnapshot,
  task: RemoteRunnerTask,
  existing: readonly AgentAttachment[],
): MissingAttachments {
  const distinct = new Map<string, AttachmentPart>();
  for (const part of attachmentParts(snapshot, task)) {
    const id = remoteAttachmentDisplayId(part.attachmentId);
    if (!distinct.has(id)) distinct.set(id, part);
    if (distinct.size > MAX_REMOTE_TURN_ATTACHMENTS) break;
  }
  const held = new Set(existing.flatMap(attachmentIds));
  const missing = [...distinct]
    .slice(0, MAX_REMOTE_TURN_ATTACHMENTS)
    .flatMap(([id, part]) => (held.has(id) ? [] : [part]));
  const batches: AttachmentPart[][] = [];
  for (let start = 0; start < missing.length; start += MAX_REMOTE_TASK_ATTACHMENTS)
    batches.push(missing.slice(start, start + MAX_REMOTE_TASK_ATTACHMENTS));
  return { batches, truncated: distinct.size > MAX_REMOTE_TURN_ATTACHMENTS };
}

function attachmentParts(
  snapshot: RemoteAgentInventorySnapshot,
  task: RemoteRunnerTask,
): readonly AttachmentPart[] {
  const inputParts = (snapshot.replays.get(task.id) ?? [])
    .filter((event) => event.type === "task.input")
    .flatMap((event) => event.parts ?? []);
  return [...task.parts, ...inputParts].filter(
    (part): part is AttachmentPart => part.type === "attachment",
  );
}

export function mergeRemoteAttachmentHistory(
  previous: RemoteAttachmentHistoryState,
  owner: object,
  key: string,
  loaded: RemoteAttachmentHistoryLoad,
): RemoteAttachmentHistoryState {
  if (previous.epoch > loaded.epoch) return previous;
  const base =
    previous.owner === owner && previous.epoch === loaded.epoch ? previous.values : NO_VALUES;
  const existing = base.get(key) ?? NO_ATTACHMENTS;
  const merged = mergeRemoteAttachments(existing, loaded.attachments);
  if (merged === existing) return previous;
  const values = new Map(base);
  values.set(key, merged);
  for (const oldest of values.keys()) {
    if (values.size <= MAX_TASKS) break;
    values.delete(oldest);
  }
  return { owner, epoch: loaded.epoch, values };
}
