// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
  WorkspaceWriteResult,
} from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
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

function workspaceOwnerFiles(): WorkspaceOwnerFileGateway {
  return {
    createDirectoryForWorkspace: vi.fn(),
    createTextFileWithContentForWorkspace: vi.fn(async () => ({
      revision: null,
      status: "success" as const,
    })),
    writeTextFileForWorkspace: vi.fn(async () => ({
      revision: null,
      status: "success" as const,
    })),
  };
}

function workspaceIdentity(workspaceId: string): WorkspaceIdentityDescriptor {
  return {
    admissionToken: 7,
    canonicalRoot: ROOT,
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath: ROOT,
    unicodeNormalizationPolicy: "preserved",
    workspaceId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function makeDeps(
  overrides: Partial<PhpCodeActionNewFileApplicationDependencies> = {},
): PhpCodeActionNewFileApplicationDependencies {
  return {
    workspaceRoot: ROOT,
    currentWorkspaceRootRef: { current: ROOT },
    workspaceFiles: workspaceFiles(),
    workspaceIdentityDescriptorRef: { current: null },
    workspaceOwnerFiles: workspaceOwnerFiles(),
    workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => null } },
    workspaceRuntimeOwnerRef: { current: null },
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
    applyPhpCodeActionNewFile:
      ((newFile: { content: string; path: string; title?: string }) => Promise<boolean>) | null;
  } = {
    applyPhpCodeActionNewFile: null,
  };

  function Harness() {
    captured.applyPhpCodeActionNewFile = usePhpCodeActionNewFileApplication(deps);
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
    expect(deps.workspaceFiles.writeTextFile).toHaveBeenCalledWith(TARGET, CONTENT);
    expect(deps.notifyJavaScriptTypeScriptWatchedFilesChanged).toHaveBeenCalledWith([
      { changeType: "created", path: TARGET },
    ]);
    expect(deps.setExpandedDirectories).toHaveBeenCalledTimes(1);
    expect(deps.refreshDirectory).toHaveBeenCalledWith("/workspace/app/Services");
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
        message: "GreeterInterface.php already exists - the class was left unchanged.",
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
    expect(deps.notifyJavaScriptTypeScriptWatchedFilesChanged).not.toHaveBeenCalled();
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

    expect(written).toBe(false);
    expect(deps.notifyJavaScriptTypeScriptWatchedFilesChanged).not.toHaveBeenCalled();
    expect(deps.setExpandedDirectories).not.toHaveBeenCalled();
    expect(deps.refreshDirectory).not.toHaveBeenCalled();
    expect(deps.openFile).not.toHaveBeenCalled();
  });

  it("writes registered workspace files through the retained owner gateway", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const identity = workspaceIdentity("workspace-a");
    const ownerFiles = workspaceOwnerFiles();
    const files = workspaceFiles();
    const deps = makeDeps({
      workspaceFiles: files,
      workspaceIdentityDescriptorRef: { current: identity },
      workspaceOwnerFiles: ownerFiles,
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    });
    const applyPhpCodeActionNewFile = renderHook(deps);

    await act(async () => {
      await applyPhpCodeActionNewFile()({ content: CONTENT, path: TARGET });
    });

    expect(ownerFiles.createTextFileWithContentForWorkspace).toHaveBeenCalledWith(
      "workspace-a",
      TARGET,
      CONTENT,
    );
    expect(files.createTextFile).not.toHaveBeenCalled();
    expect(files.writeTextFile).not.toHaveBeenCalled();
  });

  it.each<Exclude<WorkspaceWriteResult, { status: "success" }>>([
    { message: "revision conflict", status: "conflict" },
    { message: "partial write", revision: null, status: "partial" },
    { message: "owner write failed", status: "error" },
  ])("withholds registered publications after an owner $status result", async (writeResult) => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const identity = workspaceIdentity("workspace-a");
    const ownerFiles = workspaceOwnerFiles();
    vi.mocked(ownerFiles.createTextFileWithContentForWorkspace).mockResolvedValueOnce(writeResult);
    const deps = makeDeps({
      workspaceIdentityDescriptorRef: { current: identity },
      workspaceOwnerFiles: ownerFiles,
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    });
    const applyPhpCodeActionNewFile = renderHook(deps);

    let result = true;
    await act(async () => {
      result = await applyPhpCodeActionNewFile()({ content: CONTENT, path: TARGET });
    });

    expect(result).toBe(false);
    expect(deps.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      "Extract Interface",
      expect.objectContaining({ message: writeResult.message }),
    );
    expect(deps.notifyJavaScriptTypeScriptWatchedFilesChanged).not.toHaveBeenCalled();
    expect(deps.setExpandedDirectories).not.toHaveBeenCalled();
    expect(deps.refreshDirectory).not.toHaveBeenCalled();
    expect(deps.openFile).not.toHaveBeenCalled();
  });

  it("withholds publications after a same-root owner replacement during the write", async () => {
    const ownerA = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const ownerB = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    const identityRef = { current: workspaceIdentity("workspace-a") };
    const ownerRef = { current: ownerA };
    const generations = new Map([
      ["workspace-a", 4],
      ["workspace-b", 5],
    ]);
    let resolveWrite!: (result: { revision: null; status: "success" }) => void;
    const write = new Promise<{ revision: null; status: "success" }>((resolve) => {
      resolveWrite = resolve;
    });
    const ownerFiles = workspaceOwnerFiles();
    vi.mocked(ownerFiles.createTextFileWithContentForWorkspace).mockImplementation(() => write);
    const deps = makeDeps({
      workspaceIdentityDescriptorRef: identityRef,
      workspaceOwnerFiles: ownerFiles,
      workspaceRuntimeOwnerClaimsRef: {
        current: { generationFor: (ownerKey) => generations.get(ownerKey) },
      },
      workspaceRuntimeOwnerRef: ownerRef,
    });
    const applyPhpCodeActionNewFile = renderHook(deps);
    let result = true;
    let pending = Promise.resolve(false);
    act(() => {
      pending = applyPhpCodeActionNewFile()({ content: CONTENT, path: TARGET });
    });
    await act(async () => {
      await Promise.resolve();
    });

    identityRef.current = workspaceIdentity("workspace-b");
    ownerRef.current = ownerB;
    resolveWrite({ revision: null, status: "success" });
    await act(async () => {
      result = await pending;
    });

    expect(result).toBe(false);
    expect(deps.notifyJavaScriptTypeScriptWatchedFilesChanged).not.toHaveBeenCalled();
    expect(deps.refreshDirectory).not.toHaveBeenCalled();
    expect(deps.openFile).not.toHaveBeenCalled();
  });

  it.each(["notify", "open"] as const)(
    "withholds the paired edit after an A to B to A replacement during %s",
    async (pendingStage) => {
      const ownerA = createWorkspaceRuntimeOwner("workspace-a", ROOT);
      const ownerB = createWorkspaceRuntimeOwner("workspace-b", ROOT);
      const replacementA = createWorkspaceRuntimeOwner("workspace-a", ROOT);
      const identityRef = { current: workspaceIdentity("workspace-a") };
      const ownerRef = { current: ownerA };
      let ownerGeneration = 4;
      const stage = deferred<void>();
      const deps = makeDeps({
        notifyJavaScriptTypeScriptWatchedFilesChanged:
          pendingStage === "notify" ? vi.fn(() => stage.promise) : vi.fn(async () => {}),
        openFile:
          pendingStage === "open"
            ? vi.fn(() => stage.promise.then(() => true))
            : vi.fn(async () => true),
        workspaceIdentityDescriptorRef: identityRef,
        workspaceOwnerFiles: workspaceOwnerFiles(),
        workspaceRuntimeOwnerClaimsRef: {
          current: { generationFor: () => ownerGeneration },
        },
        workspaceRuntimeOwnerRef: ownerRef,
      });
      const applyPhpCodeActionNewFile = renderHook(deps);
      let pending = Promise.resolve(false);
      act(() => {
        pending = applyPhpCodeActionNewFile()({ content: CONTENT, path: TARGET });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      ownerRef.current = ownerB;
      identityRef.current = workspaceIdentity("workspace-b");
      ownerGeneration = 5;
      ownerRef.current = replacementA;
      identityRef.current = workspaceIdentity("workspace-a");
      ownerGeneration = 6;
      stage.resolve();
      let result = true;
      await act(async () => {
        result = await pending;
      });

      expect(result).toBe(false);
    },
  );

  it("fails closed when a registered owner exists without its identity descriptor", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const files = workspaceFiles();
    const ownerFiles = workspaceOwnerFiles();
    const deps = makeDeps({
      workspaceFiles: files,
      workspaceIdentityDescriptorRef: { current: null },
      workspaceOwnerFiles: ownerFiles,
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    });
    const applyPhpCodeActionNewFile = renderHook(deps);

    let result = true;
    await act(async () => {
      result = await applyPhpCodeActionNewFile()({ content: CONTENT, path: TARGET });
    });

    expect(result).toBe(false);
    expect(files.createTextFile).not.toHaveBeenCalled();
    expect(files.writeTextFile).not.toHaveBeenCalled();
    expect(ownerFiles.createTextFileWithContentForWorkspace).not.toHaveBeenCalled();
  });
});
