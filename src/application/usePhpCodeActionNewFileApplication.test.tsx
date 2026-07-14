// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileGateway } from "../domain/workspace";
import {
  usePhpCodeActionNewFileApplication,
  type PhpCodeActionNewFileApplicationDependencies,
} from "./usePhpCodeActionNewFileApplication";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const TARGET = "/workspace/app/Services/GreeterInterface.php";
const CONTENT = "<?php\n\ninterface GreeterInterface\n{\n}\n";

function workspaceFiles(): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(),
    createDirectory: vi.fn(),
    createTextFile: vi.fn(),
    deletePath: vi.fn(),
    readDirectory: vi.fn(),
    readTextFile: vi.fn(),
    renamePath: vi.fn(),
    writeTextFile: vi.fn(),
  };
}

function makeDeps(
  overrides: Partial<PhpCodeActionNewFileApplicationDependencies> = {},
): PhpCodeActionNewFileApplicationDependencies {
  return {
    workspaceRoot: ROOT,
    currentWorkspaceRootRef: { current: ROOT },
    workspaceFiles: workspaceFiles(),
    setExpandedDirectories: vi.fn(),
    notifyJavaScriptTypeScriptWatchedFilesChanged: vi.fn(async () => {}),
    openFile: vi.fn(async () => true),
    readTestFileIfExists: vi.fn(async () => null),
    refreshDirectory: vi.fn(async () => {}),
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    ...overrides,
  };
}

let mountedRoot: Root | null = null;

function renderHook(deps: PhpCodeActionNewFileApplicationDependencies) {
  const container = document.createElement("div");
  mountedRoot = createRoot(container);
  const captured: {
    applyPhpCodeActionNewFile: ((newFile: {
      content: string;
      path: string;
      title?: string;
    }) => Promise<boolean>) | null;
  } = {
    applyPhpCodeActionNewFile: null,
  };

  function Harness() {
    captured.applyPhpCodeActionNewFile =
      usePhpCodeActionNewFileApplication(deps);
    return null;
  }

  act(() => {
    mountedRoot?.render(<Harness />);
  });

  return () => {
    if (!captured.applyPhpCodeActionNewFile) {
      throw new Error("hook not mounted");
    }

    return captured.applyPhpCodeActionNewFile;
  };
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
  }
  mountedRoot = null;
  vi.clearAllMocks();
});

describe("usePhpCodeActionNewFileApplication", () => {
  it("writes a new PHP code-action file without creating its directory", async () => {
    const deps = makeDeps();
    const applyPhpCodeActionNewFile = renderHook(deps);

    let written: boolean | undefined;
    await act(async () => {
      written = await applyPhpCodeActionNewFile()({
        content: CONTENT,
        path: TARGET,
      });
    });

    expect(written).toBe(true);
    expect(deps.workspaceFiles.createDirectory).not.toHaveBeenCalled();
    expect(deps.workspaceFiles.createTextFile).toHaveBeenCalledWith(TARGET);
    expect(deps.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      TARGET,
      CONTENT,
    );
    expect(
      deps.notifyJavaScriptTypeScriptWatchedFilesChanged,
    ).toHaveBeenCalledWith([{ changeType: "created", path: TARGET }]);
    expect(deps.setExpandedDirectories).toHaveBeenCalledTimes(1);
    expect(deps.refreshDirectory).toHaveBeenCalledWith(
      "/workspace/app/Services",
    );
    expect(deps.openFile).toHaveBeenCalledWith({
      kind: "file",
      name: "GreeterInterface.php",
      path: TARGET,
    });
  });

  it("opens an existing target and returns false without writing", async () => {
    const deps = makeDeps({
      readTestFileIfExists: vi.fn(async () => CONTENT),
    });
    const applyPhpCodeActionNewFile = renderHook(deps);

    let written: boolean | undefined;
    await act(async () => {
      written = await applyPhpCodeActionNewFile()({
        content: CONTENT,
        path: TARGET,
      });
    });

    expect(written).toBe(false);
    expect(deps.workspaceFiles.createTextFile).not.toHaveBeenCalled();
    expect(deps.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(deps.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      "Extract Interface",
      expect.objectContaining({
        message:
          "GreeterInterface.php already exists - the class was left unchanged.",
      }),
    );
    expect(deps.openFile).toHaveBeenCalledWith({
      kind: "file",
      name: "GreeterInterface.php",
      path: TARGET,
    });
  });

  it("reports write failures and withholds the class edit", async () => {
    const error = new Error("disk full");
    const files = workspaceFiles();
    vi.mocked(files.writeTextFile).mockRejectedValueOnce(error);
    const deps = makeDeps({ workspaceFiles: files });
    const applyPhpCodeActionNewFile = renderHook(deps);

    let written: boolean | undefined;
    await act(async () => {
      written = await applyPhpCodeActionNewFile()({
        content: CONTENT,
        path: TARGET,
        title: "Create interface GreeterInterface",
      });
    });

    expect(written).toBe(false);
    expect(deps.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      "Create interface GreeterInterface",
      error,
    );
    expect(deps.openFile).not.toHaveBeenCalled();
    expect(
      deps.notifyJavaScriptTypeScriptWatchedFilesChanged,
    ).not.toHaveBeenCalled();
  });

  it("re-checks the root before notifying, refreshing, or opening", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const files = workspaceFiles();
    vi.mocked(files.writeTextFile).mockImplementationOnce(async () => {
      currentWorkspaceRootRef.current = OTHER_ROOT;
    });
    const deps = makeDeps({ currentWorkspaceRootRef, workspaceFiles: files });
    const applyPhpCodeActionNewFile = renderHook(deps);

    let written: boolean | undefined;
    await act(async () => {
      written = await applyPhpCodeActionNewFile()({
        content: CONTENT,
        path: TARGET,
      });
    });

    expect(written).toBe(true);
    expect(
      deps.notifyJavaScriptTypeScriptWatchedFilesChanged,
    ).not.toHaveBeenCalled();
    expect(deps.setExpandedDirectories).not.toHaveBeenCalled();
    expect(deps.refreshDirectory).not.toHaveBeenCalled();
    expect(deps.openFile).not.toHaveBeenCalled();
  });
});
