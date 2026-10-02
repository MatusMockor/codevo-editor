// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createRemoteFileRevealRequest,
  type RemoteFileRevealRequest,
} from "../../application/remoteFileRevealRequest";
import type {
  RemoteFileRevealSettlement,
  RemoteFileRevealTarget,
} from "../../domain/remoteFileReveal";
import {
  RemoteSurfaceNotFoundError,
  RemoteSurfaceNotRegularFileError,
  type RemoteDirectory,
  type RemoteFileContent,
  type RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { useRemoteFiles, type RemoteFilesGateway } from "./useRemoteFiles";

let root: Root;
let state: ReturnType<typeof useRemoteFiles>;
let counter = 0;
let requestId = 0;

const listing = (path: string): RemoteDirectory => ({
  entries: [{ name: "app.ts", path: path === "" ? "app.ts" : `${path}/app.ts`, kind: "file" }],
  nextOffset: null,
  truncated: false,
});

function content(path: string, text = "one\ntwo\nthree"): RemoteFileContent {
  return { path, text, version: "hash-one", unavailableReason: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function scope(): RemoteSurfaceScope {
  return {
    serverId: `reveal-server-${counter++}`,
    runnerId: "runner",
    projectId: "project",
    taskId: "task",
  };
}

function api() {
  return {
    listDirectory: vi.fn<RemoteFilesGateway["listDirectory"]>(async ({ path }) => listing(path)),
    readFile: vi.fn<RemoteFilesGateway["readFile"]>(async ({ path }) => content(path)),
    writeFile: vi.fn<RemoteFilesGateway["writeFile"]>(async ({ path, text }) =>
      content(path, text),
    ),
  };
}

function request(owner: RemoteSurfaceScope, target: RemoteFileRevealTarget) {
  const outcomes: RemoteFileRevealSettlement[] = [];
  const accepted = vi.fn();
  const reveal = createRemoteFileRevealRequest(++requestId, owner, target, {
    accepted,
    settled: (outcome) => outcomes.push(outcome),
  });
  return { reveal, outcomes, accepted };
}

function Harness({
  owner,
  gateway,
  reveal = null,
}: {
  readonly owner: RemoteSurfaceScope;
  readonly gateway: RemoteFilesGateway;
  readonly reveal?: RemoteFileRevealRequest | null;
}) {
  state = useRemoteFiles(owner, gateway, reveal);
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
});

afterEach(() => act(() => root.unmount()));

it("opens a linked file with its parent directory and records the linked position", async () => {
  const gateway = api();
  const owner = scope();
  const target = { path: "src/app.ts", line: 42, column: 5 };
  const { reveal, outcomes, accepted } = request(owner, target);

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(accepted).toHaveBeenCalledOnce();
  expect(gateway.readFile).toHaveBeenCalledExactlyOnceWith({ ...owner, path: "src/app.ts" });
  expect(gateway.listDirectory).toHaveBeenLastCalledWith({ ...owner, path: "src", offset: 0 });
  expect(state.file?.path).toBe("src/app.ts");
  expect(state.text).toBe("one\ntwo\nthree");
  expect(state.path).toBe("src");
  expect(state.directory).toEqual(listing("src"));
  expect(state.revealAt).toEqual({ ...target, id: reveal.id });
  expect(state.busy).toBe(false);
});

it("keeps unsaved edits to another file and refuses to navigate away", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("mine"));
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 3, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["unsavedChanges"]);
  expect(gateway.readFile).toHaveBeenCalledOnce();
  expect(state.file?.path).toBe("index.ts");
  expect(state.text).toBe("mine");
  expect(state.dirty).toBe(true);
  expect(state.revealAt).toBeNull();
});

it("refuses to replace a restored draft of another file on first mount", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("kept"));
  act(() => root.render(null));
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 1, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["unsavedChanges"]);
  expect(state.file?.path).toBe("index.ts");
  expect(state.text).toBe("kept");
});

