// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  RemoteDirectory,
  RemoteFileContent,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { useRemoteFiles, type RemoteFilesGateway } from "./useRemoteFiles";

let root: Root;
let state: ReturnType<typeof useRemoteFiles>;
let counter = 0;
const empty: RemoteDirectory = { entries: [], nextOffset: null, truncated: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const file = (text = "original"): RemoteFileContent => ({
  path: "index.ts",
  text,
  version: "hash-one",
  unavailableReason: null,
});
const scope = (): RemoteSurfaceScope => ({
  serverId: `server-${counter++}`,
  runnerId: "runner",
  projectId: "project",
  taskId: "task",
});
function Harness({ owner, gateway }: { owner: RemoteSurfaceScope; gateway: RemoteFilesGateway }) {
  state = useRemoteFiles(owner, gateway);
  return <div>{state.error}</div>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
function api() {
  return {
    listDirectory: vi.fn(async () => empty),
    readFile: vi.fn(async () => file()),
    writeFile: vi.fn(async () => file("edited")),
  };
}
it("rejects old directory responses across A to B to A", async () => {
  const old = deferred<RemoteDirectory>();
  const gateway = api();
  const a = scope();
  const b = scope();
  gateway.listDirectory.mockImplementationOnce(() => old.promise);
  await act(async () => root.render(<Harness owner={a} gateway={gateway} />));
  await act(async () => root.render(<Harness owner={b} gateway={gateway} />));
  await act(async () => root.render(<Harness owner={a} gateway={gateway} />));
  await act(async () =>
    old.resolve({ ...empty, entries: [{ name: "stale", path: "stale", kind: "file" }] }),
  );
  expect(state.directory).toEqual(empty);
});
it("keeps dirty content after conflict and sends exact original version", async () => {
  const gateway = api();
  const owner = scope();
  gateway.writeFile.mockRejectedValueOnce(
    new Error("File changed on server. Reload before saving."),
  );
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("mine"));
  await act(async () => state.save());
  expect(gateway.writeFile).toHaveBeenCalledWith({
    ...owner,
    path: "index.ts",
    text: "mine",
    expectedVersion: "hash-one",
  });
  expect(state.text).toBe("mine");
  expect(state.dirty).toBe(true);
  expect(state.error).toContain("File changed");
  await act(async () => state.open("another.ts"));
  expect(gateway.readFile).toHaveBeenCalledTimes(1);
});
it("preserves edits made during save and saves them against the new version", async () => {
  const gateway = api();
  const owner = scope();
  const saved = deferred<RemoteFileContent>();
  gateway.writeFile.mockImplementationOnce(() => saved.promise);
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("submitted"));
  let saving!: Promise<void>;
  act(() => {
    saving = state.save();
  });
  act(() => state.edit("newer"));
  await act(async () => {
    saved.resolve({ ...file("submitted"), version: "hash-two" });
    await saving;
  });
  expect(state.text).toBe("newer");
  expect(state.dirty).toBe(true);
  await act(async () => state.save());
  expect(gateway.writeFile).toHaveBeenLastCalledWith({
    ...owner,
    path: "index.ts",
    text: "newer",
    expectedVersion: "hash-two",
  });
});
it("retains unsaved text when the panel unmounts and returns to the same owner", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("retained"));
  act(() => root.render(null));
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  expect(state.text).toBe("retained");
  expect(state.dirty).toBe(true);
  expect(state.file?.version).toBe("hash-one");
});
it("does not publish late file content or start stale saves after switching owners", async () => {
  const gateway = api();
  const old = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => old.promise);
  const a = scope();
  const b = scope();
  await act(async () => root.render(<Harness owner={a} gateway={gateway} />));
  let opening!: Promise<void>;
  act(() => {
    opening = state.open("index.ts");
  });
  const stale = state;
  await act(async () => root.render(<Harness owner={b} gateway={gateway} />));
  await act(async () => {
    old.resolve(file("foreign"));
    await opening;
  });
  expect(state.file).toBeNull();
  await act(async () => stale.save());
  expect(gateway.writeFile).not.toHaveBeenCalled();
});
it("keeps a revert typed during pending save as an unsaved draft", async () => {
  const gateway = api();
  const owner = scope();
  const saved = deferred<RemoteFileContent>();
  gateway.writeFile.mockImplementationOnce(() => saved.promise);
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("submitted"));
  let saving!: Promise<void>;
  act(() => {
    saving = state.save();
  });
  act(() => state.edit("original"));
  await act(async () => {
    saved.resolve({ ...file("submitted"), version: "hash-two" });
    await saving;
  });
  act(() => root.render(null));
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  expect(state.text).toBe("original");
  expect(state.file?.text).toBe("submitted");
  expect(state.dirty).toBe(true);
});
it("clears exactly the submitted draft when a save finishes after unmount", async () => {
  const gateway = api();
  const owner = scope();
  const saved = deferred<RemoteFileContent>();
  gateway.writeFile.mockImplementationOnce(() => saved.promise);
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("submitted"));
  let saving!: Promise<void>;
  act(() => {
    saving = state.save();
  });
  act(() => root.render(null));
  await act(async () => {
    saved.resolve(file("submitted"));
    await saving;
  });
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  expect(state.dirty).toBe(false);
  expect(state.file).toBeNull();
});
it("compares a conflict while retaining edits, and refreshes version only after explicit choice", async () => {
  const gateway = api();
  const owner = scope();
  gateway.writeFile.mockRejectedValueOnce(new Error("File changed"));
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("mine"));
  await act(async () => state.save());
  gateway.readFile.mockResolvedValueOnce({ ...file("theirs"), version: "new-server-version" });
  await act(async () => state.compare());
  expect(state.text).toBe("mine");
  expect(state.file?.version).toBe("hash-one");
  act(() => state.resolveComparison(true));
  expect(state.text).toBe("mine");
  expect(state.file?.version).toBe("new-server-version");
  await act(async () => state.save());
  expect(gateway.writeFile).toHaveBeenLastCalledWith({
    ...owner,
    path: "index.ts",
    text: "mine",
    expectedVersion: "new-server-version",
  });
});
it("does not let a stale editor callback overwrite the newly opened document", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  const stale = state;
  gateway.readFile.mockResolvedValueOnce({ ...file("new file"), path: "second.ts" });
  await act(async () => state.open("second.ts"));
  act(() => stale.edit("late edit"));
  expect(state.text).toBe("new file");
});
it.each([false, true])(
  "reconciles reverted drafts after leaving during save (return before completion: %s)",
  async (returnEarly) => {
    const gateway = api();
    const owner = scope();
    const saved = deferred<RemoteFileContent>();
    gateway.writeFile.mockImplementationOnce(() => saved.promise);
    await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
    await act(async () => state.open("index.ts"));
    act(() => state.edit("submitted"));
    let saving!: Promise<void>;
    act(() => {
      saving = state.save();
    });
    act(() => state.edit("original"));
    act(() => root.render(null));
    if (returnEarly)
      await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
    await act(async () => {
      saved.resolve({ ...file("submitted"), version: "hash-new" });
      await saving;
    });
    if (!returnEarly)
      await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
    expect(state.text).toBe("original");
    expect(state.file?.text).toBe("submitted");
    expect(state.file?.version).toBe("hash-new");
    expect(state.dirty).toBe(true);
  },
);
it("invalidates an open comparison when save settles", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("edited"));
  await act(async () => state.compare());
  expect(state.comparison).not.toBeNull();
  await act(async () => state.save());
  expect(state.comparison).toBeNull();
  act(() => state.resolveComparison(false));
  expect(state.text).toBe("edited");
  expect(state.dirty).toBe(false);
});
it("retains a revert entered after remount while an earlier save is pending", async () => {
  const gateway = api();
  const owner = scope();
  const saved = deferred<RemoteFileContent>();
  gateway.writeFile.mockImplementationOnce(() => saved.promise);
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("submitted"));
  let saving!: Promise<void>;
  act(() => {
    saving = state.save();
  });
  act(() => root.render(null));
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  act(() => state.edit("original"));
  await act(async () => {
    saved.resolve({ ...file("submitted"), version: "hash-new" });
    await saving;
  });
  expect(state.text).toBe("original");
  expect(state.file?.text).toBe("submitted");
  expect(state.dirty).toBe(true);
});
