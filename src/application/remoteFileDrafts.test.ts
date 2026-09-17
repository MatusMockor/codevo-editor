import { expect, it } from "vitest";
import { createRemoteFileDraftStore } from "./remoteFileDrafts";
const scope = { serverId: "server", runnerId: "runner", projectId: "project", taskId: "task" };
const draft = { path: "index.ts", text: "mine", original: "before", version: "hash" };
it("isolates all server checkout authorities and never evicts dirty drafts", () => {
  const store = createRemoteFileDraftStore();
  expect(store.put(scope, draft)).toBe(true);
  expect(store.get({ ...scope, runnerId: "replacement" }, draft.path)).toBeUndefined();
  expect(store.get({ ...scope, taskId: "other" }, draft.path)).toBeUndefined();
  for (let index = 1; index < 12; index++)
    expect(store.put(scope, { ...draft, path: `${index}.ts` })).toBe(true);
  expect(store.put(scope, { ...draft, path: "overflow.ts" })).toBe(false);
  expect(store.get(scope, draft.path)).toEqual(draft);
  expect(store.put(scope, { ...draft, text: "x".repeat(2_000_001) })).toBe(false);
  expect(store.get(scope, draft.path)?.text).toBe("mine");
});
it("settles only the exact submitted draft and retains newer edits", () => {
  const store = createRemoteFileDraftStore();
  store.put(scope, draft);
  const captured = store.get(scope, draft.path);
  store.put(scope, { ...draft, text: "newer" });
  store.removeIfSame(scope, draft.path, captured);
  expect(store.get(scope, draft.path)?.text).toBe("newer");
  store.removeIfSame(scope, draft.path, store.get(scope, draft.path));
  expect(store.get(scope, draft.path)).toBeUndefined();
});
it("ignores superseded save settlements and retains the latest draft", () => {
  const store = createRemoteFileDraftStore();
  store.put(scope, draft);
  const old = store.beginSave(scope, draft.path, "hash")!;
  const current = store.beginSave(scope, draft.path, "hash")!;
  store.completeSave(scope, old, {
    path: draft.path,
    text: "obsolete",
    version: "old",
    unavailableReason: null,
  });
  expect(store.get(scope, draft.path)?.version).toBe("hash");
  store.completeSave(scope, current, {
    path: draft.path,
    text: "new server",
    version: "fresh",
    unavailableReason: null,
  });
  expect(store.get(scope, draft.path)).toEqual({
    ...draft,
    original: "new server",
    version: "fresh",
  });
});
it("bounds outstanding saves without evicting their settlement authority", () => {
  const store = createRemoteFileDraftStore();
  for (let index = 0; index < 12; index++)
    expect(store.beginSave(scope, `${index}.ts`, "hash")).not.toBeNull();
  expect(store.beginSave(scope, "overflow.ts", "hash")).toBeNull();
  expect(store.isSaving(scope, "0.ts")).toBe(true);
});
