// @vitest-environment jsdom

import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { WorkspaceTrustState } from "../domain/trust";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type WorkspaceSettings,
} from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  agentProviderUpdateOperationId,
  useWorkbenchAgents,
  type WorkbenchAgentsOptions,
  type WorkbenchAgentsSurface,
} from "./useWorkbenchAgents";

const ACTIVE_ROOT = "/ws/active";
const ACTIVE_ID = "workspace-active";
const BACKGROUND_ROOT = "/ws/api";
const CLI_PATH = "/usr/local/bin/claude";

describe("agentProviderUpdateOperationId", () => {
  it.each([
    ["claudeCode", "claudeCode-update-1"],
    ["codex", "codex-update-1"],
  ] as const)("mints the first bounded %s update id", (provider, expected) => {
    expect(agentProviderUpdateOperationId(provider, 1)).toBe(expected);
    expect(expected.length).toBeGreaterThanOrEqual(8);
    expect(expected.length).toBeLessThanOrEqual(128);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useWorkbenchAgents composition", () => {
  it("serves the M1 single active project without project gateways", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });

    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));

    const project = harness.hook().agentProjects.projects[0];
    expect(project?.rootKey).toBe(ACTIVE_ROOT);
    expect(project?.ownerId).toBe(ACTIVE_ID);
    expect(project?.origin).toBe("active-tab");
    expect(project?.trust).toBe("trusted");

    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Fix the failing test",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(ACTIVE_ID);
    expect(harness.startedRequests[0]?.repositoryRoot).toBe(ACTIVE_ROOT);
    expect(harness.trust.getTrust).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("selects the current registered provider for every new dispatch", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });
    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));
    harness.appSettings.agentCliPaths = {
      claudeCode: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
    };
    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Claude turn",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    expect(harness.startedRequests[0]).toMatchObject({
      agentCliKind: "claudeCode",
    });
    expect(harness.startedRequests[0]).not.toHaveProperty("agentCliPath");

    await act(async () => {
      expect(
        await harness.hook().providerManagement.save({
          provider: "codex",
          cliPath: "/usr/local/bin/codex",
          selectedProvider: "codex",
        }),
      ).toBe(true);
    });
    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Codex turn",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("codex"),
      });
    });
    expect(harness.startedRequests[1]).toMatchObject({
      agentCliKind: "codex",
    });
    expect(harness.startedRequests[1]).not.toHaveProperty("agentCliPath");
    harness.unmount();
  });

  it("registers persisted disabled policy before rejecting dispatch", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false, providerEnabled: false });
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claudeCode", enabled: false }),
      ),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Do not start",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toBe(
      "Enable this provider in Settings before starting a turn.",
    );
    harness.unmount();
  });

  it("reports a configured-path refusal for a registered pathless provider", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: false,
      providerConfigured: false,
    });
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claudeCode", cliPath: null }),
      ),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Do not start",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toBe(
      "Install this provider CLI or configure a manual path in Settings before starting a turn.",
    );
    harness.unmount();
  });

  it("admits an automatically detected provider while registering a null override", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: false,
      providerConfigured: false,
      autoDetected: true,
    });
    await waitForReact(() =>
      expect(harness.hook().providerManagement.providers.claudeCode.executable).toEqual({
        kind: "detected",
        path: "/detected/claude",
        version: "1.0.0",
      }),
    );
    expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claudeCode", cliPath: null }),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Use detected provider",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(harness.startedRequests[0]).not.toHaveProperty("agentCliPath");
    expect(harness.hook().providerManagement.authority("claudeCode")?.cliPath).toBeNull();
    harness.unmount();
  });

  it("accepts the discovery revision minted by its own post-sign-in refresh", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: false,
      providerConfigured: false,
      autoDetected: true,
    });
    await waitForReact(() =>
      expect(harness.hook().providerManagement.providers.claudeCode.health.kind).toBe("ready"),
    );
    await act(async () => undefined);
    act(() => expect(harness.hook().providerSignIn.request("claudeCode")).toBe(true));
    const intent = harness.hook().providerSignIn.terminalIntents.claudeCode!;
    let startedSignIn!: Awaited<ReturnType<WorkbenchAgentsSurface["providerSignIn"]["start"]>>;
    await act(async () => {
      startedSignIn = await harness.hook().providerSignIn.start(intent, { cols: 80, rows: 24 });
    });
    expect(startedSignIn?.kind).toBe("started");

    await act(async () => harness.hook().providerSignIn.settle(intent, 77, 0));

    expect(harness.hook().providerSignIn.states.claudeCode).toMatchObject({
      kind: "settled",
      healthRefresh: "complete",
    });
    harness.unmount();
  });

  it("reveals the production terminal route and excludes same-provider updates during sign-in", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(2),
    );
    await waitForReact(() =>
      expect(harness.hook().providerManagement.providers.claudeCode.health.kind).toBe("ready"),
    );

    act(() => {
      expect(harness.hook().providerSignIn.request("claudeCode")).toBe(true);
    });

    expect(harness.revealTerminal).toHaveBeenCalledTimes(1);
    expect(harness.hook().providerSignIn.terminalIntents.claudeCode).not.toBeNull();
    expect(harness.hook().providerSignIn.terminalIntents.codex).toBeNull();
    expect(harness.hook().providerManagement.providers.claudeCode.signInActive).toBe(true);
    expect(harness.hook().providerManagement.providers.codex.signInActive).toBe(false);
    harness.unmount();
  });

  it("reports a real post-sign-in probe rejection without claiming refresh completion", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(2),
    );
    await waitForReact(() =>
      expect(harness.hook().providerManagement.providers.claudeCode.health.kind).toBe("ready"),
    );
    act(() => expect(harness.hook().providerSignIn.request("claudeCode")).toBe(true));
    const intent = harness.hook().providerSignIn.terminalIntents.claudeCode!;
    await act(async () => harness.hook().providerSignIn.start(intent, { cols: 80, rows: 24 }));
    harness.agentProviderGateway.probeAgentProviderHealth.mockRejectedValueOnce(
      new Error("probe rejected"),
    );

    await act(async () => harness.hook().providerSignIn.settle(intent, 77, 0));

    expect(harness.hook().providerSignIn.states.claudeCode).toMatchObject({
      kind: "settled",
      healthRefresh: "failed",
    });
    harness.unmount();
  });

  it("re-registers provider ownership across workspace A to B to A replacements", async () => {
    const harness = renderWorkbenchAgents({ withProjectGateways: false });
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(2),
    );

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(4),
    );

    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() =>
      expect(harness.agentProviderGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(6),
    );
    harness.unmount();
  });

  it("dispatches a nested repository with the replacement registered workspace identity", async () => {
    const nestedRepository = `${ACTIVE_ROOT}/packages/api`;
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      gitRepositoryMappings: [{ rootRelativePath: "" }, { rootRelativePath: "packages/api" }],
    });
    await waitForReact(() => expect(harness.hook().agentProjects.projects).toHaveLength(1));
    let firstThreadId = "";
    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Keep working",
        isolation: "in-place",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
      firstThreadId = started?.threadId ?? "";
    });

    harness.setWorkspaceId("workspace-active-replaced");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-active-replaced",
      );
      expect(harness.hook().agentProjects.projects[0]?.ownerId).toBe(ACTIVE_ID);
    });

    let secondThreadId = "";
    await act(async () => {
      const started = await harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: nestedRepository,
        prompt: "List files",
        isolation: "in-place",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
      expect(started).not.toBeNull();
      secondThreadId = started?.threadId ?? "";
    });

    expect(harness.startedRequests[1]).toMatchObject({
      workspaceId: "workspace-active-replaced",
      projectRoot: ACTIVE_ROOT,
      repositoryRoot: nestedRepository,
      cwd: nestedRepository,
    });
    expect(harness.hook().threads).toHaveLength(2);
    expect(harness.hook().threads.map((view) => view.thread.owner.ownerId)).toEqual(
      expect.arrayContaining([ACTIVE_ID, "workspace-active-replaced"]),
    );
    act(() => {
      harness.hook().renameThread(firstThreadId, "First owner");
      harness.hook().renameThread(secondThreadId, "Second owner");
    });
    expect(harness.hook().threads.map((view) => view.thread.title)).toEqual(
      expect.arrayContaining(["First owner", "Second owner"]),
    );
    await act(async () => harness.hook().stop(secondThreadId));
    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[1]?.taskId,
      workspaceId: "workspace-active-replaced",
    });
    harness.unmount();
  });

  it("admits background tabs through the project gateways and dispatches into them", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
    });

    const background = harness
      .hook()
      .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
    expect(background?.origin).toBe("background-tab");
    expect(background?.ownerId).toBe(agentRootOwnerId(BACKGROUND_ROOT));

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(harness.startedRequests[0]?.workspaceId).toBe(agentRootOwnerId(BACKGROUND_ROOT));
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps trust rejections out of Problems across grant and retry", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.leaseToken).not.toBeNull();
    });
    harness.worktree.addAgentWorktree.mockRejectedValueOnce(
      new Error("Agent worktrees require a trusted repository."),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Check trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("untrusted");
      expect(background?.leaseToken).toBeNull();
    });
    expect(harness.reportError).not.toHaveBeenCalled();

    await act(async () => {
      await harness.hook().agentProjects.trustProject(BACKGROUND_ROOT);
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.leaseToken).not.toBeNull();
    });
    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Retry after trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(harness.trust.setTrust).toHaveBeenCalledWith(BACKGROUND_ROOT, true);
    expect(harness.worktree.addAgentWorktree).toHaveBeenCalledTimes(2);
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a late trust rejection across an active workspace A to B to A replacement", async () => {
    const worktree = createDeferred<{
      readonly worktreePath: string;
      readonly branch: string;
      readonly trusted: boolean;
    }>();
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockImplementationOnce(() => worktree.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check stale trust",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.addAgentWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      worktree.reject(new Error("Agent worktrees require a trusted repository."));
      expect(await pending).toBeNull();
    });

    expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
    expect(harness.activeTrustChanged).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops an untrusted worktree cleanup notice across an active workspace A to B to A replacement", async () => {
    const cleanup = createDeferred<undefined>();
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockResolvedValueOnce({
      worktreePath: `${ACTIVE_ROOT}/.worktrees/stale`,
      branch: "agent/stale",
      trusted: false,
    });
    harness.worktree.removeWorktree.mockImplementationOnce(() => cleanup.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check stale cleanup",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.removeWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      cleanup.resolve(undefined);
      expect(await pending).toBeNull();
    });

    expect(harness.hook().notice).toBeNull();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reports orphaned cleanup to the retained project after an active workspace replacement", async () => {
    const cleanup = createDeferred<undefined>();
    const cleanupError = new Error("cleanup failed");
    const harness = renderWorkbenchAgents({ withProjectGateways: true });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });
    harness.worktree.addAgentWorktree.mockResolvedValueOnce({
      worktreePath: `${ACTIVE_ROOT}/.worktrees/orphaned`,
      branch: "agent/orphaned",
      trusted: false,
    });
    harness.worktree.removeWorktree.mockImplementationOnce(() => cleanup.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        prompt: "Check orphan accounting",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    await waitForReact(() => expect(harness.worktree.removeWorktree).toHaveBeenCalledOnce());

    harness.setWorkspaceId("workspace-b");
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-b",
      );
    });
    harness.setWorkspaceId(ACTIVE_ID);
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().agentProjects.launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        ACTIVE_ID,
      );
    });

    await act(async () => {
      cleanup.reject(cleanupError);
      expect(await pending).toBeNull();
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", cleanupError);
    expect(harness.hook().notice?.message).toContain("orphaned");
    harness.unmount();
  });

  it("forwards active workspace trust as the project authority", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTrust: { rootPath: ACTIVE_ROOT, trusted: false },
    });

    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("untrusted");
    });
    expect(harness.lease.acquireAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("downgrades a project fail-closed when the backend rejects the dispatch as untrusted", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
    });
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("untrusted");
    });
    harness.unmount();
  });

  it("keeps the active project downgraded after the backend rejects its dispatch as untrusted", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTrust: { rootPath: ACTIVE_ROOT, trusted: true },
    });
    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("trusted");
    });
    harness.agent.startAgentTask.mockRejectedValueOnce(
      new Error("Agent tasks require a trusted repository."),
    );
    const trustCallsBeforeRejection = harness.trust.getTrust.mock.calls.length;

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: ACTIVE_ROOT,
          repositoryRoot: ACTIVE_ROOT,
          prompt: "Check trust",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    await waitForReact(() => {
      expect(harness.hook().agentProjects.projects[0]?.trust).toBe("untrusted");
    });
    expect(harness.activeTrustChanged).toHaveBeenCalledWith(ACTIVE_ROOT, ACTIVE_ID, false);
    expect(harness.trust.getTrust).toHaveBeenCalledTimes(trustCallsBeforeRejection);
    harness.unmount();
  });

  it("refuses a dispatch into an unprotected project when the lease cannot be acquired", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
      refusedLeaseRoots: [BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
      expect(background?.leaseToken).toBeNull();
    });

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).toBeNull();
    });

    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    expect(harness.worktree.addAgentWorktree).not.toHaveBeenCalled();
    expect(harness.hook().notice?.kind).toBe("error");
    expect(harness.hook().notice?.message).toContain("could not be protected from tab close");
    harness.unmount();
  });

  it("acquires the missing lease during dispatch and keeps the closed tab's task alive", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
      refusedLeaseRoots: [BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.trust).toBe("trusted");
      expect(background?.repositories.length).toBeGreaterThan(0);
      expect(background?.leaseToken).toBeNull();
    });
    harness.refusedLeaseRoots.delete(BACKGROUND_ROOT);

    await act(async () => {
      expect(
        await harness.hook().startThread({
          projectRootKey: BACKGROUND_ROOT,
          repositoryRoot: BACKGROUND_ROOT,
          prompt: "Refactor the API",
          isolation: "worktree",
          unsafeInPlaceConfirmationKey: null,
          launch: defaultAgentLaunchOptions("claudeCode"),
        }),
      ).not.toBeNull();
    });

    expect(
      harness.lease.acquireAgentRootLease.mock.calls.filter(
        ([request]) => request.rootPath === BACKGROUND_ROOT,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.leaseToken).not.toBeNull();
    });
    expect(harness.hook().threads).toHaveLength(1);

    harness.appSettings.workspaceTabs = [ACTIVE_ROOT];
    harness.rerender();

    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.origin).toBe("closed-tab-live-tasks");
    });
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.agent.stopAgentTask).not.toHaveBeenCalled();
    expect(harness.agent.stopAgentTasksForRoot).not.toHaveBeenCalled();
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("projects an admitted unpublished turn into provider update exclusion", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
      refusedLeaseRoots: [BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.leaseToken).toBeNull();
    });
    harness.refusedLeaseRoots.delete(BACKGROUND_ROOT);
    const pendingLease = createDeferred<{ readonly leaseToken: number }>();
    harness.lease.acquireAgentRootLease.mockImplementationOnce(() => pendingLease.promise);

    let pending!: ReturnType<WorkbenchAgentsSurface["startThread"]>;
    act(() => {
      pending = harness.hook().startThread({
        projectRootKey: BACKGROUND_ROOT,
        repositoryRoot: BACKGROUND_ROOT,
        prompt: "Wait for the lease",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });

    await waitForReact(() =>
      expect(harness.hook().providerManagement.providers.claudeCode.liveTurnCount).toBe(1),
    );
    await act(async () => {
      pendingLease.resolve({ leaseToken: 101 });
      await pending;
    });
    harness.unmount();
  });

  it("releases a background project by stopping its tasks through the agent gateway", async () => {
    const harness = renderWorkbenchAgents({
      withProjectGateways: true,
      workspaceTabs: [ACTIVE_ROOT, BACKGROUND_ROOT],
    });
    await waitForReact(() => {
      const background = harness
        .hook()
        .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT);
      expect(background?.repositories.length).toBeGreaterThan(0);
    });

    await act(async () => {
      await harness.hook().startThread({
        projectRootKey: BACKGROUND_ROOT,
        repositoryRoot: BACKGROUND_ROOT,
        prompt: "Refactor the API",
        isolation: "worktree",
        unsafeInPlaceConfirmationKey: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      });
    });
    const taskId = harness.startedRequests[0]?.taskId ?? "";
    const worktreePath = harness.startedRequests[0]?.cwd ?? "";
    await act(async () => {
      harness.emitStatus({
        taskId,
        workspaceId: agentRootOwnerId(BACKGROUND_ROOT),
        repositoryRoot: BACKGROUND_ROOT,
        isolation: "worktree",
        worktreePath,
        sequence: 1,
        status: { kind: "exited", exitCode: 0 },
      });
    });

    harness.appSettings.workspaceTabs = [ACTIVE_ROOT];
    await act(async () => {
      await harness.hook().agentProjects.releaseProject(BACKGROUND_ROOT);
    });

    expect(harness.agent.stopAgentTasksForRoot).toHaveBeenCalledWith({
      workspaceId: agentRootOwnerId(BACKGROUND_ROOT),
      repositoryRoot: BACKGROUND_ROOT,
    });
    await waitForReact(() => {
      expect(
        harness
          .hook()
          .agentProjects.projects.find((project) => project.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined();
      expect(harness.hook().threads).toHaveLength(0);
    });
    harness.unmount();
  });
});

