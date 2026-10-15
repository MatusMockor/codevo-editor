// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../domain/settings";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import {
  actAndSettle,
  agentAppFileChangeGateway,
  agentAppGitGateway,
  renderAgentAppController,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "../../test/agentAppTestHarness";
import { waitForReact } from "../../test/reactTestLifecycle";
import { unavailableNodePackageScriptsWorkbenchGateway } from "../useNodePackageScriptWorkbench";
import { GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS } from "./useAgentGitStatus";

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";

function change(rootPath: string, relativePath: string): WorkspaceFileChangeEvent {
  return {
    fileKind: "file",
    kind: "modified",
    path: `${rootPath}/${relativePath}`,
    relativePath,
    rootPath,
  };
}

function scriptsGateway() {
  return {
    ...unavailableNodePackageScriptsWorkbenchGateway,
    listNodePackageScripts: vi.fn(async () => ({
      scripts: [],
      total: 0,
      truncated: false,
      visited: 1,
    })),
  };
}

async function renderOpened(options: Parameters<typeof renderAgentAppController>[0] = {}) {
  const harness = renderAgentAppController({
    appSettings: {
      ...defaultAppSettings(),
      recentWorkspacePath: ROOT_A,
      workspaceTabs: [ROOT_A, ROOT_B],
    },
    directoryEntries: {
      [ROOT_A]: [{ kind: "file", name: "package.json", path: `${ROOT_A}/package.json` }],
    },
    ...options,
  });
  await waitForReact(() => expect(harness.current().workspaceRoot).toBe(ROOT_A));
  await settleAgentApp();
  return harness;
}

afterEach(() => {
  unmountAgentAppHarnesses();
  vi.useRealTimers();
});

describe("agent app workspace file-change signals", () => {
  it("starts the watcher for the active project and moves the subscription on a switch", async () => {
    const fileChanges = agentAppFileChangeGateway();
    const harness = await renderOpened({ fileChanges });

    expect(fileChanges.startWatching).toHaveBeenCalledWith(ROOT_A);
    expect(fileChanges.listenerCount()).toBe(1);

    await act(async () => harness.current().activateWorkspaceTab(ROOT_B));
    await settleAgentApp();

    expect(fileChanges.startWatching).toHaveBeenLastCalledWith(ROOT_B);
    expect(fileChanges.listenerCount()).toBe(1);
  });

  it("rediscovers package scripts when package metadata changes and ignores other files", async () => {
    const fileChanges = agentAppFileChangeGateway();
    const nodePackageScriptsGateway = scriptsGateway();
    await renderOpened({ fileChanges, nodePackageScriptsGateway });
    await waitForReact(() =>
      expect(nodePackageScriptsGateway.listNodePackageScripts).toHaveBeenCalled(),
    );
    const before = nodePackageScriptsGateway.listNodePackageScripts.mock.calls.length;

    await actAndSettle(() => fileChanges.emit(change(ROOT_A, "src/index.ts")));
    expect(nodePackageScriptsGateway.listNodePackageScripts).toHaveBeenCalledTimes(before);

    await actAndSettle(() => fileChanges.emit(change(ROOT_A, "packages/api/package.json")));
    await waitForReact(() =>
      expect(nodePackageScriptsGateway.listNodePackageScripts).toHaveBeenCalledTimes(before + 1),
    );

    await actAndSettle(() => fileChanges.emit(change(ROOT_B, "package.json")));
    expect(nodePackageScriptsGateway.listNodePackageScripts).toHaveBeenCalledTimes(before + 1);
  });

  it("refreshes git status once per debounced burst only while a git surface is open", async () => {
    const fileChanges = agentAppFileChangeGateway();
    const gitGateway = agentAppGitGateway();
    const harness = await renderOpened({ fileChanges, gitGateway });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await actAndSettle(() => fileChanges.emit(change(ROOT_A, "src/index.ts")));
    await act(async () => vi.advanceTimersByTimeAsync(GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS));
    expect(gitGateway.getStatus).not.toHaveBeenCalled();

    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" }),
    );
    await settleAgentApp();
    const opened = vi.mocked(gitGateway.getStatus).mock.calls.length;
    expect(opened).toBeGreaterThan(0);

    await actAndSettle(() => {
      fileChanges.emit(change(ROOT_A, "src/a.ts"));
      fileChanges.emit(change(ROOT_A, "src/b.ts"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS - 1));
    expect(gitGateway.getStatus).toHaveBeenCalledTimes(opened);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await settleAgentApp();
    expect(gitGateway.getStatus).toHaveBeenCalledTimes(opened + 1);
  });

  it("drops a pending git refresh when the project switches before the debounce fires", async () => {
    const fileChanges = agentAppFileChangeGateway();
    const gitGateway = agentAppGitGateway();
    const harness = await renderOpened({ fileChanges, gitGateway });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" }),
    );
    await settleAgentApp();

    await actAndSettle(() => fileChanges.emit(change(ROOT_A, "src/a.ts")));
    await act(async () => harness.current().activateWorkspaceTab(ROOT_B));
    await settleAgentApp();
    const afterSwitch = vi.mocked(gitGateway.getStatus).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS));
    await settleAgentApp();

    expect(gitGateway.getStatus).toHaveBeenCalledTimes(afterSwitch);
    expect(vi.mocked(gitGateway.getStatus).mock.calls.slice(afterSwitch)).toEqual([]);
  });
});
