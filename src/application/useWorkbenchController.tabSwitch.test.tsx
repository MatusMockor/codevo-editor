// @vitest-environment jsdom

import {
  act,
  defaultAppSettings,
  DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  defaultWorkspaceSettings,
  describe,
  expect,
  fileEntry,
  flushAsyncTurns,
  it,
  setupRegisteredWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  type SettingsGateway,
  type WorkbenchCommitPhase,
  type WorkbenchController,
  type WorkspaceSettings,
  workspaceSettingsIdentity,
} from "./useWorkbenchController.preview/testSupport";

const ROOT = "/workspace";
const PATH_A = `${ROOT}/a.ts`;
const PATH_B = `${ROOT}/b.ts`;

const IDENTITY_STABLE_OUTPUT_KEYS = [
  "applyJavaScriptTypeScriptLanguageServerWorkspaceEdit",
  "clearLanguageServerDiagnosticsForPath",
  "clearNotices",
  "closeCallHierarchy",
  "closeImplementationChooser",
  "closeReferencesPanel",
  "closeTypeHierarchy",
  "flushPendingJavaScriptTypeScriptLanguageServerDocument",
  "focusNextEditorGroup",
  "focusPreviousEditorGroup",
  "moveActiveTabToNextGroup",
  "moveActiveTabToPreviousGroup",
  "openCallHierarchy",
  "openFileReferencesPanel",
  "openReferencesPanel",
  "openTypeHierarchy",
  "restoredEditorViewStates",
  "restoredEditorViewStatesByGroup",
  "sortedBookmarks",
] as const satisfies readonly (keyof WorkbenchController)[];

const UNRELATED_CHANGE_STABLE_OUTPUT_KEYS = [
  "activateSearchEverywhereItem",
  "applyPhpCodeActionNewFile",
  "closeWorkspaceTab",
  "goToImplementationAt",
  "goToNextBookmark",
  "goToNextProblem",
  "goToPreviousBookmark",
  "goToPreviousProblem",
  "goToSuperMethod",
  "navigateBackward",
  "navigateForwardInHistory",
  "openArtisanController",
  "openBookmark",
  "openClassSearchResult",
  "openDebugLocation",
  "openFile",
  "openImplementationTarget",
  "openNodePackageScript",
  "openPhpClassTarget",
  "openPhpFileOutlineNode",
  "openPhpTestCase",
  "openPhpTreeNode",
  "openPinnedFile",
  "openProblemNotice",
  "openReadOnlyDocument",
  "openRecentFile",
  "openRecentLocation",
  "openSearchResult",
  "openSymfonyService",
  "openWorkspaceFile",
  "openWorkspaceSymbolResult",
  "openWorkspaceTodo",
  "previewFile",
  "quitApplication",
  "renameEntry",
] as const satisfies readonly (keyof WorkbenchController)[];

