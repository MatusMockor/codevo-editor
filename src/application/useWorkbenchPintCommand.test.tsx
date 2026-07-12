// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { PintGateway } from "../infrastructure/tauriPintGateway";
import {
  useWorkbenchPintCommand,
  type WorkbenchPintActions,
  type WorkbenchPintCommandOptions,
} from "./useWorkbenchPintCommand";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

function editorDocument(path = `${ROOT}/app/Models/User.php`): EditorDocument {
  return {
    path,
    name: "User.php",
    content: "<?php",
    savedContent: "<?php",
    language: "php",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function makeOptions(
  overrides: Partial<WorkbenchPintCommandOptions> = {},
): WorkbenchPintCommandOptions {
  return {
    activeDocument: editorDocument(),
    currentWorkspaceRootRef: { current: ROOT },
    gateway: {
      format: vi.fn(async () => ({ status: "ok" as const, changedFiles: 2 })),
    },
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook(options: WorkbenchPintCommandOptions) {
  container = document.createElement("div");
  mountedRoot = createRoot(container);
  const captured: { actions: WorkbenchPintActions | null } = { actions: null };

  function Harness({ dependencies }: { dependencies: WorkbenchPintCommandOptions }) {
    captured.actions = useWorkbenchPintCommand(dependencies);
    return null;
  }

  act(() => {
    mountedRoot?.render(<Harness dependencies={options} />);
  });

  return {
    actions(): WorkbenchPintActions {
      if (!captured.actions) {
        throw new Error("hook not mounted");
      }
      return captured.actions;
    },
  };
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
  }
  mountedRoot = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

describe("useWorkbenchPintCommand", () => {
  it("formats changed files and reports the summary", async () => {
    const options = makeOptions();
    const hook = renderHook(options);

    await act(async () => hook.actions().formatChangedFiles());

    expect(options.gateway.format).toHaveBeenCalledWith(ROOT, null);
    expect(options.setMessage).toHaveBeenCalledWith("Pint formatted 2 files");
  });

  it("passes the workspace-relative active PHP path", async () => {
    const options = makeOptions({
      gateway: {
        format: vi.fn(async () => ({ status: "ok" as const, changedFiles: 0 })),
      },
    });
    const hook = renderHook(options);

    await act(async () => hook.actions().formatActiveFile());

    expect(options.gateway.format).toHaveBeenCalledWith(ROOT, "app/Models/User.php");
    expect(options.setMessage).toHaveBeenCalledWith("Pint made no changes");
  });

  it.each([
    ["outside the workspace", "/other/User.php"],
    ["when it is not PHP", `${ROOT}/README.md`],
  ])("rejects an active file %s", async (_label, path) => {
    const options = makeOptions({ activeDocument: editorDocument(path) });
    const hook = renderHook(options);

    await act(async () => hook.actions().formatActiveFile());

    expect(options.gateway.format).not.toHaveBeenCalled();
  });

  it("drops messaging after the workspace root becomes stale", async () => {
    const result = deferred<{ status: "ok"; changedFiles: number }>();
    const currentWorkspaceRootRef = { current: ROOT };
    const gateway: PintGateway = { format: vi.fn(() => result.promise) };
    const options = makeOptions({ currentWorkspaceRootRef, gateway });
    const hook = renderHook(options);

    let run!: Promise<void>;
    act(() => {
      run = hook.actions().formatChangedFiles();
    });
    currentWorkspaceRootRef.current = "/other";
    await act(async () => {
      result.resolve({ status: "ok", changedFiles: 1 });
      await run;
    });

    expect(options.setMessage).not.toHaveBeenCalled();
  });

  it("guards overlapping runs", async () => {
    const result = deferred<{ status: "ok"; changedFiles: number }>();
    const gateway: PintGateway = { format: vi.fn(() => result.promise) };
    const hook = renderHook(makeOptions({ gateway }));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.actions().formatChangedFiles();
      second = hook.actions().formatChangedFiles();
    });

    expect(gateway.format).toHaveBeenCalledOnce();
    await act(async () => {
      result.resolve({ status: "ok", changedFiles: 0 });
      await Promise.all([first, second]);
    });
  });
});