it("reveals a position in the dirty file itself without rereading or losing edits", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("mine"));
  const target = { path: "index.ts", line: 2, column: null };
  const { reveal, outcomes } = request(owner, target);

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(gateway.readFile).toHaveBeenCalledOnce();
  expect(state.text).toBe("mine");
  expect(state.revealAt).toEqual({ ...target, id: reveal.id });
});

it("drops a linked read that resolves after switching to another checkout", async () => {
  const gateway = api();
  const late = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => late.promise);
  const a = scope();
  const b = scope();
  const { reveal, outcomes } = request(a, { path: "src/app.ts", line: 9, column: null });
  await act(async () => root.render(<Harness owner={a} gateway={gateway} reveal={reveal} />));
  await act(async () => root.render(<Harness owner={b} gateway={gateway} reveal={reveal} />));

  await act(async () => late.resolve(content("src/app.ts", "foreign")));

  expect(outcomes).toEqual(["superseded"]);
  expect(state.file).toBeNull();
  expect(state.revealAt).toBeNull();
  expect(gateway.readFile).toHaveBeenCalledOnce();
});

it("never applies a request captured for a different checkout", async () => {
  const gateway = api();
  const owner = scope();
  const { reveal, outcomes, accepted } = request(scope(), {
    path: "src/app.ts",
    line: 1,
    column: null,
  });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["superseded"]);
  expect(gateway.readFile).not.toHaveBeenCalled();
  expect(state.file).toBeNull();
  expect(accepted).not.toHaveBeenCalled();
});

it("lets a later directory browse win over a slower linked read", async () => {
  const gateway = api();
  const slow = deferred<RemoteFileContent>();
  gateway.readFile.mockImplementationOnce(() => slow.promise);
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 1, column: null });
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));
  await act(async () => state.browse("lib"));

  await act(async () => slow.resolve(content("src/app.ts")));

  expect(outcomes).toEqual(["superseded"]);
  expect(state.path).toBe("lib");
  expect(state.file).toBeNull();
});

it("reports a missing server file truthfully in the panel and to the link", async () => {
  const gateway = api();
  gateway.readFile.mockRejectedValueOnce(
    new RemoteSurfaceNotFoundError("This file isn't on the server."),
  );
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src/gone.ts", line: 1, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["notFound"]);
  expect(state.error).toBe("This file isn't on the server.");
  expect(state.file).toBeNull();
  expect(state.busy).toBe(false);
  expect(state.path).toBe("");
  expect(state.directory).toEqual(listing(""));
});

it("leaves the shown directory alone when a linked read fails", async () => {
  const gateway = api();
  gateway.readFile.mockRejectedValueOnce(
    new RemoteSurfaceNotFoundError("This file isn't on the server."),
  );
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.browse("lib"));
  const listed = gateway.listDirectory.mock.calls.length;
  const { reveal, outcomes } = request(owner, { path: "src/gone.ts", line: 1, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["notFound"]);
  expect(state.path).toBe("lib");
  expect(state.directory).toEqual(listing("lib"));
  expect(gateway.listDirectory).toHaveBeenCalledTimes(listed);
});

it("does not relist a parent directory that is already shown", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.browse("src"));
  const listed = gateway.listDirectory.mock.calls.length;
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 4, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(state.file?.path).toBe("src/app.ts");
  expect(state.path).toBe("src");
  expect(gateway.listDirectory).toHaveBeenCalledTimes(listed);
});

it("reports a directory or symlink target as not a regular text file", async () => {
  const gateway = api();
  gateway.readFile.mockRejectedValueOnce(
    new RemoteSurfaceNotRegularFileError("This path isn't a regular text file on the server."),
  );
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src", line: null, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["notRegularFile"]);
  expect(state.error).toBe("This path isn't a regular text file on the server.");
});

it("reports other read failures as failed", async () => {
  const gateway = api();
  gateway.readFile.mockRejectedValueOnce(new Error("Runner connection failed."));
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 1, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["failed"]);
  expect(state.error).toBe("Runner connection failed.");
});

