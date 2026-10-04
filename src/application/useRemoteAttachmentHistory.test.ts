import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "../domain/agentAttachment";
import type { RemoteRunnerEvent, RemoteRunnerTask } from "../domain/remoteRunner";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  announcesRemoteAttachmentLimit,
  MAX_REMOTE_TURN_ATTACHMENTS,
  mergeRemoteAttachmentHistory,
  mergeRemoteAttachments,
  pendingRemoteAttachmentLoads,
  remoteAttachmentTaskKey,
} from "./useRemoteAttachmentHistory";

const uuid = (index: number): string =>
  `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`;
const image = (index: number): AgentAttachment => ({
  kind: "image",
  attachmentId: uuid(index).replace(/-/g, ""),
  name: `shot-${index}.png`,
  mime: "image/png",
  bytes: 4,
  width: 1,
  height: 1,
  remote: { serverId: "server", attachmentId: uuid(index) },
});
const file = (index: number): AgentAttachment => ({
  kind: "file",
  attachmentId: uuid(index).replace(/-/g, ""),
  name: `pasted-${index}.txt`,
  bytes: 4,
  remote: { serverId: "server", attachmentId: uuid(index) },
});
const task = (ids: readonly number[]): RemoteRunnerTask => ({
  id: "root",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: ids.map((index) => ({ type: "attachment", attachmentId: uuid(index) })),
  createdAt: "2026-09-13T00:00:00.000Z",
});
const threadId = remoteAgentThreadKey("server", "runner", "root");
const key = remoteAttachmentTaskKey("server", "root");
const snapshot = (value: RemoteRunnerTask, events: readonly RemoteRunnerEvent[] = []) => ({
  ...emptyRemoteInventory("server", true),
  tasks: [value],
  replays: new Map([[value.id, events]]),
});

describe("remote attachment history values", () => {
  it("merges loaded attachments by attachment id instead of appending duplicates", () => {
    const existing = [image(1), file(2)];
    expect(mergeRemoteAttachments(existing, [image(1), file(2)])).toBe(existing);
    expect(mergeRemoteAttachments(existing, [image(1), image(3), image(3), file(2)])).toEqual([
      image(1),
      file(2),
      image(3),
    ]);
  });
  it("loads only attachments the selected conversation does not hold yet", () => {
    const pending = pendingRemoteAttachmentLoads(
      [snapshot(task([1, 2, 3]))],
      threadId,
      new Map([[key, [image(1), file(2)]]]),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      key,
      serverId: "server",
      projectKey: remoteAgentProjectKey("server", "runner", "project"),
    });
    expect(pending[0]?.batches).toEqual([[{ type: "attachment", attachmentId: uuid(3) }]]);
    expect(
      pendingRemoteAttachmentLoads(
        [snapshot(task([1, 2]))],
        threadId,
        new Map([[key, [image(1), file(2)]]]),
      ),
    ).toEqual([]);
    expect(pendingRemoteAttachmentLoads([snapshot(task([1]))], null, new Map())).toEqual([]);
    expect(
      pendingRemoteAttachmentLoads(
        [snapshot(task([1]))],
        remoteAgentThreadKey("server", "runner", "other"),
        new Map(),
      ),
    ).toEqual([]);
  });
  it("requests an attachment once when the turn and a queued message both reference it", () => {
    const input: RemoteRunnerEvent = {
      sequence: 1,
      taskId: "root",
      type: "task.input",
      createdAt: "2026-09-13T00:00:00.000Z",
      parts: [
        { type: "attachment", attachmentId: uuid(1) },
        { type: "attachment", attachmentId: uuid(2) },
      ],
    };
    const [pending] = pendingRemoteAttachmentLoads(
      [snapshot(task([1]), [input])],
      threadId,
      new Map(),
    );
    expect(pending?.batches).toEqual([
      [
        { type: "attachment", attachmentId: uuid(1) },
        { type: "attachment", attachmentId: uuid(2) },
      ],
    ]);
  });
  it("bounds a large turn and flags that later attachments are not shown", () => {
    const ids = Array.from({ length: 80 }, (_, index) => index + 1);
    const [pending] = pendingRemoteAttachmentLoads([snapshot(task(ids))], threadId, new Map());
    expect(pending?.batches).toHaveLength(8);
    expect(pending?.batches.every((batch) => batch.length === 8)).toBe(true);
    expect(pending?.batches.flat()).toHaveLength(MAX_REMOTE_TURN_ATTACHMENTS);
    expect(pending?.truncated).toBe(true);

    const held = ids.slice(0, 60).map(image);
    const [rest] = pendingRemoteAttachmentLoads(
      [snapshot(task(ids))],
      threadId,
      new Map([[key, held]]),
    );
    expect(rest?.batches.flat().map((part) => part.attachmentId)).toEqual(
      [61, 62, 63, 64].map(uuid),
    );
    expect(rest?.truncated).toBe(true);

    const exact = ids.slice(0, MAX_REMOTE_TURN_ATTACHMENTS);
    const [whole] = pendingRemoteAttachmentLoads([snapshot(task(exact))], threadId, new Map());
    expect(whole?.truncated).toBe(false);
  });
  it("announces a registry limit once per owner generation", () => {
    const notices = new Map<string, number>();
    const owner = { projectRootKey: "p", ownerId: "p", workspaceId: "p", generation: 1 };
    expect(announcesRemoteAttachmentLimit(notices, owner)).toBe(true);
    expect(announcesRemoteAttachmentLimit(notices, owner)).toBe(false);
    expect(announcesRemoteAttachmentLimit(notices, { ...owner, workspaceId: "q" })).toBe(true);
    expect(announcesRemoteAttachmentLimit(notices, { ...owner, generation: 2 })).toBe(true);
    expect(announcesRemoteAttachmentLimit(notices, { ...owner, generation: 2 })).toBe(false);
    for (let index = 0; index < 100; index += 1)
      announcesRemoteAttachmentLimit(notices, { ...owner, workspaceId: `w-${index}` });
    expect(notices.size).toBe(64);
  });
  it("never lets a load from an older registry epoch overwrite newer history", () => {
    const owner = {};
    const newer = { owner, epoch: 2, values: new Map([[key, [image(1)]]]) };
    const stale = { attachments: [image(2)], discovered: [], epoch: 1 };
    expect(mergeRemoteAttachmentHistory(newer, owner, key, stale)).toBe(newer);
    const current = { attachments: [image(2)], discovered: [], epoch: 2 };
    expect(mergeRemoteAttachmentHistory(newer, owner, key, current).values.get(key)).toEqual([
      image(1),
      image(2),
    ]);
    const next = mergeRemoteAttachmentHistory(newer, owner, key, {
      attachments: [image(3)],
      discovered: [],
      epoch: 3,
    });
    expect(next).toMatchObject({ epoch: 3 });
    expect(next.values.get(key)).toEqual([image(3)]);
    const replaced = mergeRemoteAttachmentHistory(newer, {}, key, current);
    expect(replaced.values.get(key)).toEqual([image(2)]);
  });
});