describe("useWorkbenchController tab switch", () => {
  const { renderController } = setupRegisteredWorkbenchControllerTestHarness();

  it("commits the workbench at most once synchronously and once trailing per activation", async () => {
    const { getWorkbench, renders } = await openTwoTabs();

    getWorkbench().setActivePath(PATH_B);
    await settle();
    renders.length = 0;

    act(() => {
      getWorkbench().setActivePath(PATH_A);
    });
    const synchronousCommits = renders.length;
    await settle();
    const trailingCommits = renders.length - synchronousCommits;

    expect(getWorkbench().activePath).toBe(PATH_A);
    expect(synchronousCommits).toBeLessThanOrEqual(1);
    expect(trailingCommits).toBeLessThanOrEqual(1);
  });

  it("renders the workbench exactly once per warm activation and never re-enters the commit", async () => {
    const { commitPhases, getWorkbench } = await openTwoTabs();

    getWorkbench().setActivePath(PATH_B);
    await settle();
    commitPhases.length = 0;

    act(() => {
      getWorkbench().setActivePath(PATH_A);
    });
    const synchronousCommits = commitPhases.length;
    await settle();

    expect(getWorkbench().activePath).toBe(PATH_A);
    expect(commitPhases.filter((phase) => phase === "nested-update")).toEqual([]);
    expect(synchronousCommits).toBe(1);
    expect(commitPhases.length).toBeLessThanOrEqual(2);
  });

  it("never saves workspace settings synchronously during a burst of activations", async () => {
    const { getWorkbench, saveWorkspaceSettings } = await openTwoTabs();
    saveWorkspaceSettings.mockClear();

    act(() => {
      getWorkbench().setActivePath(PATH_B);
      getWorkbench().setActivePath(PATH_A);
      getWorkbench().setActivePath(PATH_B);
    });

    expect(saveWorkspaceSettings).not.toHaveBeenCalled();

    await flushAsyncTurns(20);

    expect(saveWorkspaceSettings).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(PATH_B);
  });

  it("still persists the activated tab once the debounced navigation save flushes", async () => {
    const { getWorkbench, saveWorkspaceSettings } = await openTwoTabs();
    saveWorkspaceSettings.mockClear();

    getWorkbench().setActivePath(PATH_B);
    await settle();
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });
    await settle();

    await waitForReact(() => {
      expect(saveWorkspaceSettings).toHaveBeenCalled();
    });
    const [identity, settings] = saveWorkspaceSettings.mock.lastCall ?? [];
    expect(identity).toEqual(workspaceSettingsIdentity(ROOT));
    expect(settings?.session.editor.groups[DEFAULT_WORKSPACE_EDITOR_GROUP_ID]?.activePath).toBe(
      PATH_B,
    );
  });

  it("keeps stable controller outputs identical across an A to B to A activation cycle", async () => {
    const { getWorkbench } = await openTwoTabs();

    getWorkbench().setActivePath(PATH_B);
    await settle();
    const before = getWorkbench();

    getWorkbench().setActivePath(PATH_A);
    await settle();
    getWorkbench().setActivePath(PATH_B);
    await settle();

    expect(changedOutputKeys(before, getWorkbench())).toEqual([]);
  });

  it("keeps stable controller outputs identical across an unrelated state change", async () => {
    const { getWorkbench } = await openTwoTabs();
    const before = getWorkbench();

    act(() => {
      getWorkbench().setQuickOpenQuery("unrelated");
    });
    await settle();

    expect(changedOutputKeys(before, getWorkbench())).toEqual([]);
    expect(getWorkbench().recentFilesSwitcherEntries).toBe(before.recentFilesSwitcherEntries);
  });

  it("keeps navigation and open-target outputs identical across an unrelated state change", async () => {
    const { getWorkbench } = await openTwoTabs();
    const before = getWorkbench();

    act(() => {
      getWorkbench().setQuickOpenQuery("unrelated");
    });
    await settle();

    const after = getWorkbench();
    expect(UNRELATED_CHANGE_STABLE_OUTPUT_KEYS.filter((key) => before[key] !== after[key])).toEqual(
      [],
    );
  });

  async function openTwoTabs() {
    const commitPhases: WorkbenchCommitPhase[] = [];
    const renders: WorkbenchController[] = [];
    const saveWorkspaceSettings = vi.fn(
      async (_identity: string, _settings: WorkspaceSettings) => undefined,
    );
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings,
    };
    const { getWorkbench } = renderController({
      onWorkbenchCommit: (phase) => {
        commitPhases.push(phase);
      },
      onWorkbenchRender: (workbench) => {
        renders.push(workbench);
      },
      readDirectory: async (path: string) =>
        path === ROOT ? [fileEntry(PATH_A, "a.ts"), fileEntry(PATH_B, "b.ts")] : [],
      settingsGateway,
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(ROOT);
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(PATH_A, "a.ts"), { pin: true });
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(PATH_B, "b.ts"), { pin: true });
    });
    await settle();
    await waitForReact(() => {
      expect(getWorkbench().openTabs.length).toBe(2);
    });

    return { commitPhases, getWorkbench, renders, saveWorkspaceSettings };
  }
});

async function settle(): Promise<void> {
  await flushAsyncTurns(30);
}

function changedOutputKeys(before: WorkbenchController, after: WorkbenchController): string[] {
  return IDENTITY_STABLE_OUTPUT_KEYS.filter((key) => before[key] !== after[key]);
}
