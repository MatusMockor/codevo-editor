import { expect, it } from "vitest";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  ServerThreadMetadataViews,
  type ServerThreadPresentationMetadata,
} from "./serverThreadMetadataViews";

const view = projectRemoteAgentThreads({
  serverId: "s",
  runnerId: "r",
  projects: [{ id: "p", name: "Project" }],
  tasks: [
    {
      id: "t",
      runnerId: "r",
      projectId: "p",
      sequence: 1,
      provider: "codex",
      status: "succeeded",
      parts: [{ type: "text", text: "Original" }],
      createdAt: "2026-09-13T00:00:00Z",
    },
  ],
  replays: new Map(),
  resumes: new Map(),
})[0]!;
const record = (change: Partial<RemoteThreadMetadata> = {}): RemoteThreadMetadata => ({
  taskId: "t",
  revision: 1,
  title: null,
  pinned: false,
  archived: false,
  removed: false,
  viewedAtEpochMs: null,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: null,
  ...change,
});

it("returns the same presentation for an equal record and ignores revision-only changes", () => {
  const views = new ServerThreadMetadataViews();
  const first = views.present(view, record({ title: "Named", pinned: true }), true);
  expect(first).not.toBe(view);
  expect(first.thread.title).toBe("Named");
  expect(first.thread.pinned).toBe(true);
  expect(views.present(view, record({ title: "Named", pinned: true }), true)).toBe(first);
  expect(views.present(view, record({ title: "Named", pinned: true, revision: 9 }), true)).toBe(
    first,
  );
});

it.each<[string, Partial<RemoteThreadMetadata>]>([
  ["title", { title: "Renamed" }],
  ["pinned", { pinned: true }],
  ["archived", { archived: true }],
  ["viewedAtEpochMs", { viewedAtEpochMs: 7 }],
  ["snoozedUntil", { snoozedUntil: 11 }],
  ["settledAt", { settledAt: 13 }],
  ["sortOrder", { sortOrder: 17 }],
])("presents again when %s changes", (_field, change) => {
  const views = new ServerThreadMetadataViews();
  const before = views.present(view, record(), true);
  const after = views.present(view, record(change), true);
  expect(after).not.toBe(before);
  expect(after.thread).toMatchObject(change);
  expect(views.present(view, record(change), true)).toBe(after);
  const restored = views.present(view, record(), true);
  expect(restored).not.toBe(after);
  expect(restored.thread).toEqual(before.thread);
});

it("presents again when view tracking changes", () => {
  const views = new ServerThreadMetadataViews();
  const tracked = views.present(view, record({ viewedAtEpochMs: 1 }), true);
  const untracked = views.present(view, record({ viewedAtEpochMs: 1 }), false);
  expect(tracked.unread).toBe(true);
  expect(untracked.unread).toBe(false);
  expect(untracked).not.toBe(tracked);
});

it("never reuses a presentation for another base view", () => {
  const views = new ServerThreadMetadataViews();
  const first = views.present(view, record({ pinned: true }), true);
  const rebuilt = { ...view, repositoryLabel: "Other" };
  const second = views.present(rebuilt, record({ pinned: true }), true);
  expect(second).not.toBe(first);
  expect(second.repositoryLabel).toBe("Other");
  expect(views.present(view, record({ pinned: true }), true)).toBe(first);
});

it("does not serve a stale presentation when a retained record object is changed in place", () => {
  const views = new ServerThreadMetadataViews();
  const mutable: {
    -readonly [K in keyof ServerThreadPresentationMetadata]: ServerThreadPresentationMetadata[K];
  } = { pinned: false };
  const before = views.present(view, mutable, false);
  mutable.pinned = true;
  const after = views.present(view, mutable, false);
  expect(after).not.toBe(before);
  expect(after.thread.pinned).toBe(true);
});

it("presents a partial legacy record with the base thread as the fallback", () => {
  const views = new ServerThreadMetadataViews();
  const presented = views.present(view, { archived: true }, false);
  expect(presented.thread.archived).toBe(true);
  expect(presented.lifecycle).toBe("archived");
  expect(presented.thread.title).toBe(view.thread.title);
  expect(presented.thread.pinned).toBe(view.thread.pinned);
  expect(presented.thread.viewedAtEpochMs).toBe(view.thread.viewedAtEpochMs);
  expect(views.present(view, { archived: true }, false)).toBe(presented);
});