interface HarnessOptions {
  withProjectGateways: boolean;
  autoDetected?: boolean;
  providerConfigured?: boolean;
  providerEnabled?: boolean;
  workspaceTabs?: ReadonlyArray<string>;
  refusedLeaseRoots?: ReadonlyArray<string>;
  workspaceTrust?: WorkspaceTrustState | null;
  gitRepositoryMappings?: ReadonlyArray<{ readonly rootRelativePath: string }>;
}

function renderWorkbenchAgents(options: HarnessOptions) {
  const appSettings: AppSettings = {
    ...defaultAppSettings(),
    agentCliPaths: {
      claudeCode: options.providerConfigured === false ? null : CLI_PATH,
      codex: null,
    },
    workspaceTabs: [...(options.workspaceTabs ?? [])],
    agentProviderPreferences: {
      claudeCode: {
        enabled: options.providerEnabled ?? true,
        healthCheckIntervalSeconds: 300,
        checkForUpdates: false,
        dismissedUpdateVersion: null,
      },
      codex: {
        enabled: true,
        healthCheckIntervalSeconds: 300,
        checkForUpdates: false,
        dismissedUpdateVersion: null,
      },
    },
  };
  const workspaceSettings: WorkspaceSettings = defaultWorkspaceSettings();
  const appSettingsRef = { current: appSettings };
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      startedRequests.push(payload);
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (handler: (event: AgentTaskStatusEvent) => void) => {
      statusHandler = handler;
      return () => undefined;
    }),
    subscribeAgentTaskOutput: vi.fn(async (_handler: (event: AgentTaskOutputEvent) => void) => {
      return () => undefined;
    }),
  };

  const worktree = {
    listWorktrees: vi.fn(async () => []),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, taskId: string) => ({
      worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
      branch: `agent/${taskId}`,
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };

  const threadStore: AgentThreadStoreGateway = {
    loadAgentThreads: vi.fn(async () => ({ threads: [], unreadable: [], evicted: 0 })),
    saveAgentThread: vi.fn(async () => undefined),
    deleteAgentThread: vi.fn(async () => undefined),
  };

  const git = {
    getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      changes: [],
      isRepository: true,
      rootPath,
    })),
    getDiff: vi.fn(async () => {
      return Promise.reject(new Error("diff not stubbed"));
    }),
    stageFiles: vi.fn(async () => Promise.reject(new Error("stage not stubbed"))),
    commit: vi.fn(async () => Promise.reject(new Error("commit not stubbed"))),
  };

  const trust = {
    getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
  };
  const settingsGateway = {
    loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
  };
  const discovery = { detectRepositories: vi.fn(async () => []) };
  let nextLeaseToken = 0;
  const refusedLeaseRoots = new Set<string>(options.refusedLeaseRoots ?? []);
  const lease = {
    acquireAgentRootLease: vi.fn(async (request: { rootPath: string }) => {
      if (refusedLeaseRoots.has(request.rootPath)) {
        return Promise.reject(new Error("Too many agent project roots are leased."));
      }
      nextLeaseToken += 1;
      return { leaseToken: nextLeaseToken };
    }),
    releaseAgentRootLease: vi.fn(async (request: { readonly leaseToken: number }) => ({
      kind: "released" as const,
      leaseToken: request.leaseToken,
    })),
  };

  const reportError = vi.fn();
  const revealTerminal = vi.fn();
  const agentProviderGateway = {
    currentAgentProviderPolicy: vi.fn(
      async ({ provider }: { provider: "claudeCode" | "codex" }) => ({
        kind: "unregistered" as const,
        provider,
      }),
    ),
    registerAgentProviderPolicy: vi.fn(
      async (request: { provider: "claudeCode" | "codex"; settingsRevision: number }) => ({
        provider: request.provider,
        settingsRevision: request.settingsRevision,
        providerGeneration: 1,
      }),
    ),
    probeAgentProviderHealth: vi.fn(async () => ({
      installedVersion: "1.0.0",
      auth: { kind: "unknown" as const },
      update: { kind: "checksDisabled" as const },
      checkedAtEpochMs: 1,
    })),
    updateAgentProvider: vi.fn(async () => ({
      kind: "failed" as const,
      reason: "admissionRefused" as const,
      outputTail: "",
      outputTruncated: false,
    })),
  };
  let activeWorkspaceId = ACTIVE_ID;
  let activeWorkspaceTrust = options.workspaceTrust ?? null;
  const activeTrustChanged = vi.fn((rootPath: string, ownerId: string, trusted: boolean) => {
    if (rootPath !== ACTIVE_ROOT || ownerId !== ACTIVE_ID) return;
    activeWorkspaceTrust = { rootPath, trusted };
  });
  const workbenchOptions: WorkbenchAgentsOptions = {
    agentProviderGateway,
    agentCliDiscoveryGateway: {
      discoverAgentClis: vi.fn(async () => ({
        claudeCode: options.autoDetected
          ? ({ kind: "detected", path: "/detected/claude", version: "1.0.0" } as const)
          : ({ kind: "notFound" } as const),
        codex: { kind: "notFound" as const },
      })),
    },
    agentProviderSignInGateway: {
      startAgentProviderSignIn: vi.fn(async (request) => ({
        kind: "started" as const,
        provider: request.provider,
        providerGeneration: request.providerGeneration,
        sessionId: 77,
      })),
    },
    agentTaskGateway: agent as unknown as AgentTaskGateway,
    agentThreadStoreGateway: threadStore,
    gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
    agentModeActive: true,
    agentProjectGateways: options.withProjectGateways
      ? {
          settingsGateway,
          trustGateway: trust,
          repositoryDiscoveryGateway: discovery,
          agentRootLeaseGateway: lease,
          descriptorForRoot: (rootPath) => ({
            canonicalRoot: rootPath,
            caseSensitive: true,
            selectedPath: rootPath,
            unicodeNormalizationPolicy: "preserved",
            policy: DEFAULT_WORKSPACE_PATH_POLICY,
            workspaceId: agentRootOwnerId(rootPath),
          }),
        }
      : undefined,
    appSettingsRef,
    applyAppSettings: (settings) => {
      Object.assign(appSettings, settings);
      appSettingsRef.current = appSettings;
    },
    settingsPersistenceGateway: { saveAppSettings: vi.fn(async () => undefined) },
    settingsHydrated: true,
    workspaceSettingsRef: { current: workspaceSettings },
    gitGateway: git,
    gitIntegrationGateway: {
      getShipStatus: vi.fn(async () => Promise.reject(new Error("ship status not stubbed"))),
      pushBranchUpstream: vi.fn(async () => Promise.reject(new Error("push not stubbed"))),
      integrateWorktreeBranch: vi.fn(async () =>
        Promise.reject(new Error("integrate not stubbed")),
      ),
    },
    externalUrlOpener: null,
    gitRepositoryMappings: options.gitRepositoryMappings ?? [{ rootRelativePath: "" }],
    gitRepositoryStatuses: [],
    openDocuments: [],
    onActiveWorkspaceTrustChanged: activeTrustChanged,
    prompter: { confirm: () => true, prompt: () => null },
    reportError,
    revealTerminal,
    setSettingsInitialSection: vi.fn(),
    setSettingsOpen: vi.fn(),
    get workspaceId() {
      return activeWorkspaceId;
    },
    workspaceRoot: ACTIVE_ROOT,
    terminalGateway: {
      stop: vi.fn(async (sessionId) => ({ kind: "stopped" as const, sessionId })),
    },
    get workspaceTrust() {
      return activeWorkspaceTrust;
    },
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: WorkbenchAgentsSurface | null = null;

  function Harness() {
    current = useWorkbenchAgents(workbenchOptions);
    return null;
  }

  act(() => root.render(createElement(Harness)));

  return {
    agent,
    agentProviderGateway,
    activeTrustChanged,
    appSettings,
    git,
    lease,
    refusedLeaseRoots,
    reportError,
    revealTerminal,
    settingsGateway,
    startedRequests,
    trust,
    worktree,
    emitStatus(event: AgentTaskStatusEvent) {
      expect(statusHandler).not.toBeNull();
      statusHandler?.(event);
    },
    hook(): WorkbenchAgentsSurface {
      expect(current).not.toBeNull();
      return current as WorkbenchAgentsSurface;
    },
    rerender() {
      act(() => root.render(createElement(Harness)));
    },
    setWorkspaceId(workspaceId: string) {
      activeWorkspaceId = workspaceId;
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
