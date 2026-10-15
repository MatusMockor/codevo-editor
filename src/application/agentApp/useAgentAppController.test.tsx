// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import contract from "../../../contracts/workspace-trust-errors.json";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import type { WorkspaceTrustGateway } from "../../domain/trust";
import {
  actAndSettle,
  agentAppGitGateway,
  renderAgentAppController,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "../../test/agentAppTestHarness";
import {
  agentIdentityGateway,
  agentSettingsGateway,
  agentTrustGateway,
  deferred,
} from "../../test/agentAppWorkspaceHarness";
import { waitForReact } from "../../test/reactTestLifecycle";

const IDENTITY_REJECTION = contract.openedProjectIdentityReplaced;

function settingsWithTabs(...tabs: string[]): AppSettings {
  return { ...defaultAppSettings(), recentWorkspacePath: tabs[0] ?? null, workspaceTabs: tabs };
}

async function renderOpened(options: Parameters<typeof renderAgentAppController>[0] = {}) {
  const harness = renderAgentAppController({
    appSettings: settingsWithTabs("/workspace-a"),
    ...options,
  });
  await waitForReact(() => expect(harness.current().workspaceRoot).toBe("/workspace-a"));
  await settleAgentApp();
  return harness;
}

afterEach(() => {
  unmountAgentAppHarnesses();
});

describe("useAgentAppController", () => {
  it("restores the recent project in StrictMode and starts in the agent layout", async () => {
    const harness = await renderOpened({ strictMode: true });
    const controller = harness.current();

    expect(controller.agentWorkbench.layout.rightPanel).toBe("closed");
    expect(controller.workspaceIdentityDescriptor?.workspaceId).toBe("workspace-a");
    expect(controller.windowTitle).toBe("Agents - workspace-a");
    expect(document.title).toBe("Agents - workspace-a");
    expect(controller.commandContext).toEqual({
      hasWorkspace: true,
    });
  });

  it("opens and closes settings through the settings command", async () => {
    const harness = await renderOpened();

    await actAndSettle(() => {
      expect(harness.current().runCommand("workbench.openAppearanceSettings")).toBe("executed");
    });
    expect(harness.current().settingsOpen).toBe(true);
    expect(harness.current().settingsInitialSection).toBe("appearance");

    await actAndSettle(() => harness.current().setSettingsOpen(false));
    expect(harness.current().settingsOpen).toBe(false);
  });

  it("registers only agent commands and opens the palette", async () => {
    const harness = await renderOpened();
    const ids = harness.current().commands.map((command) => command.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "agent.newThread",
        "app.quit",
        "commands.show",
        "file.quickOpen",
        "panel.toggle",
        "terminal.show",
        "workbench.closeActive",
        "workbench.openSettings",
        "workbench.zoomIn",
        "workspace.trust",
      ]),
    );
    for (const ideCommand of [
      "editor.closeTab",
      "editor.save",
      "editor.fontZoomIn",
      "panel.showProblems",
      "git.revertCommit",
      "workbench.toggleMinimap",
    ]) {
      expect(ids).not.toContain(ideCommand);
    }

    await actAndSettle(() => {
      harness.current().runCommand("commands.show");
    });
    expect(harness.current().paletteOpen).toBe(true);
  });

  it("closes the active right-panel surface on Cmd+W and otherwise does nothing", async () => {
    const harness = await renderOpened();

    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" }),
    );
    expect(harness.current().agentWorkbench.layout.activeSurface).toBe("files");

    await actAndSettle(() => {
      expect(harness.current().runCommand("workbench.closeActive")).toBe("executed");
    });
    expect(harness.current().agentWorkbench.layout.openSurfaces).not.toContain("files");

    const layout = harness.current().agentWorkbench.layout;
    await actAndSettle(() => {
      harness.current().runCommand("workbench.closeActive");
    });
    expect(harness.current().agentWorkbench.layout).toBe(layout);
  });

  it("toggles the terminal panel and opens the files surface for quick open", async () => {
    const harness = await renderOpened();

    await actAndSettle(() => {
      harness.current().runCommand("panel.toggle");
    });
    expect(harness.current().bottomPanelVisible).toBe(true);
    await actAndSettle(() => {
      harness.current().runCommand("panel.toggle");
    });
    expect(harness.current().bottomPanelVisible).toBe(false);

    await actAndSettle(() => {
      harness.current().runCommand("file.quickOpen");
    });
    expect(harness.current().agentWorkbench.layout.activeSurface).toBe("files");
  });

  it("keeps the terminal panel with its own project across A to B to A", async () => {
    const appSettings = settingsWithTabs("/workspace-a", "/workspace-b");
    const settings = agentSettingsGateway(appSettings);
    const harness = await renderOpened({ appSettings, settingsGateway: settings.gateway });
    const persistedBottomPanel = (root: string) =>
      [...settings.saved.workspaces.entries()]
        .filter(([key]) => key.includes(root))
        .map(
          ([, saved]) =>
            (saved.session.agentWorkbench as { bottomPanel?: unknown } | undefined)?.bottomPanel,
        );

    await actAndSettle(() => {
      harness.current().runCommand("panel.toggle");
    });
    expect(harness.current().bottomPanelVisible).toBe(true);
    await settleAgentApp();
    expect(persistedBottomPanel("workspace-a")).toContain(true);

    await act(async () => harness.current().activateWorkspaceTab("/workspace-b"));
    await settleAgentApp();
    expect(harness.current().workspaceRoot).toBe("/workspace-b");
    expect(harness.current().bottomPanelVisible).toBe(false);
    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "files" }),
    );
    await settleAgentApp();
    expect(persistedBottomPanel("workspace-b")).not.toContain(true);

    await act(async () => harness.current().activateWorkspaceTab("/workspace-a"));
    await settleAgentApp();
    expect(harness.current().workspaceRoot).toBe("/workspace-a");
    expect(harness.current().bottomPanelVisible).toBe(false);
    expect(harness.current().agentWorkbench.persistedBottomPanel).toBe(true);
    expect(persistedBottomPanel("workspace-a")).toContain(true);
  });

  it("closes Settings when Go to File or a file reveal opens the Files surface", async () => {
    const harness = await renderOpened();

    await actAndSettle(() => {
      harness.current().runCommand("workbench.openSettings");
    });
    expect(harness.current().settingsOpen).toBe(true);
    await actAndSettle(() => {
      harness.current().runCommand("file.quickOpen");
    });
    expect(harness.current().settingsOpen).toBe(false);
    expect(harness.current().agentWorkbench.layout.activeSurface).toBe("files");

    await actAndSettle(() => {
      harness.current().runCommand("workbench.openSettings");
    });
    expect(harness.current().settingsOpen).toBe(true);
    await actAndSettle(() => harness.current().revealFile("/workspace-a/src/index.ts", 3));
    expect(harness.current().settingsOpen).toBe(false);
    expect(harness.current().agentWorkbench.layout.activeSurface).toBe("files");
  });

  it("quits through the native shutdown after the agent flush", async () => {
    const harness = await renderOpened();

    await actAndSettle(() => {
      harness.current().runCommand("app.quit");
    });
    await settleAgentApp();

    expect(harness.composition.nativeShutdown.quit).toHaveBeenCalledOnce();
  });

  it("discovers repositories and loads git status only while a git surface is open", async () => {
    const gitGateway = agentAppGitGateway({
      detectRepositories: vi.fn(async () => [""]),
    });
    const harness = await renderOpened({ gitGateway });
    expect(gitGateway.getStatus).not.toHaveBeenCalled();

    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }),
    );
    await settleAgentApp();

    expect(gitGateway.detectRepositories).toHaveBeenCalledWith("/workspace-a");
    await waitForReact(() => expect(gitGateway.getStatus).toHaveBeenCalledWith("/workspace-a"));
  });

  it("keeps workspace trust per project across A to B to A", async () => {
    const trustGateway = agentTrustGateway({
      getTrust: vi.fn(async (rootPath: string) => ({
        rootPath,
        trusted: rootPath === "/workspace-a",
      })),
    });
    const harness = await renderOpened({
      appSettings: settingsWithTabs("/workspace-a", "/workspace-b"),
      trustGateway,
    });
    await waitForReact(() =>
      expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true }),
    );
    const firstOwner = harness.current().workspaceOwnerKey;

    await act(async () => harness.current().activateWorkspaceTab("/workspace-b"));
    await settleAgentApp();
    expect(harness.current().workspaceRoot).toBe("/workspace-b");
    await waitForReact(() =>
      expect(harness.current().workspaceTrust).toEqual({
        rootPath: "/workspace-b",
        trusted: false,
      }),
    );

    await act(async () => harness.current().activateWorkspaceTab("/workspace-a"));
    await settleAgentApp();
    expect(harness.current().workspaceRoot).toBe("/workspace-a");
    expect(harness.current().workspaceOwnerKey).toBe(firstOwner);
    await waitForReact(() =>
      expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true }),
    );
  });

  it("does not publish a late settings save trust result after a project switch", async () => {
    const persisted = deferred<{ rootPath: string; trusted: boolean }>();
    const trustGateway = agentTrustGateway({
      setTrust: vi.fn(() => persisted.promise),
    });
    const harness = await renderOpened({
      appSettings: settingsWithTabs("/workspace-a", "/workspace-b"),
      trustGateway,
    });
    await waitForReact(() => expect(harness.current().workspaceTrust?.trusted).toBe(true));

    let save!: Promise<void>;
    await actAndSettle(() => {
      const current = harness.current();
      save = current.saveWorkbenchSettings(current.appSettings, current.workspaceSettings, false);
    });
    await act(async () => harness.current().activateWorkspaceTab("/workspace-b"));
    await act(async () => {
      persisted.resolve({ rootPath: "/workspace-a", trusted: false });
      await save;
    });
    await settleAgentApp();

    expect(harness.current().workspaceRoot).toBe("/workspace-b");
    expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-b", trusted: true });
  });
});

