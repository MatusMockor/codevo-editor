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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const file = (text = "original", version = "hash-one"): RemoteFileContent => ({
  path: "index.ts",
  text,
  version,
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
    listDirectory: vi.fn<RemoteFilesGateway["listDirectory"]>(async () => empty),
    readFile: vi.fn<RemoteFilesGateway["readFile"]>(async () => file()),
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
it("does not publish late file content after switching owners", async () => {
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
  await act(async () => root.render(<Harness owner={b} gateway={gateway} />));
  await act(async () => {
    old.resolve(file("foreign"));
    await opening;
  });
  expect(state.file).toBeNull();
  expect(state.busy).toBe(false);
});
it("ignores calls from a stale owner's handle after the checkout changes", async () => {
  const gateway = api();
  const a = scope();
  await act(async () => root.render(<Harness owner={a} gateway={gateway} />));
  const stale = state;
  await act(async () => root.render(<Harness owner={scope()} gateway={gateway} />));
  const reads = gateway.readFile.mock.calls.length;
  await act(async () => stale.open("index.ts"));
  expect(gateway.readFile).toHaveBeenCalledTimes(reads);
  expect(state.file).toBeNull();
});
it("lets a later open win over a slower earlier read", async () => {
  const gateway = api();
  const slow = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => slow.promise);
  gateway.readFile.mockResolvedValueOnce({ ...file("second"), path: "second.ts" });
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  let first!: Promise<void>;
  act(() => {
    first = state.open("index.ts");
  });
  await act(async () => state.open("second.ts"));
  await act(async () => {
    slow.resolve(file("first"));
    await first;
  });
  expect(state.file?.path).toBe("second.ts");
  expect(state.file?.text).toBe("second");
});
it("surfaces a runner outage on open and keeps the shown file unchanged", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  gateway.readFile.mockRejectedValueOnce(new Error("Runner connection failed."));
  await act(async () => state.open("other.ts"));
  expect(state.error).toBe("Runner connection failed.");
  expect(state.file?.text).toBe("original");
  expect(state.busy).toBe(false);
});
it("compares with the latest server text and adopts it only on request", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  gateway.readFile.mockResolvedValueOnce(file("theirs", "hash-two"));
  await act(async () => state.compare());
  expect(state.comparison?.text).toBe("theirs");
  expect(state.file?.text).toBe("original");
  act(() => state.showLatest());
  expect(state.file?.text).toBe("theirs");
  expect(state.file?.version).toBe("hash-two");
  expect(state.comparison).toBeNull();
});
it("drops a comparison read that settles after the checkout changes", async () => {
  const gateway = api();
  const a = scope();
  await act(async () => root.render(<Harness owner={a} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  const late = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => late.promise);
  let comparing!: Promise<void>;
  act(() => {
    comparing = state.compare();
  });
  await act(async () => root.render(<Harness owner={scope()} gateway={gateway} />));
  await act(async () => {
    late.resolve(file("foreign"));
    await comparing;
  });
  expect(state.comparison).toBeNull();
  expect(state.file).toBeNull();
});
it("drops a comparison when another file is opened first", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  const late = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => late.promise);
  gateway.readFile.mockResolvedValueOnce({ ...file("other"), path: "other.ts" });
  let comparing!: Promise<void>;
  act(() => {
    comparing = state.compare();
  });
  await act(async () => state.open("other.ts"));
  await act(async () => {
    late.resolve(file("late"));
    await comparing;
  });
  expect(state.file?.path).toBe("other.ts");
  expect(state.comparison).toBeNull();
});
it("refuses to compare a server file that is no longer text", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  gateway.readFile.mockResolvedValueOnce({
    path: "index.ts",
    text: "",
    version: null,
    unavailableReason: "large",
  });
  await act(async () => state.compare());
  expect(state.comparison).toBeNull();
  expect(state.error).toBe("The server file cannot be compared as text.");
});