it("shows binary server files without a text position and reports them unreadable", async () => {
  const gateway = api();
  gateway.readFile.mockResolvedValueOnce({
    path: "logo.png",
    text: "",
    version: null,
    unavailableReason: "binary",
  });
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "logo.png", line: 4, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["unreadable"]);
  expect(state.file?.unavailableReason).toBe("binary");
  expect(state.revealAt).toBeNull();
  expect(gateway.listDirectory).toHaveBeenLastCalledWith({ ...owner, path: "", offset: 0 });
});

it("still opens the file when its directory listing fails", async () => {
  const gateway = api();
  gateway.listDirectory.mockImplementation(async ({ path }) => {
    if (path === "src") throw new Error("listing failed");
    return listing(path);
  });
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 2, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(state.file?.path).toBe("src/app.ts");
  expect(state.path).toBe("");
  expect(state.directory).toEqual(listing(""));
  expect(state.error).toBeNull();
});

it("shows the file before a slow directory listing arrives", async () => {
  const gateway = api();
  const slow = deferred<RemoteDirectory>();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  gateway.listDirectory.mockImplementationOnce(() => slow.promise);
  const { reveal, outcomes } = request(owner, { path: "src/app.ts", line: 2, column: null });

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(state.file?.path).toBe("src/app.ts");
  expect(state.busy).toBe(false);
  await act(async () => slow.resolve(listing("src")));
  expect(state.path).toBe("src");
  expect(state.file?.path).toBe("src/app.ts");
});

it("settles a StrictMode double-run with the real outcome", async () => {
  const gateway = api();
  gateway.readFile.mockRejectedValue(
    new RemoteSurfaceNotFoundError("This file isn't on the server."),
  );
  const owner = scope();
  const { reveal, outcomes } = request(owner, { path: "src/gone.ts", line: 1, column: null });

  await act(async () =>
    root.render(
      <StrictMode>
        <Harness owner={owner} gateway={gateway} reveal={reveal} />
      </StrictMode>,
    ),
  );

  expect(outcomes).toEqual(["notFound"]);
  expect(state.error).toBe("This file isn't on the server.");
});

it("refuses another file while a save is in flight and reveals within the saving file", async () => {
  const gateway = api();
  const saved = deferred<RemoteFileContent>();
  gateway.writeFile.mockImplementationOnce(() => saved.promise);
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("index.ts"));
  act(() => state.edit("mine"));
  let saving!: Promise<void>;
  act(() => {
    saving = state.save();
  });
  const other = request(owner, { path: "src/app.ts", line: 1, column: null });
  await act(async () =>
    root.render(<Harness owner={owner} gateway={gateway} reveal={other.reveal} />),
  );
  const same = request(owner, { path: "index.ts", line: 2, column: null });
  await act(async () =>
    root.render(<Harness owner={owner} gateway={gateway} reveal={same.reveal} />),
  );

  expect(other.outcomes).toEqual(["saveInProgress"]);
  expect(same.outcomes).toEqual(["opened"]);
  expect(gateway.readFile).toHaveBeenCalledOnce();
  expect(state.text).toBe("mine");
  await act(async () => {
    saved.resolve(content("index.ts", "mine"));
    await saving;
  });
});

it("rereads a clean open file to reveal another line", async () => {
  const gateway = api();
  const owner = scope();
  await act(async () => root.render(<Harness owner={owner} gateway={gateway} />));
  await act(async () => state.open("src/app.ts"));
  const target = { path: "src/app.ts", line: 3, column: 2 };
  const { reveal, outcomes } = request(owner, target);

  await act(async () => root.render(<Harness owner={owner} gateway={gateway} reveal={reveal} />));

  expect(outcomes).toEqual(["opened"]);
  expect(gateway.readFile).toHaveBeenCalledTimes(2);
  expect(state.revealAt).toEqual({ ...target, id: reveal.id });
});
