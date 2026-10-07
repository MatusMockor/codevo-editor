// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentCommandCatalogServerProject } from "../../domain/agentCommandCatalogTarget";
import {
  DeferredAgentCommandCatalogGateway,
  DeferredRemoteCommandCatalogGateway,
  agentCommandCatalogFixture,
} from "../../test/agentCommandCatalogTestSupport";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentCommandCatalogProvider } from "./AgentCommandCatalogProvider";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "./AgentComposerController";

const SERVER = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const PROJECT = { serverId: SERVER, runnerId: "runner-home", projectId: "codevo-editor" };
const ignore = (): void => undefined;

describe("composer controller command catalog project", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: DeferredAgentCommandCatalogGateway;
  let remote: DeferredRemoteCommandCatalogGateway;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    agentComposerDraftStore.reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = new DeferredAgentCommandCatalogGateway();
    remote = new DeferredRemoteCommandCatalogGateway();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
  });

  function controllerProps(
    executionServerId: string | null,
    commandCatalogProject: AgentCommandCatalogServerProject | null,
  ): AgentComposerControllerProps {
    return {
      executionServerId,
      composerProps: {
        draftKey: "draft",
        promptOwnerKey: "draft",
        commandCatalogProject,
        target: {
          projectLabel: "app",
          projectRoot: "/workspace/app",
          selectedRepositoryRoot: "/workspace/app",
          repositoryOptions: [],
        },
        isolation: "in-place",
        isolationReason: null,
        worktreeAvailable: true,
        worktreeOnly: false,
        worktreeOnlyReason: null,
        guard: { kind: "safe" },
        launch: { provider: "claudeCode", model: "opus", mode: "default", effort: "default" },
        launchProvider: "claudeCode",
        dispatching: false,
        mode: { kind: "new" },
        onSelectRepository: ignore,
        onIsolationChange: ignore,
        onLaunchChange: ignore,
        onNewThread: ignore,
      },
      providerManagement: unconfiguredAgentProviderManagement(),
      providerEnabled: { claudeCode: true, codex: true },
      submissionBlocked: false,
      submit: async () => true,
      onOpenProviderSettings: ignore,
    };
  }

  function render(props: AgentComposerControllerProps): void {
    act(() =>
      root.render(
        <AgentCommandCatalogProvider gateway={gateway} remoteGateway={remote}>
          <AgentComposerController {...props} />
        </AgentCommandCatalogProvider>,
      ),
    );
  }

  function textarea(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function type(value: string): void {
    act(() => {
      textarea().focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea(),
        value,
      );
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      textarea().setSelectionRange(value.length, value.length);
      textarea().dispatchEvent(new Event("select", { bubbles: true }));
    });
  }

  function optionIds(): ReadonlyArray<string> {
    return [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="Composer commands"] [role="option"]',
      ),
    ].map((row) => row.id);
  }

  it("reads the catalog of the remote project its composer state resolved", async () => {
    render(controllerProps(SERVER, PROJECT));
    expect(remote.requests()).toEqual([{ ...PROJECT, provider: "claude" }]);
    expect(gateway.reads).toHaveLength(0);
    await act(async () =>
      remote.reads[0]?.resolve(agentCommandCatalogFixture("claudeCode", [{ name: "deploy" }])),
    );
    type("/");
    expect(optionIds()).toContain("agent-composer-command-command:deploy");
    type("/dep");
    act(() =>
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      ),
    );
    expect(textarea().value).toBe("/deploy ");
    expect(agentComposerDraftStore.readDraft("draft")).toBe("/deploy ");
  });

  it("re-renders for a changed runner identity alone and never keeps the old runner's catalog", async () => {
    const stable = controllerProps(SERVER, PROJECT);
    const withProject = (
      commandCatalogProject: AgentCommandCatalogServerProject | null,
    ): AgentComposerControllerProps => ({
      ...stable,
      composerProps: { ...stable.composerProps, commandCatalogProject },
    });
    render(stable);
    await act(async () =>
      remote.reads[0]?.resolve(agentCommandCatalogFixture("claudeCode", [{ name: "deploy" }])),
    );
    type("/");
    expect(optionIds()).toContain("agent-composer-command-command:deploy");
    render(withProject({ ...PROJECT, runnerId: "runner-replaced" }));
    expect(remote.requests().map((request) => request.runnerId)).toEqual([
      "runner-home",
      "runner-replaced",
    ]);
    expect(optionIds()).not.toContain("agent-composer-command-command:deploy");
    render(withProject({ ...PROJECT }));
    expect(optionIds()).toContain("agent-composer-command-command:deploy");
    render(withProject({ ...PROJECT, projectId: "codevo-runner" }));
    expect(optionIds()).not.toContain("agent-composer-command-command:deploy");
    render(withProject({ ...PROJECT, serverId: "another-server" }));
    expect(remote.reads).toHaveLength(3);
    render(withProject(null));
    expect(optionIds()).not.toContain("agent-composer-command-command:deploy");
    expect(optionIds()).toHaveLength(8);
    expect(remote.reads).toHaveLength(3);
  });

  it("asks nobody while the server composer has no resolved project", () => {
    render(controllerProps(SERVER, null));
    type("/");
    expect(optionIds()).toHaveLength(8);
    expect(remote.reads).toHaveLength(0);
    expect(gateway.reads).toHaveLength(0);
  });

  it("ignores a resolved server project while the composer targets this machine", () => {
    render(controllerProps(null, PROJECT));
    expect(gateway.requests()).toEqual([
      { repositoryRoot: "/workspace/app", provider: "claudeCode" },
    ]);
    expect(remote.reads).toHaveLength(0);
  });
});
