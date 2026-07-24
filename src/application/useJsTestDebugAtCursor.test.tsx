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
  useJsTestDebugAtCursor,
  type JsTestDebugAtCursorCommands,
  type UseJsTestDebugAtCursorOptions,
} from "./useJsTestDebugAtCursor";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/cart.test.ts`;
const SOURCE = `describe("cart", () => {
  test.each([[1]])("charges %i", () => {
    expect(true).toBe(true);
  });
});`;

describe("useJsTestDebugAtCursor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let rootMounted: boolean;
  let latest: JsTestDebugAtCursorCommands;
  let capture: DebugWatchAtCursorCapture | null;
  let document: EditorDocument | null;
  let options: UseJsTestDebugAtCursorOptions;

  beforeEach(() => {
    host = documentElement();
    root = createRoot(host);
    rootMounted = true;
    capture = editorCapture();
    document = editorDocument();
    options = {
      activationEpoch: () => 1,
      activeDocument: () => document,
      captureReader: reader(() => capture),
      isDebugStartBlocked: () => false,
      isWorkspaceCurrent: (workspaceRoot, owner) =>
        workspaceRoot === ROOT && owner === "editor-owner",
      isWorkspaceTrusted: () => true,
      openDebugPanel: vi.fn(),
      readTextFileBounded: boundedReader(jestReader()),
      reportWarning: vi.fn(),
      startDebugAccepted: vi.fn(async () => true),
      workspaceId: "workspace-id",
    };
  });

  afterEach(() => {
    if (rootMounted) act(() => root.unmount());
    host.remove();
  });

  it("launches the exact parameterized Jest test without fabricating an explorer node", async () => {
    await render();
    expect(latest.canDebugAtCursor()).toBe(true);

    await act(async () => {
      expect(await latest.debugAtCursor()).toBe(true);
    });

    expect(options.startDebugAccepted).toHaveBeenCalledExactlyOnceWith({
      kind: "js-test-selection",
      runner: "jest",
      filePath: PATH,
      packageRootPath: ROOT,
      selection: {
        kind: "test",
        fullName: "cart charges",
        nameMatch: "prefix",
      },
    });
    expect(options.openDebugPanel).toHaveBeenCalledOnce();
  });

  it("transfers ownership to the nested Vitest package root", async () => {
    const nestedPath = `${ROOT}/packages/web/src/cart.test.ts`;
    capture = editorCapture({ documentPath: nestedPath });
    document = editorDocument({ path: nestedPath });
    options = {
      ...options,
      readTextFileBounded: boundedReader(
        async (path) =>
          path === `${ROOT}/packages/web/vitest.config.ts` ? "export default {}" : null,
        nestedPath,
      ),
    };
    await render();

    await act(async () => {
      expect(await latest.debugAtCursor()).toBe(true);
    });
    expect(options.startDebugAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        runner: "vitest",
        packageRootPath: `${ROOT}/packages/web`,
      }),
    );
  });

  it("accepts Windows root and document case aliases through centralized path identity", async () => {
    const windowsRoot = "C:\\Workspace";
    const windowsPath = "c:\\workspace\\src\\cart.test.ts";
    capture = editorCapture({ documentPath: windowsPath, workspaceRoot: windowsRoot });
    document = editorDocument({ path: "C:\\WORKSPACE\\src\\cart.test.ts" });
    await render({
      isWorkspaceCurrent: (rootPath, owner) =>
        rootPath === windowsRoot && owner === "editor-owner",
      readTextFileBounded: boundedReader(
        async (path) =>
          path === "C:/Workspace/package.json"
            ? JSON.stringify({ devDependencies: { jest: "1" } })
            : null,
        windowsPath,
      ),
    });

    expect(latest.canDebugAtCursor()).toBe(true);
    await act(async () => expect(await latest.debugAtCursor()).toBe(true));
    expect(options.startDebugAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "C:/Workspace/src/cart.test.ts" }),
    );
  });

  it("accepts UNC authority and share case aliases without weakening their boundary", async () => {
    const uncRoot = "\\\\SERVER\\Share\\Workspace";
    const uncPath = "\\\\server\\share\\workspace\\src\\cart.test.ts";
    capture = editorCapture({ documentPath: uncPath, workspaceRoot: uncRoot });
    document = editorDocument({ path: "file://SERVER/SHARE/WORKSPACE/src/cart.test.ts" });
    await render({
      isWorkspaceCurrent: (rootPath, owner) =>
        rootPath === uncRoot && owner === "editor-owner",
    });

    expect(latest.canDebugAtCursor()).toBe(true);
  });

  it.each([
    ["C:\\Workspace", "D:\\Workspace\\src\\cart.test.ts"],
    ["\\\\server\\share\\workspace", "\\\\other\\share\\workspace\\src\\cart.test.ts"],
    ["\\\\server\\share\\workspace", "\\\\server\\other\\workspace\\src\\cart.test.ts"],
  ])("rejects cross-root cursor capture %s -> %s", async (workspaceRoot, documentPath) => {
    capture = editorCapture({ documentPath, workspaceRoot });
    document = editorDocument({ path: documentPath });
    await render({ isWorkspaceCurrent: () => true });

    expect(latest.canDebugAtCursor()).toBe(false);
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("fails closed for trust, owner, dirty content, idle, and unsupported documents", async () => {
    await render({ isWorkspaceTrusted: () => false });
    expect(latest.canDebugAtCursor()).toBe(false);
    await render({ isWorkspaceTrusted: () => true, isWorkspaceCurrent: () => false });
    expect(latest.canDebugAtCursor()).toBe(false);
    await render({ isWorkspaceCurrent: () => true });
    document = editorDocument({ content: `${SOURCE}\n// dirty` });
    expect(latest.canDebugAtCursor()).toBe(false);
    document = editorDocument();
    await render({ isDebugStartBlocked: () => true });
    expect(latest.canDebugAtCursor()).toBe(false);
    await render({ isDebugStartBlocked: () => false });
    capture = editorCapture({ documentPath: `${ROOT}/src/cart.ts` });
    document = editorDocument({ path: `${ROOT}/src/cart.ts` });
    expect(latest.canDebugAtCursor()).toBe(false);

    await act(async () => {
      expect(await latest.debugAtCursor()).toBe(false);
    });
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("drops an async runner probe when any atomic capture field changes", async () => {
    const deferred = createDeferred<string | null>();
    options = {
      ...options,
      readTextFileBounded: boundedReader(async (path) =>
        path === `${ROOT}/package.json` ? deferred.promise : null,
      ),
    };
    await render();
    let pending!: Promise<boolean>;
    act(() => {
      pending = latest.debugAtCursor();
    });
    capture = editorCapture({ modelVersion: 8 });

    await act(async () => {
      deferred.resolve(JSON.stringify({ devDependencies: { jest: "1" } }));
      expect(await pending).toBe(false);
    });
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
    expect(options.openDebugPanel).not.toHaveBeenCalled();
  });

  it("rechecks the exact owner, trust, clean buffer, and debug idle state after detection", async () => {
    for (const invalidate of [
      () => (options = { ...options, isWorkspaceCurrent: () => false }),
      () => (options = { ...options, isWorkspaceTrusted: () => false }),
      () => (document = editorDocument({ content: `${SOURCE}\n// dirty` })),
      () => (options = { ...options, isDebugStartBlocked: () => true }),
    ]) {
      const deferred = createDeferred<string | null>();
      options = {
        ...baseOptions(options),
        readTextFileBounded: boundedReader(async (path) =>
          path === `${ROOT}/package.json` ? deferred.promise : null,
        ),
      };
      document = editorDocument();
      capture = editorCapture();
      await render();
      let pending!: Promise<boolean>;
      act(() => {
        pending = latest.debugAtCursor();
      });
      invalidate();
      await render(options);
      await act(async () => {
        deferred.resolve(JSON.stringify({ devDependencies: { jest: "1" } }));
        expect(await pending).toBe(false);
      });
    }
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("admits one request at a time and opens Debug only after start admission succeeds", async () => {
    const deferred = createDeferred<string | null>();
    options = {
      ...options,
      readTextFileBounded: boundedReader(async (path) =>
        path === `${ROOT}/package.json` ? deferred.promise : null,
      ),
      startDebugAccepted: vi.fn(async () => false),
    };
    await render();
    let first!: Promise<boolean>;
    await act(async () => {
      first = latest.debugAtCursor();
      expect(await latest.debugAtCursor()).toBe(false);
    });
    deferred.resolve(JSON.stringify({ devDependencies: { jest: "1" } }));
    await act(async () => expect(await first).toBe(false));

    expect(options.startDebugAccepted).toHaveBeenCalledTimes(1);
    expect(options.openDebugPanel).not.toHaveBeenCalled();
  });

  it("reports a stable launch failure without exposing the raw cause", async () => {
    await render({
      startDebugAccepted: vi.fn(async () => {
        throw new Error("/secret/token\nprocess output");
      }),
    });
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(options.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Debug Test at Cursor failed.",
    );
  });

  it("keeps an accepted start successful after cursor drift and the resulting active session", async () => {
    const accepted = createDeferred<boolean>();
    await render({ startDebugAccepted: vi.fn(() => accepted.promise) });
    const pending = latest.debugAtCursor();
    await vi.waitFor(() => expect(options.startDebugAccepted).toHaveBeenCalledOnce());
    capture = editorCapture({ position: { column: 1, lineNumber: 2 } });
    options = { ...options, isDebugStartBlocked: () => true };
    await render(options);
    accepted.resolve(true);

    await act(async () => expect(await pending).toBe(true));
    expect(options.openDebugPanel).toHaveBeenCalledOnce();
  });

  it("fences an accepted start when the editor activation epoch changes A to B to A", async () => {
    let epoch = 1;
    const accepted = createDeferred<boolean>();
    await render({
      activationEpoch: () => epoch,
      startDebugAccepted: vi.fn(() => accepted.promise),
    });
    const pending = latest.debugAtCursor();
    await vi.waitFor(() => expect(options.startDebugAccepted).toHaveBeenCalledOnce());
    epoch = 2;
    epoch = 3;
    accepted.resolve(true);

    await act(async () => expect(await pending).toBe(false));
    expect(options.openDebugPanel).not.toHaveBeenCalled();
  });

  it("requires a bounded exact disk snapshot before launch and catches read failures", async () => {
    const mismatch = vi.fn(
      boundedReader(jestReader(), PATH, `${SOURCE}\n// changed on disk`),
    );
    await render({ readTextFileBounded: mismatch });
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
    expect(mismatch).toHaveBeenCalledWith(PATH, 512 * 1024);

    await render({
      readTextFileBounded: async () => {
        throw new Error("read failed");
      },
    });
    expect(latest.canDebugAtCursor()).toBe(true);
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("caps runner probe count and bytes on deeply nested files", async () => {
    const segments = Array.from({ length: 100 }, (_, index) => `p${index}`).join("/");
    const deepPath = `${ROOT}/${segments}/cart.test.ts`;
    capture = editorCapture({ documentPath: deepPath });
    document = editorDocument({ path: deepPath });
    const bounded = vi.fn(async (_path: string, _maxBytes: number) => ({
      status: "missing" as const,
    }));
    await render({ readTextFileBounded: bounded });

    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(bounded.mock.calls.length).toBeLessThanOrEqual(256);
    expect(bounded.mock.calls.every(([, maxBytes]) => maxBytes === 64 * 1024)).toBe(true);
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("enforces an aggregate runner byte budget and distrusts oversized ok responses", async () => {
    const segments = Array.from({ length: 100 }, (_, index) => `p${index}`).join("/");
    const deepPath = `${ROOT}/${segments}/cart.test.ts`;
    capture = editorCapture({ documentPath: deepPath });
    document = editorDocument({ path: deepPath });
    let transferredRunnerBytes = 0;
    const bounded = vi.fn(async (path: string, maxBytes: number) => {
      if (path === deepPath) return { status: "ok" as const, content: SOURCE };
      if (path.endsWith("/package.json")) {
        transferredRunnerBytes += maxBytes;
        return { status: "ok" as const, content: " ".repeat(maxBytes) };
      }
      return { status: "missing" as const };
    });
    await render({ readTextFileBounded: bounded });
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(transferredRunnerBytes).toBeLessThanOrEqual(2 * 1024 * 1024);

    const lying = vi.fn(async (_path: string, maxBytes: number) => ({
      status: "ok" as const,
      content: "x".repeat(maxBytes + 1),
    }));
    capture = editorCapture();
    document = editorDocument();
    await render({ readTextFileBounded: lying });
    await act(async () => expect(await latest.debugAtCursor()).toBe(false));
    expect(options.startDebugAccepted).not.toHaveBeenCalled();
  });

  it("retires a stale request so a new workspace owner can start immediately", async () => {
    const oldProbe = createDeferred<string | null>();
    await render({
      readTextFileBounded: boundedReader(async (path) =>
        path === `${ROOT}/package.json` ? oldProbe.promise : null,
      ),
    });
    const oldRequest = latest.debugAtCursor();

    const nextRoot = "/workspace-next";
    const nextPath = `${nextRoot}/src/cart.test.ts`;
    capture = editorCapture({
      documentPath: nextPath,
      workspaceOwnerKey: "next-owner",
      workspaceRoot: nextRoot,
    });
    document = editorDocument({ path: nextPath });
    await render({
      isWorkspaceCurrent: (rootPath, owner) =>
        rootPath === nextRoot && owner === "next-owner",
      readTextFileBounded: boundedReader(
        async (path) =>
          path === `${nextRoot}/package.json`
            ? JSON.stringify({ devDependencies: { jest: "1" } })
            : null,
        nextPath,
      ),
      workspaceId: "workspace-next-id",
    });

    await act(async () => expect(await latest.debugAtCursor()).toBe(true));
    oldProbe.resolve(JSON.stringify({ devDependencies: { jest: "1" } }));
    await act(async () => expect(await oldRequest).toBe(false));
    expect(options.startDebugAccepted).toHaveBeenCalledTimes(1);
  });

  it("invalidates an unmounted request", async () => {

    const deferred = createDeferred<string | null>();
    await render({
      readTextFileBounded: boundedReader(async (path) =>
        path === `${ROOT}/package.json` ? deferred.promise : null,
      ),
      startDebugAccepted: vi.fn(async () => true),
    });
    const pending = latest.debugAtCursor();
    act(() => root.unmount());
    rootMounted = false;
    deferred.resolve(JSON.stringify({ devDependencies: { jest: "1" } }));
    expect(await pending).toBe(false);
  });

  async function render(overrides: Partial<UseJsTestDebugAtCursorOptions> = {}) {
    options = { ...options, ...overrides };
    await act(async () => {
      root.render(
        <Harness
          onReady={(commands) => {
            latest = commands;
          }}
          options={options}
        />,
      );
    });
  }
});

function Harness({
  onReady,
  options,
}: {
  readonly onReady: (commands: JsTestDebugAtCursorCommands) => void;
  readonly options: UseJsTestDebugAtCursorOptions;
}) {
  onReady(useJsTestDebugAtCursor(options));
  return null;
}

function editorCapture(
  overrides: Partial<DebugWatchAtCursorCapture> = {},
): DebugWatchAtCursorCapture {
  return {
    content: SOURCE,
    documentPath: PATH,
    modelIdentity: "model-1",
    modelVersion: 7,
    position: { column: 10, lineNumber: 3 },
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
    path: PATH,
    savedContent: SOURCE,
    ...overrides,
  };
}

function reader(
  read: () => DebugWatchAtCursorCapture | null,
): DebugWatchAtCursorCaptureReader {
  return { readDebugWatchAtCursorCapture: read };
}

function jestReader() {
  return async (path: string): Promise<string | null> =>
    path === `${ROOT}/package.json`
      ? JSON.stringify({ devDependencies: { jest: "1" } })
      : null;
}

function boundedReader(
  readFileIfExists: (path: string) => Promise<string | null>,
  diskPath = PATH,
  diskContent = SOURCE,
): UseJsTestDebugAtCursorOptions["readTextFileBounded"] {
  return async (path, maxBytes) => {
    const content = path === diskPath ? diskContent : await readFileIfExists(path);
    if (content === null) return { status: "missing" };
    return new TextEncoder().encode(content).byteLength <= maxBytes
      ? { status: "ok", content }
      : { status: "tooLarge" };
  };
}

function baseOptions(
  options: UseJsTestDebugAtCursorOptions,
): UseJsTestDebugAtCursorOptions {
  return {
    ...options,
    isDebugStartBlocked: () => false,
    isWorkspaceCurrent: (root, owner) => root === ROOT && owner === "editor-owner",
    isWorkspaceTrusted: () => true,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function documentElement(): HTMLDivElement {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  return host;
}
