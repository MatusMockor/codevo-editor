// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DebugWatchAtCursorCapture,
  DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import type { EditorDocument } from "../domain/workspace";
import {
  MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES,
  useJsTestRunSelectionCommands,
  type JsTestExplorerScopeRunnerPort,
  type JsTestRunSelectionCommands,
  type JsTestRunSelectionBoundedRead,
  type UseJsTestRunSelectionCommandsOptions,
} from "./useJsTestRunSelectionCommands";

const ROOT = "/workspace";
const FILE = `${ROOT}/src/cart.test.ts`;
const SOURCE = `describe("cart", () => {
  test.each([[1]])("charges %i", () => {
    expect(true).toBe(true);
  });
});`;

describe("useJsTestRunSelectionCommands", () => {
  let host: HTMLDivElement;
  let reactRoot: Root;
  let latest: JsTestRunSelectionCommands;
  let capture: DebugWatchAtCursorCapture | null;
  let document: EditorDocument | null;
  let options: UseJsTestRunSelectionCommandsOptions;
  let runner: JsTestExplorerScopeRunnerPort;

  beforeEach(() => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    reactRoot = createRoot(host);
    capture = editorCapture();
    document = editorDocument();
    runner = scopeRunner({
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => true),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(async () => true),
    });
    options = {
      activationEpoch: () => 7,
      activeDocument: () => document,
      captureReader: reader(() => capture),
      isWorkspaceCurrent: (root, owner) => root === ROOT && owner === "editor-owner",
      isWorkspaceTrusted: () => true,
      readTextFileBounded: vi.fn(async () => ({ status: "ok" as const, content: SOURCE })),
      runner,
      workspaceId: "workspace-id",
      workspaceOwnerKey: "editor-owner",
      workspaceRoot: ROOT,
    };
  });

  afterEach(() => {
    act(() => reactRoot.unmount());
    host.remove();
  });

  it("routes exact cursor and whole-file scopes through the Explorer runner", async () => {
    render();

    expect(latest.canRunAtCursor()).toBe(true);
    await act(async () => expect(await latest.runAtCursor()).toBe(true));
    expect(runner.runScope).toHaveBeenNthCalledWith(1, {
      fullName: "cart charges",
      kind: "test",
      nameMatch: "prefix",
      relativeFilePath: "src/cart.test.ts",
    });

    expect(latest.canRunCurrentFile()).toBe(true);
    await act(async () => expect(await latest.runCurrentFile()).toBe(true));
    expect(runner.runScope).toHaveBeenNthCalledWith(2, {
      kind: "file",
      relativeFilePath: "src/cart.test.ts",
    });
    expect(options.readTextFileBounded).toHaveBeenCalledWith(
      FILE,
      MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES,
    );
  });

  it("performs an exact double atomic capture before exposing either command", () => {
    const changed = editorCapture({ modelVersion: 8 });
    const captures = [capture, changed, capture];
    options = { ...options, captureReader: reader(() => captures.shift() ?? capture) };
    render();

    expect(latest.canRunAtCursor()).toBe(false);
    expect(runner.canRunScope).not.toHaveBeenCalled();
  });

  it.each([
    ["dirty editor", () => (document = editorDocument({ content: `${SOURCE}\n// dirty` }))],
    ["untrusted workspace", () => (options = { ...options, isWorkspaceTrusted: () => false })],
    [
      "non-test file",
      () => {
        capture = editorCapture({ documentPath: `${ROOT}/src/cart.ts` });
        document = editorDocument({ path: `${ROOT}/src/cart.ts` });
      },
    ],
    ["missing workspace", () => (options = { ...options, workspaceId: null })],
    ["wrong owner", () => (options = { ...options, workspaceOwnerKey: "replacement" })],
    ["invalid activation", () => (options = { ...options, activationEpoch: () => -1 })],
  ])("rejects %s before touching disk or the runner", (_label, arrange) => {
    arrange();
    render();

    expect(latest.canRunAtCursor()).toBe(false);
    expect(latest.canRunCurrentFile()).toBe(false);
    expect(options.readTextFileBounded).not.toHaveBeenCalled();
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it("rejects an oversized editor snapshot before reading disk", () => {
    const oversized = "x".repeat(MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES + 1);
    capture = editorCapture({ content: oversized });
    document = editorDocument({ content: oversized, savedContent: oversized });
    render();

    expect(latest.canRunCurrentFile()).toBe(false);
    expect(options.readTextFileBounded).not.toHaveBeenCalled();
  });

  it.each<[string, JsTestRunSelectionBoundedRead]>([
    ["missing", { status: "missing" }],
    ["too large", { status: "tooLarge" }],
    ["disk mismatch", { status: "ok", content: `${SOURCE}\n` }],
    [
      "dishonest oversized result",
      { status: "ok", content: "x".repeat(MAX_JS_TEST_RUN_SELECTION_SOURCE_BYTES + 1) },
    ],
  ])("fails closed for a %s disk read", async (_label, result) => {
    options = { ...options, readTextFileBounded: vi.fn(async () => result) };
    render();

    await act(async () => expect(await latest.runAtCursor()).toBe(false));
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it("admits only one flight across cursor and file commands", async () => {
    const disk = deferred<JsTestRunSelectionBoundedRead>();
    options = { ...options, readTextFileBounded: vi.fn(() => disk.promise) };
    render();

    let first!: Promise<boolean>;
    act(() => {
      first = latest.runAtCursor();
    });
    expect(latest.canRunAtCursor()).toBe(false);
    expect(latest.canRunCurrentFile()).toBe(false);
    await expect(latest.runCurrentFile()).resolves.toBe(false);
    disk.resolve({ status: "ok", content: SOURCE });
    await act(async () => expect(await first).toBe(true));
    expect(runner.runScope).toHaveBeenCalledOnce();
  });

  it.each(["activation", "root", "owner", "trust", "editor"] as const)(
    "fences a stale %s transition after the disk await",
    async (transition) => {
      const disk = deferred<JsTestRunSelectionBoundedRead>();
      options = { ...options, readTextFileBounded: vi.fn(() => disk.promise) };
      render();
      let running!: Promise<boolean>;
      act(() => {
        running = latest.runAtCursor();
      });

      if (transition === "activation") options = { ...options, activationEpoch: () => 8 };
      if (transition === "root") options = { ...options, workspaceRoot: "/replacement" };
      if (transition === "owner") options = { ...options, workspaceOwnerKey: "replacement" };
      if (transition === "trust") options = { ...options, isWorkspaceTrusted: () => false };
      if (transition === "editor") {
        capture = editorCapture({ modelIdentity: "replacement" });
      }
      render();
      disk.resolve({ status: "ok", content: SOURCE });

      await act(async () => expect(await running).toBe(false));
      expect(runner.runScope).not.toHaveBeenCalled();
    },
  );

  it("fences A-B-A editor capture sequences before the runner await", async () => {
    const replacement = editorCapture({ modelIdentity: "replacement" });
    let reads = 0;
    options = {
      ...options,
      captureReader: reader(() => {
        reads += 1;
        return reads === 5 ? replacement : capture;
      }),
    };
    render();

    await act(async () => expect(await latest.runAtCursor()).toBe(false));
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it.each(["root", "owner"] as const)("fences A-B-A %s capture sequences", async (field) => {
    const replacement = editorCapture(
      field === "root" ? { workspaceRoot: "/replacement" } : { workspaceOwnerKey: "replacement" },
    );
    const captures = [capture, replacement, capture];
    options = { ...options, captureReader: reader(() => captures.shift() ?? capture) };
    render();

    await act(async () => expect(await latest.runCurrentFile()).toBe(false));
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it.each(["activation", "trust"] as const)("fences A-B-A %s reads", async (field) => {
    if (field === "activation") {
      const epochs = [7, 8, 7];
      options = { ...options, activationEpoch: () => epochs.shift() ?? 7 };
    } else {
      const trust = [true, false, true];
      options = { ...options, isWorkspaceTrusted: () => trust.shift() ?? true };
    }
    render();

    await act(async () => expect(await latest.runAtCursor()).toBe(false));
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it("fences stale ownership after an accepted Explorer run", async () => {
    const accepted = deferred<boolean>();
    runner = scopeRunner({
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => true),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(() => accepted.promise),
    });
    options = { ...options, runner };
    render();
    let running!: Promise<boolean>;
    act(() => {
      running = latest.runCurrentFile();
    });
    await vi.waitFor(() => expect(runner.runScope).toHaveBeenCalledOnce());

    options = { ...options, activationEpoch: () => 9 };
    render();
    accepted.resolve(true);
    await act(async () => expect(await running).toBe(false));
  });

  it("fails closed for runner denial and synchronous or asynchronous failures", async () => {
    runner = scopeRunner({
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => false),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(async () => true),
    });
    options = { ...options, runner };
    render();
    expect(latest.canRunAtCursor()).toBe(false);
    await expect(latest.runAtCursor()).resolves.toBe(false);

    runner = scopeRunner({
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => true),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(() => {
        throw new Error("sync");
      }),
    });
    options = { ...options, runner };
    render();
    await act(async () => expect(await latest.runAtCursor()).toBe(false));

    runner = scopeRunner({
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => true),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(async () => Promise.reject(new Error("async"))),
    });
    options = { ...options, runner };
    render();
    await act(async () => expect(await latest.runAtCursor()).toBe(false));
  });

  it.each([
    [
      "synchronous disk failure",
      () => {
        throw new Error("sync");
      },
    ],
    ["asynchronous disk failure", async () => Promise.reject(new Error("async"))],
  ])("fails closed for %s", async (_label, read) => {
    options = { ...options, readTextFileBounded: read };
    render();

    await act(async () => expect(await latest.runAtCursor()).toBe(false));
    expect(runner.runScope).not.toHaveBeenCalled();
  });

  it("fails closed when capture, boundary, document, disk, or can-run readers throw", async () => {
    const throwing = () => {
      throw new Error("boom");
    };
    options = {
      ...options,
      activationEpoch: throwing,
      activeDocument: throwing,
      captureReader: reader(throwing),
      isWorkspaceCurrent: throwing,
      isWorkspaceTrusted: throwing,
      readTextFileBounded: throwing,
      runner: scopeRunner({
        canRerunLastRun: () => false,
        canRunScope: throwing,
        rerunLastRun: vi.fn(async () => false),
        runScope: vi.fn(async () => true),
      }),
    };
    render();

    expect(latest.canRunAtCursor()).toBe(false);
    await expect(latest.runCurrentFile()).resolves.toBe(false);
  });

  function render(): void {
    act(() => {
      reactRoot.render(<Harness options={options} onReady={(commands) => (latest = commands)} />);
    });
  }
});

function Harness({
  onReady,
  options,
}: {
  readonly onReady: (commands: JsTestRunSelectionCommands) => void;
  readonly options: UseJsTestRunSelectionCommandsOptions;
}) {
  onReady(useJsTestRunSelectionCommands(options));
  return null;
}

function scopeRunner(
  overrides: Partial<JsTestExplorerScopeRunnerPort> = {},
): JsTestExplorerScopeRunnerPort {
  return {
    canCancelTestRun: () => false,
    canRerunFailedTests: () => false,
    canRerunLastRun: () => false,
    canRunScope: () => true,
    cancelTestRun: async () => false,
    rerunFailedTests: async () => false,
    rerunLastRun: async () => false,
    runScope: async () => true,
    ...overrides,
  };
}

function reader(read: () => DebugWatchAtCursorCapture | null): DebugWatchAtCursorCaptureReader {
  return { readDebugWatchAtCursorCapture: read };
}

function editorCapture(
  overrides: Partial<DebugWatchAtCursorCapture> = {},
): DebugWatchAtCursorCapture {
  return {
    content: SOURCE,
    documentPath: FILE,
    modelIdentity: "model-1",
    modelVersion: 7,
    position: { column: 12, lineNumber: 2 },
    workspaceOwnerKey: "editor-owner",
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function editorDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: SOURCE,
    language: "typescript",
    name: "cart.test.ts",
    path: FILE,
    savedContent: SOURCE,
    ...overrides,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
