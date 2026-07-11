// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "../components/FileTree";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import {
  useWorkbenchNavigation,
  type WorkbenchNavigation,
  type WorkbenchNavigationDependencies,
} from "./useWorkbenchNavigation";

const ROOT = "/workspace";

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

function renderNavigation() {
  const openFile = vi.fn(async () => true);
  const deps: WorkbenchNavigationDependencies = {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
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

describe("useWorkbenchNavigation PHP read-only boundary", () => {
  it.each(["contextual definition", "indexed fallback"])(
    "forces a vendor target from %s read-only",
    async (label) => {
      const harness = renderNavigation();
      const path = `${ROOT}/vendor/acme/package/src/Service.php`;

      await act(async () => {
        await harness.api().openNavigationTarget(
          path,
          { column: 3, lineNumber: 4 },
          label,
        );
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
      await harness.api().openNavigationTarget(
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
