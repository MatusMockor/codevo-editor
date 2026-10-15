// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETED_FILE_REASON } from "../../../../application/useAgentEditorBridge";
import type { AgentDiffScope } from "../../../../domain/diffView/agentDiffScope";
import type { GitChangedFile } from "../../../../domain/git";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import { rightPanelTestContext, WithRightPanelContext } from "../agentRightPanelTestSupport";
import { AgentDiffSurfaceContainer } from "./AgentDiffSurfaceContainer";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  window.localStorage.clear();
});

const CHANGE: GitChangedFile = {
  isStaged: false,
  isUnversioned: false,
  oldPath: null,
  oldRelativePath: null,
  path: "/repo/a.ts",
  relativePath: "a.ts",
  status: "modified",
};

function workingTreeContext(
  overrides: Partial<AgentRightPanelContextValue>,
): AgentRightPanelContextValue {
  const scope: AgentDiffScope = { kind: "workingTree" };
  const base = rightPanelTestContext({ diffScope: scope, ...overrides });
  const chrome = base.chrome;
  if (chrome === null) throw new Error("test context needs chrome");
  const getStatus = async (root: string) => ({
    branch: "main",
    isRepository: true,
    rootPath: root,
    changes: [CHANGE],
  });
  return {
    ...base,
    chrome: {
      ...chrome,
      gateways: { ...chrome.gateways, git: { ...chrome.gateways.git, getStatus } },
    },
  };
}

function mount(value: AgentRightPanelContextValue): HTMLElement {
  ui = mountUi();
  ui.render(
    <WithRightPanelContext value={value}>
      <AgentDiffSurfaceContainer />
    </WithRightPanelContext>,
  );
  return ui.host;
}

describe("AgentDiffSurfaceContainer", () => {
  it("opens a working-tree file in the Files viewer, not a diff document", async () => {
    const openChangedFile = vi.fn(async () => undefined);
    const openChangedFileDiff = vi.fn(async () => undefined);
    const base = rightPanelTestContext();
    const host = mount(
      workingTreeContext({
        thread: surfaceThreadView(),
        agents: { ...base.agents, openChangedFile, openChangedFileDiff },
      }),
    );
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Open file a.ts"]')).not.toBeNull(),
    );

    click(host.querySelector('[aria-label="Open file a.ts"]') as Element);

    expect(openChangedFile).toHaveBeenCalledWith("agt-1", CHANGE);
    expect(openChangedFileDiff).not.toHaveBeenCalled();
    expect(host.textContent).not.toMatch(/editor/i);
  });

  it("opens the absolute path when there is no thread", async () => {
    const openFile = vi.fn();
    const host = mount(workingTreeContext({ thread: null, openFile }));
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Open file a.ts"]')).not.toBeNull(),
    );

    click(host.querySelector('[aria-label="Open file a.ts"]') as Element);

    expect(openFile).toHaveBeenCalledWith("/repo/a.ts");
  });

  it("disables Open file for a deleted file and never opens it", async () => {
    const openChangedFile = vi.fn(async () => undefined);
    const base = rightPanelTestContext();
    const deleted: GitChangedFile = { ...CHANGE, status: "deleted" };
    const context = workingTreeContext({
      thread: surfaceThreadView(),
      agents: { ...base.agents, openChangedFile },
    });
    const chrome = context.chrome;
    if (chrome === null) throw new Error("test context needs chrome");
    const host = mount({
      ...context,
      chrome: {
        ...chrome,
        gateways: {
          ...chrome.gateways,
          git: {
            ...chrome.gateways.git,
            getStatus: async (root: string) => ({
              branch: "main",
              isRepository: true,
              rootPath: root,
              changes: [deleted],
            }),
          },
        },
      },
    });
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Open file a.ts"]')).not.toBeNull(),
    );
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Open file a.ts"]');

    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe(DELETED_FILE_REASON);
    click(button as Element);
    expect(openChangedFile).not.toHaveBeenCalled();
  });
});