describe("useAgentAppController trust revocation identity", () => {
  function trustGatewayWith(
    revokeOpenedProject: NonNullable<WorkspaceTrustGateway["revokeOpenedProject"]>,
  ) {
    return agentTrustGateway({ revokeOpenedProject: vi.fn(revokeOpenedProject) });
  }

  it("revokes the open project through the identity its tab holds, not its path", async () => {
    const trustGateway = trustGatewayWith(async (identity) => ({
      rootPath: identity.canonicalRoot,
      trusted: false,
    }));
    const harness = await renderOpened({ identityGateway: agentIdentityGateway(), trustGateway });
    await waitForReact(() =>
      expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true }),
    );

    await act(async () => harness.current().toggleWorkspaceTrust());

    expect(trustGateway.revokeOpenedProject).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-a",
      admissionToken: 1,
      canonicalRoot: "/workspace-a",
    });
    expect(trustGateway.setTrust).not.toHaveBeenCalled();
    expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: false });
  });

  it("keeps the project trusted and says why when its identity is rejected", async () => {
    const trustGateway = trustGatewayWith(async () => {
      throw new Error(IDENTITY_REJECTION);
    });
    const harness = await renderOpened({ trustGateway });
    await waitForReact(() => expect(harness.current().workspaceTrust?.trusted).toBe(true));

    await act(async () => harness.current().toggleWorkspaceTrust());
    await settleAgentApp();

    expect(trustGateway.revokeOpenedProject).toHaveBeenCalledTimes(1);
    expect(trustGateway.setTrust).not.toHaveBeenCalled();
    expect(harness.current().workspaceTrust).toEqual({ rootPath: "/workspace-a", trusted: true });
    expect(
      harness.current().notices.filter((notice) => notice.source === "Workspace Trust"),
    ).toEqual([expect.objectContaining({ message: expect.stringContaining(IDENTITY_REJECTION) })]);
  });
});
