// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "../components/FileTree";
import type { SearchEverywhereActionItem } from "../domain/searchEverywhere";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import type { CommandContext } from "./commandRegistry";
import {
  useWorkbenchNavigation,
  type WorkbenchNavigation,
  type WorkbenchNavigationDependencies,
} from "./useWorkbenchNavigation";

const ROOT = "/workspace";
const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

function workspaceFiles(): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
}

function renderNavigation(
  overrides: Partial<WorkbenchNavigationDependencies> = {},
) {
  const openFile = vi.fn(async () => true);
  const deps: WorkbenchNavigationDependencies = {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
    commandContextRef: { current: commandContext },
    currentNavigationLocation: () => null,
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef: { current: {} },
    forgetRecentFile: vi.fn(),
    noticesRef: { current: [] },
    openFile,
    recordNavigationLocationSnapshot: vi.fn(),
    reportError: vi.fn(),
    setClassOpenOpen: vi.fn(),
    setEditorRevealTarget: vi.fn(),
    setMessage: vi.fn(),
    setQuickOpenOpen: vi.fn(),
    setRecentFilesSwitcherOpen: vi.fn(),
    setSearchEverywhereOpen: vi.fn(),
    setWorkspaceSymbolsOpen: vi.fn(),
    workspaceFiles: workspaceFiles(),
    ...overrides,
  };
  let api: WorkbenchNavigation | null = null;
  const host = document.createElement("div");
  const root = createRoot(host);

  function Harness() {
    api = useWorkbenchNavigation(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return { api: () => api as WorkbenchNavigation, deps, host, openFile, root };
}

function actionItem(
  run: SearchEverywhereActionItem["command"]["run"],
  isEnabled: SearchEverywhereActionItem["command"]["isEnabled"] = () => true,
  commandId = "test.action",
): SearchEverywhereActionItem {
  return {
    id: `action:0:${commandId}`,
    kind: "action",
    label: "Test Action",
    detail: "Test",
    shortcut: null,
    command: {
      id: commandId,
      title: "Test Action",
      category: "Test",
      isEnabled,
      run,
    },
  };
}

describe("useWorkbenchNavigation Search Everywhere actions", () => {
  it("closes first, invokes once, and waits for command completion", async () => {
    const events: string[] = [];
    let resolveRun: (() => void) | undefined;
    const setSearchEverywhereOpen = vi.fn(() => {
      events.push("closed");
    });
    const harness = renderNavigation({ setSearchEverywhereOpen });
    const run = vi.fn(() => {
      events.push("run");
      return new Promise<void>((resolve) => {
        resolveRun = resolve;
      });
    });
    let activationSettled = false;

    await act(async () => {
      const activation = harness
        .api()
        .activateSearchEverywhereItem(actionItem(run));
      void activation.then(() => {
        activationSettled = true;
      });
      await Promise.resolve();

      expect(events).toEqual(["closed", "run"]);
      expect(run).toHaveBeenCalledTimes(1);
      expect(activationSettled).toBe(false);

      resolveRun?.();
      await activation;
    });

    expect(activationSettled).toBe(true);
    harness.root.unmount();
  });

  it("ignores a reopened duplicate while pending but allows another command", async () => {
    let resolveRun: (() => void) | undefined;
    const harness = renderNavigation();
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const otherRun = vi.fn();
    const item = actionItem(run);

    await act(async () => {
      const firstActivation = harness.api().activateSearchEverywhereItem(item);
      harness.deps.setSearchEverywhereOpen(true);
      const duplicateActivation = harness
        .api()
        .activateSearchEverywhereItem(item);
      const otherActivation = harness
        .api()
        .activateSearchEverywhereItem(
          actionItem(otherRun, () => true, "test.other-action"),
        );

      await duplicateActivation;
      await otherActivation;

      expect(run).toHaveBeenCalledTimes(1);
      expect(otherRun).toHaveBeenCalledTimes(1);
      expect(harness.deps.setSearchEverywhereOpen).toHaveBeenLastCalledWith(
        false,
      );

      resolveRun?.();
      await firstActivation;
    });

    expect(run).toHaveBeenCalledTimes(1);
    harness.root.unmount();
  });

  it("releases the pending command gate after rejection", async () => {
    let rejectRun: ((error: Error) => void) | undefined;
    const harness = renderNavigation();
    const run = vi
      .fn<SearchEverywhereActionItem["command"]["run"]>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectRun = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const item = actionItem(run);

    await act(async () => {
      const firstActivation = harness.api().activateSearchEverywhereItem(item);
      await harness.api().activateSearchEverywhereItem(item);

      expect(run).toHaveBeenCalledTimes(1);

      rejectRun?.(new Error("command failed"));
      await firstActivation;
      await harness.api().activateSearchEverywhereItem(item);
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(harness.deps.reportError).toHaveBeenCalledTimes(1);
    harness.root.unmount();
  });

  it("rechecks the current context and does not fall back when disabled", async () => {
    const harness = renderNavigation();
    const run = vi.fn();
    const isEnabled = vi.fn(
      (currentContext: CommandContext) => currentContext.hasActiveDocument,
    );
    harness.deps.commandContextRef.current = {
      ...commandContext,
      hasActiveDocument: false,
    };

    await act(async () => {
      await harness
        .api()
        .activateSearchEverywhereItem(actionItem(run, isEnabled));
    });

    expect(isEnabled).toHaveBeenCalledWith(
      harness.deps.commandContextRef.current,
    );
    expect(run).not.toHaveBeenCalled();
    expect(harness.deps.reportError).not.toHaveBeenCalled();
    expect(harness.deps.setSearchEverywhereOpen).toHaveBeenCalledWith(false);
    harness.root.unmount();
  });

  it.each([
    [
      "synchronous",
      () => {
        throw new Error("sync failure");
      },
    ],
    [
      "asynchronous",
      async () => {
        throw new Error("async failure");
      },
    ],
  ])("reports %s command rejection", async (_label, run) => {
    const harness = renderNavigation();

    await act(async () => {
      await harness.api().activateSearchEverywhereItem(actionItem(run));
    });

    expect(harness.deps.reportError).toHaveBeenCalledTimes(1);
    expect(harness.deps.reportError).toHaveBeenCalledWith(
      "Command",
      expect.any(Error),
    );
    harness.root.unmount();
  });
});

describe("useWorkbenchNavigation PHP read-only boundary", () => {
  it("rejects a filesystem read when its cooperative signal aborts", async () => {
    const read = deferred<string>();
    const readTextFile = vi.fn(() => read.promise);
    const files = workspaceFiles();
    files.readTextFile = readTextFile;
    const harness = renderNavigation({ workspaceFiles: files });
    const abortController = new AbortController();
    const pending = harness
      .api()
      .readNavigationFileContent(
        `${ROOT}/app/Services/Service.php`,
        abortController.signal,
      );

    await vi.waitFor(() => expect(readTextFile).toHaveBeenCalledOnce());
    abortController.abort();
    read.resolve("<?php");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    harness.root.unmount();
  });

  it("does not commit reveal, history, or message after a navigation owner replacement", async () => {
    let resolveOpen: ((opened: boolean) => void) | undefined;
    let requestActive = true;
    const openFile = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const recordNavigationLocationSnapshot = vi.fn();
    const setEditorRevealTarget = vi.fn();
    const setMessage = vi.fn();
    const harness = renderNavigation({
      openFile,
      recordNavigationLocationSnapshot,
      setEditorRevealTarget,
      setMessage,
    });
    const path = `${ROOT}/app/Services/Service.php`;
    const navigation = harness
      .api()
      .openNavigationTarget(
        path,
        { column: 3, lineNumber: 4 },
        "Service",
        {},
        { canNavigate: () => requestActive },
      );

    await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce());
    const options = (openFile.mock.calls[0] as unknown[])[1] as {
      shouldCommit?: () => boolean;
    };
    expect(options?.shouldCommit?.()).toBe(true);

    requestActive = false;
    expect(options?.shouldCommit?.()).toBe(false);
    resolveOpen?.(true);

    await expect(navigation).resolves.toBe(false);
    expect(recordNavigationLocationSnapshot).not.toHaveBeenCalled();
    expect(setEditorRevealTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
    harness.root.unmount();
  });

  it.each(["contextual definition", "indexed fallback"])(
    "forces a vendor target from %s read-only",
    async (label) => {
      const harness = renderNavigation();
      const path = `${ROOT}/vendor/acme/package/src/Service.php`;

      await act(async () => {
        await harness
          .api()
          .openNavigationTarget(path, { column: 3, lineNumber: 4 }, label);
      });

      expect(harness.openFile).toHaveBeenCalledWith(
        { kind: "file", name: "Service.php", path },
        { readOnly: true, recordNavigation: false },
      );

      harness.root.unmount();
    },
  );

  it("keeps an in-app contextual target editable", async () => {
    const harness = renderNavigation();
    const path = `${ROOT}/app/Services/Service.php`;

    await act(async () => {
      await harness
        .api()
        .openNavigationTarget(
          path,
          { column: 3, lineNumber: 4 },
          "contextual definition",
        );
    });

    expect(harness.openFile).toHaveBeenCalledWith(
      { kind: "file", name: "Service.php", path },
      { readOnly: undefined, recordNavigation: false },
    );

    harness.root.unmount();
  });

  it("preserves caller-provided read-only navigation", async () => {
    const harness = renderNavigation();
    const path = `${ROOT}/app/Services/Service.php`;

    await act(async () => {
      await harness.api().openPathForNavigation(path, { readOnly: true });
    });

    expect(harness.openFile).toHaveBeenCalledWith(
      { kind: "file", name: "Service.php", path },
      { readOnly: true, recordNavigation: false },
    );

    harness.root.unmount();
  });

  it("passes navigation transaction validity to the file commit guard", async () => {
    const harness = renderNavigation();
    const path = `${ROOT}/app/Services/Service.php`;
    const shouldCommit = vi.fn(() => true);

    await act(async () => {
      await harness.api().openPathForNavigation(path, { shouldCommit });
    });

    expect(harness.openFile).toHaveBeenCalledWith(
      { kind: "file", name: "Service.php", path },
      { readOnly: undefined, recordNavigation: false, shouldCommit },
    );

    harness.root.unmount();
  });

  it("keeps explicit quick-open and explorer-style vendor opens editable", async () => {
    const harness = renderNavigation();
    const entry: FileEntry = {
      kind: "file",
      name: "Service.php",
      path: `${ROOT}/vendor/acme/package/src/Service.php`,
    };

    await act(async () => {
      await harness.api().openSearchResult({
        name: entry.name,
        path: entry.path,
        relativePath: "vendor/acme/package/src/Service.php",
      });
      harness.root.render(
        <FileTree
          activePath={null}
          entriesByDirectory={{ [ROOT]: [entry] }}
          expandedDirectories={new Set()}
          loadingDirectories={new Set()}
          onOpenFile={(file) => void harness.deps.openFile(file)}
          onPreviewFile={vi.fn()}
          onToggleDirectory={vi.fn()}
          revealActivePath={false}
          revealActivePathSignal={0}
          rootPath={ROOT}
        />,
      );
    });

    const row = harness.host.querySelector<HTMLButtonElement>(
      `[title="${entry.path}"]`,
    );

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });

    expect(harness.openFile).toHaveBeenNthCalledWith(1, entry);
    expect(harness.openFile).toHaveBeenNthCalledWith(2, entry);

    harness.root.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
