// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { inlineDiffViewGateway } from "../../infrastructure/inlineDiffViewGateway";
import type {
  AgentDiffFile,
  AgentDiffFileList,
  AgentDiffSides,
  AgentDiffSource,
} from "./agentDiffSources";
import {
  useAgentDiffSurface,
  type AgentDiffRevealRequest,
  type AgentDiffSurfaceState,
} from "./useAgentDiffSurface";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

function file(displayPath: string): AgentDiffFile {
  return {
    repositoryRoot: "/repo",
    relativePath: displayPath,
    displayPath,
    oldRelativePath: null,
    status: "modified",
    added: 1,
    deleted: 1,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function memorySource(
  key: string,
  files: ReadonlyArray<AgentDiffFile>,
  sides: (file: AgentDiffFile) => AgentDiffSides,
  list: Promise<AgentDiffFileList> = Promise.resolve({
    files,
    truncated: false,
    statsPartial: false,
    unavailableReason: null,
  }),
  identity: string = key,
): AgentDiffSource {
  return { key, identity, listFiles: () => list, readSides: async (target) => sides(target) };
}

interface ProbeBox {
  current: AgentDiffSurfaceState | null;
}

const box: ProbeBox = { current: null };

function Probe(props: {
  readonly source: AgentDiffSource | null;
  readonly ignoreWhitespace: boolean;
  readonly reveal: AgentDiffRevealRequest | null;
}) {
  box.current = useAgentDiffSurface({
    source: props.source,
    computation: inlineDiffViewGateway,
    ignoreWhitespace: props.ignoreWhitespace,
    reveal: props.reveal,
  });
  return null;
}

function render(
  source: AgentDiffSource | null,
  ignoreWhitespace = false,
  reveal: AgentDiffRevealRequest | null = null,
): ProbeBox {
  ui = ui ?? mountUi();
  ui.render(<Probe ignoreWhitespace={ignoreWhitespace} reveal={reveal} source={source} />);
  return box;
}

const plainSides = (): AgentDiffSides => ({
  original: "a\nb\n",
  modified: "a\nB\n",
  truncated: false,
  unavailableReason: null,
});

describe("useAgentDiffSurface", () => {
  it("expands the first three files and computes their hunks", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const box = render(memorySource("s1", files, plainSides));

    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));
    await waitForReact(() => expect(box.current?.files[0]?.body.kind).toBe("ready"));
    expect(box.current?.files.map((view) => view.body.kind)).toEqual([
      "ready",
      "ready",
      "ready",
      "collapsed",
    ]);
  });

  it("ignores a late file list from a superseded source", async () => {
    const late = deferred<AgentDiffFileList>();
    render(memorySource("old", [], plainSides, late.promise));
    const box = render(memorySource("new", [file("fresh.ts")], plainSides));

    await waitForReact(() =>
      expect(box.current?.files.map((view) => view.file.displayPath)).toEqual(["fresh.ts"]),
    );
    await act(async () =>
      late.resolve({
        files: [file("stale.ts")],
        truncated: false,
        statsPartial: false,
        unavailableReason: null,
      }),
    );
    expect(box.current?.files.map((view) => view.file.displayPath)).toEqual(["fresh.ts"]);
  });

  it("shows binary and oversized files as unavailable with a reason", async () => {
    const box = render(
      memorySource("s2", [file("image.png")], () => ({
        original: "",
        modified: "",
        truncated: false,
        unavailableReason: "binary",
      })),
    );
    await waitForReact(() =>
      expect(box.current?.files[0]?.body).toEqual({
        kind: "unavailable",
        reason: "Binary file. Open it in the editor to inspect it.",
      }),
    );
  });

  it("recomputes with whitespace ignored without refetching the list", async () => {
    let listCalls = 0;
    const source: AgentDiffSource = {
      key: "ws",
      identity: "ws",
      listFiles: async () => {
        listCalls += 1;
        return {
          files: [file("a.ts")],
          truncated: false,
          statsPartial: false,
          unavailableReason: null,
        };
      },
      readSides: async () => ({
        original: "  x\n",
        modified: "    x\n",
        truncated: false,
        unavailableReason: null,
      }),
    };
    const box = render(source, false);
    await waitForReact(() =>
      expect(box.current?.files[0]?.body).toMatchObject({ kind: "ready", added: 1 }),
    );

    render(source, true);
    await waitForReact(() =>
      expect(box.current?.files[0]?.body).toMatchObject({ kind: "ready", added: 0 }),
    );
    expect(listCalls).toBe(1);
  });

  it("toggles, reveals and collapses files", async () => {
    const box = render(memorySource("s3", ["a.ts", "b.ts", "c.ts", "d.ts"].map(file), plainSides));
    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));

    act(() => box.current?.toggleFile("a.ts"));
    act(() => box.current?.revealFile("d.ts"));
    expect(box.current?.files.map((view) => view.body.kind === "collapsed")).toEqual([
      true,
      false,
      false,
      false,
    ]);
    act(() => box.current?.collapseAll());
    expect(box.current?.files.every((view) => view.body.kind === "collapsed")).toBe(true);
  });

  it("surfaces a failed list with its message", async () => {
    const box = render({
      key: "broken",
      identity: "broken",
      listFiles: () => Promise.reject(new Error("git status failed")),
      readSides: async () => plainSides(),
    });
    await waitForReact(() =>
      expect(box.current?.status).toEqual({ kind: "failed", message: "git status failed" }),
    );
  });

  it("reads sides from the source that produced the list after a same-key rebuild", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const box = render(memorySource("stable", files, plainSides));
    await waitForReact(() => expect(box.current?.files[0]?.body.kind).toBe("ready"));

    const rebuilt = memorySource("stable", files, () => ({
      original: "",
      modified: "",
      truncated: false,
      unavailableReason: "missing",
    }));
    render(rebuilt);
    act(() => box.current?.toggleFile("d.ts"));

    await waitForReact(() => expect(box.current?.files[3]?.body.kind).toBe("ready"));
  });

  it("reloads a new revision in place and keeps the expanded files", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const box = render(memorySource("rev-1", files, plainSides, undefined, "tree"));
    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));
    act(() => box.current?.toggleFile("a.ts"));
    act(() => box.current?.toggleFile("d.ts"));

    const next = deferred<AgentDiffFileList>();
    render(memorySource("rev-2", files, plainSides, next.promise, "tree"));
    expect(box.current?.status.kind).toBe("ready");
    expect(box.current?.files).toHaveLength(4);
    await act(async () =>
      next.resolve({
        files: [...files, file("e.ts")],
        truncated: false,
        statsPartial: false,
        unavailableReason: null,
      }),
    );

    await waitForReact(() =>
      expect(box.current?.files.map((view) => view.body.kind === "collapsed")).toEqual([
        true,
        false,
        false,
        false,
        true,
      ]),
    );
  });

  it("keeps the expanded files and reports the error when a live reload fails", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const box = render(memorySource("rev-1", files, plainSides, undefined, "tree"));
    await waitForReact(() => expect(box.current?.status.kind).toBe("ready"));
    act(() => box.current?.toggleFile("d.ts"));
    const expandedBefore = box.current?.files.map((view) => view.body.kind === "collapsed");

    render(
      memorySource(
        "rev-2",
        files,
        plainSides,
        Promise.reject(new Error("git status failed")),
        "tree",
      ),
    );

    await waitForReact(() => expect(box.current?.reloadError).toBe("git status failed"));
    expect(box.current?.status.kind).toBe("ready");
    expect(box.current?.files.map((view) => view.body.kind === "collapsed")).toEqual(
      expandedBefore,
    );
    await waitForReact(() => expect(box.current?.files[3]?.body.kind).toBe("ready"));

    render(memorySource("rev-3", files, plainSides, undefined, "tree"));
    await waitForReact(() => expect(box.current?.reloadError).toBeNull());
    expect(box.current?.files.map((view) => view.body.kind === "collapsed")).toEqual(
      expandedBefore,
    );
  });

  it("does not diff a cut file and says it is too large", async () => {
    const box = render(
      memorySource("cut", [file("big.ts")], () => ({
        original: "a\n",
        modified: "b\n",
        truncated: true,
        unavailableReason: null,
      })),
    );
    await waitForReact(() =>
      expect(box.current?.files[0]?.body).toEqual({
        kind: "unavailable",
        reason: "This file is too large to show here. Open it in the editor.",
      }),
    );
  });

  it("expands and reports a requested file once its list is ready", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const request = { relativePath: "d.ts" };
    const box = render(memorySource("reveal", files, plainSides), false, request);

    await waitForReact(() =>
      expect(box.current?.revealed).toEqual({ request, displayPath: "d.ts" }),
    );
    expect(box.current?.files[3]?.body.kind).not.toBe("collapsed");
  });

  it("reports partial line stats from the list", async () => {
    const box = render(
      memorySource(
        "partial",
        [file("a.ts")],
        plainSides,
        Promise.resolve({
          files: [file("a.ts")],
          truncated: false,
          statsPartial: true,
          unavailableReason: null,
        }),
      ),
    );
    await waitForReact(() =>
      expect(box.current?.status).toEqual({ kind: "ready", truncated: false, statsPartial: true }),
    );
  });
});
