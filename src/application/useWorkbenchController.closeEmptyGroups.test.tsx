// @vitest-environment jsdom

import {
  act,
  defaultAppSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  fileEntry,
  fileHistoryGitGateway,
  flushAsyncTurns,
  gitChangedFile,
  it,
  type LanguageServerRuntimeStatus,
  setupWorkbenchControllerTestHarness,
  vi,
  workspaceSettingsRoot,
} from "./useWorkbenchController.preview/testSupport";

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";
const GREET = fileEntry(`${ROOT_A}/src/greet.ts`, "greet.ts");
const ORDERS = fileEntry(`${ROOT_A}/src/orders.ts`, "orders.ts");
const OTHER = fileEntry(`${ROOT_B}/src/other.ts`, "other.ts");

describe("useWorkbenchController closing empty editor groups", () => {
  const { renderRegisteredController: renderController } = setupWorkbenchControllerTestHarness();

  function render() {
    return renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: ROOT_A,
        workspaceTabs: [ROOT_A, ROOT_B],
      },
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
  }

  it("closes a side group with its last tab, focuses the neighbour and persists one group", async () => {
    const { dependencies, getWorkbench } = render();
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(GREET);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const sideGroupId = getWorkbench().editorGroups.activeGroupId;
    await act(async () => {
      await getWorkbench().openPinnedFile(ORDERS);
    });
    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main", sideGroupId]);

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(sideGroupId, ORDERS.path);
    });
    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main", sideGroupId]);
    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(sideGroupId, GREET.path);
    });

    const groups = getWorkbench().editorGroups;
    expect(Object.keys(groups.groups)).toEqual(["editor-main"]);
    expect(groups.layout).toEqual({ kind: "group", groupId: "editor-main" });
    expect(groups.activeGroupId).toBe("editor-main");
    expect(getWorkbench().activePath).toBe(GREET.path);

    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(ROOT_B);
    });
    await flushAsyncTurns(24);

    const savedSessions = vi
      .mocked(dependencies.settingsGateway.saveWorkspaceSettings)
      .mock.calls.flatMap(([identity, settings]) =>
        workspaceSettingsRoot(identity) === ROOT_A ? [settings.session] : [],
      );
    expect(savedSessions.length).toBeGreaterThan(0);
    const persisted = savedSessions[savedSessions.length - 1];
    expect(Object.keys(persisted?.editor.groups ?? {})).toEqual(["editor-main"]);
    expect(persisted?.editor.layout).toEqual({ kind: "group", groupId: "editor-main" });
  });

  it("keeps another workspace's split when a side group empties in the current workspace", async () => {
    const { getWorkbench } = render();
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(ROOT_B);
      await getWorkbench().openPinnedFile(OTHER);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const workspaceBGroups = getWorkbench().editorGroups;
    expect(Object.keys(workspaceBGroups.groups)).toHaveLength(2);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(ROOT_A);
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(GREET);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const sideGroupId = getWorkbench().editorGroups.activeGroupId;
    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(sideGroupId, GREET.path);
    });
    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main"]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(ROOT_B);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(ROOT_B);
    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(
      Object.keys(workspaceBGroups.groups),
    );
    expect(getWorkbench().editorGroups.layout).toEqual(workspaceBGroups.layout);
  });

  it("loads the neighbour's Git diff tab once a side group collapses", async () => {
    const change = gitChangedFile("src/Shared.php", false);
    const diffPath = "mockor-git-diff:worktree:/workspace/src/Shared.php";
    const plain = fileEntry("/workspace/src/Plain.ts", "Plain.ts");
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getDiff = vi.fn(async (_repositoryRoot, requestedChange) => ({
      change: requestedChange,
      language: "php",
      modifiedContent: "new",
      originalContent: "old",
    }));
    const { getWorkbench } = renderController({
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      gitGateway,
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openGitChange(change);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const sideGroupId = getWorkbench().editorGroups.activeGroupId;
    await act(async () => {
      await getWorkbench().openPinnedFile(plain);
      await getWorkbench().closeDocumentInEditorGroup(sideGroupId, diffPath);
    });
    expect(getWorkbench().gitDiffPreview).toBeNull();

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(sideGroupId, plain.path);
      await flushAsyncTurns();
    });

    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main"]);
    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview?.modifiedContent).toBe("new");
  });

  it.each([
    ["with tabs", true],
    ["empty", false],
  ])(
    "collapses a cached empty side group whatever the other workspace's side group holds (%s)",
    async (_label, otherSideHasTabs) => {
      const { getWorkbench } = render();
      await flushAsyncTurns(24);
      if (otherSideHasTabs) {
        await act(async () => {
          await getWorkbench().openPinnedFile(GREET);
        });
      }
      act(() => getWorkbench().splitActiveEditorGroup("right"));
      await act(async () => {
        await getWorkbench().activateWorkspaceTab(ROOT_B);
      });
      await flushAsyncTurns(24);
      act(() => getWorkbench().splitActiveEditorGroup("right"));
      expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main", "editor-1"]);

      await act(async () => {
        await getWorkbench().activateWorkspaceTab(ROOT_A);
      });
      await flushAsyncTurns(24);
      expect(Object.keys(getWorkbench().editorGroups.groups)).toHaveLength(
        otherSideHasTabs ? 2 : 1,
      );
      await act(async () => {
        await getWorkbench().activateWorkspaceTab(ROOT_B);
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().workspaceRoot).toBe(ROOT_B);
      expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main"]);
      expect(getWorkbench().editorGroups.layout).toEqual({ kind: "group", groupId: "editor-main" });
    },
  );

  it("moves a tab between groups atomically without closing its document", async () => {
    const path = "/workspace/src/Move.ts";
    const stayPath = "/workspace/src/Stay.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 92,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const moved = true;\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Move.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const groupIds = Object.keys(getWorkbench().editorGroups.groups);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Stay.ts", path: stayPath });
    });
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    await act(async () => {
      getWorkbench().closeDocumentInEditorGroup(groupIds[1], path);
      getWorkbench().moveEditorGroupTab(groupIds[0], groupIds[1], path);
      await Promise.resolve();
    });

    const openPaths = getWorkbench().openDocuments.map((document) => document.path);
    expect(openPaths.sort()).toEqual([path, stayPath]);
    expect(getWorkbench().editorGroups.groups[groupIds[0]].activePath).toBeNull();
    expect(getWorkbench().editorGroups.groups[groupIds[1]].activePath).toBe(path);
    expect(dependencies.documentSyncGateway.didClose).not.toHaveBeenCalled();
  });
});
