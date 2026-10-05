// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import { defaultAgentLaunchOptions, type AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurn } from "../../domain/agentThread";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { agentProjectGroups } from "./agentModePresentation";
import { AgentNewThreadDefaultsProvider } from "./AgentNewThreadDefaultsProvider";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { ClaudeModelCatalogContext } from "./useAgentClaudeModelCatalog";
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

const OTHER_ROOT = "/workspace/other";
const SERVER_ROOT = remoteAgentProjectKey("server", "runner", "project");
const ALL_PROVIDERS: Readonly<Record<AgentCliKind, boolean>> = { claudeCode: true, codex: true };

const CONFIGURED: AgentNewThreadDefaults = {
  source: "defaults",
  claudeCode: { model: "claude-opus-5", effort: "max" },
  codex: { model: "gpt-6-astra", effort: "xhigh" },
};
const RECONFIGURED: AgentNewThreadDefaults = {
  source: "defaults",
  claudeCode: { model: "claude-fable-5-1", effort: "low" },
  codex: { model: "gpt-6-luna", effort: "medium" },
};
const CONFIGURED_CLAUDE: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "claude-opus-5",
  mode: "bypassPermissions",
  effort: "max",
  context: "1m",
  fastMode: false,
  thinkingMode: false,
};
const RECONFIGURED_CLAUDE: AgentLaunchOptions = {
  ...CONFIGURED_CLAUDE,
  model: "claude-fable-5-1",
  effort: "low",
};
const CONFIGURED_CODEX: AgentLaunchOptions = {
  provider: "codex",
  model: "gpt-6-astra",
  mode: "dangerFullAccess",
  effort: "xhigh",
};
const LAST_USED: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "claude-sonnet-5",
  mode: "plan",
  effort: "low",
  context: "200k",
};
const CHOSEN_A: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "claude-sonnet-5-5",
  mode: "acceptEdits",
  effort: "medium",
  context: "1m",
};
const CHOSEN_B: AgentLaunchOptions = {
  provider: "codex",
  model: "gpt-5.6-sol",
  mode: "workspaceWrite",
  effort: "high",
};

interface Captured {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
}

interface RenderOptions {
  readonly agents?: AgentThreadsSurface;
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly providerEnabled?: Readonly<Record<AgentCliKind, boolean>>;
  readonly settings?: AgentNewThreadDefaults;
  readonly claudeCatalog?: ClaudeModelManifest;
  readonly localClaudeCliVersion?: string | null;
}

function lastUsedSource(defaults: AgentNewThreadDefaults): AgentNewThreadDefaults {
  return { ...defaults, source: "lastUsed" };
}

function otherProject(): AgentProjectDescriptor {
  return projectFixture({
    rootKey: OTHER_ROOT,
    rootPath: OTHER_ROOT,
    ownerId: "agent-root:other",
    label: "other",
    origin: "background-tab",
    repositories: [fixtureRepository(OTHER_ROOT, "")],
  });
}

function serverProject(): AgentProjectDescriptor {
  return projectFixture({
    rootKey: SERVER_ROOT,
    rootPath: SERVER_ROOT,
    ownerId: SERVER_ROOT,
    label: "server",
    origin: "background-tab",
    repositories: [],
  });
}

function promptedTurn(launch: AgentLaunchOptions): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt: "Plan the refactor",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: 1_700_000_000_500,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch,
    cliVersion: null,
  };
}

function threadWithLaunch(launch: AgentLaunchOptions): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({ thread: { ...base.thread, turns: [promptedTurn(launch)] } });
}

describe("composer launch from the new-thread defaults", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: Captured | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    agents,
    projects,
    providerEnabled,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  }) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    const navigation = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
    });
    const composer = useAgentComposerState({
      agents,
      groups,
      projects,
      providerEnabled,
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    captured = { composer, navigation };
    return null;
  }

  function render({
    agents = threadsSurfaceFixture(),
    projects = [projectFixture()],
    providerEnabled = ALL_PROVIDERS,
    settings,
    claudeCatalog = BUNDLED_CLAUDE_MODEL_MANIFEST,
    localClaudeCliVersion = null,
  }: RenderOptions = {}): void {
    act(() =>
      root.render(
        <ClaudeModelCatalogContext.Provider value={claudeCatalog}>
          <AgentNewThreadDefaultsProvider
            settings={settings}
            localClaudeCliVersion={localClaudeCliVersion}
          >
            <Harness agents={agents} projects={projects} providerEnabled={providerEnabled} />
          </AgentNewThreadDefaultsProvider>
        </ClaudeModelCatalogContext.Provider>,
      ),
    );
  }

  function composer(): AgentComposerState {
    expect(captured).not.toBeNull();
    return (captured as Captured).composer;
  }

  function navigation(): AgentThreadNavigation {
    expect(captured).not.toBeNull();
    return (captured as Captured).navigation;
  }

  function launch(): AgentLaunchOptions {
    return composer().composerProps.launch;
  }

  function openProject(rootKey: string): void {
    act(() => composer().startNewThread(rootKey, rootKey));
  }

  it("starts from the built-in launch while no defaults are stored", () => {
    render({ agents: threadsSurfaceFixture({ lastUsedLaunch: () => LAST_USED }) });

    expect(launch()).toEqual(defaultAgentComposerLaunch("claudeCode"));
  });

  it("ignores a newer last used launch of the project when the source is defaults", () => {
    render({
      agents: threadsSurfaceFixture({ lastUsedLaunch: () => LAST_USED }),
      settings: CONFIGURED,
    });

    expect(launch()).toEqual(CONFIGURED_CLAUDE);
  });

  it("keeps the last used launch of the project when the source is lastUsed", () => {
    render({
      agents: threadsSurfaceFixture({
        lastUsedLaunch: (rootKey) => (rootKey === SURFACE_FIXTURE_ROOT ? LAST_USED : null),
      }),
      projects: [projectFixture(), otherProject()],
      settings: lastUsedSource(CONFIGURED),
    });

    expect(launch()).toEqual(LAST_USED);

    openProject(OTHER_ROOT);

    expect(launch()).toEqual(CONFIGURED_CLAUDE);
  });

  it("seeds the launch from the remembered project launch and lets the user change it", () => {
    const remembered: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "default",
    };
    render({
      agents: threadsSurfaceFixture({ lastUsedLaunch: () => remembered }),
      settings: lastUsedSource(defaultAgentNewThreadDefaults()),
    });

    expect(launch()).toEqual({ ...remembered, effort: "high", context: "1m" });

    act(() => composer().composerProps.onLaunchChange(defaultAgentLaunchOptions("claudeCode")));

    expect(launch()).toEqual({
      ...defaultAgentLaunchOptions("claudeCode"),
      mode: "bypassPermissions",
      effort: "high",
    });
  });

  it("migrates legacy CLI-default launch values before they reach the composer", () => {
    render({
      agents: threadsSurfaceFixture({
        lastUsedLaunch: () => ({
          provider: "claudeCode",
          model: "default",
          mode: "default",
          effort: "default",
        }),
      }),
      settings: lastUsedSource(defaultAgentNewThreadDefaults()),
    });

    expect(launch()).toEqual({
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    });
  });

  it("uses the configured default of the provider that new threads start with", () => {
    render({ agents: threadsSurfaceFixture({ agentCliKind: "codex" }), settings: CONFIGURED });

    expect(launch()).toEqual(CONFIGURED_CODEX);
    expect(composer().composerProps.launchProvider).toBe("codex");
  });

  it("falls back to the other provider's configured default when the chosen provider is disabled", () => {
    render({ settings: CONFIGURED });
    act(() => composer().composerProps.onLaunchChange(CHOSEN_B));

    expect(launch()).toEqual(CHOSEN_B);

    render({ settings: CONFIGURED, providerEnabled: { claudeCode: true, codex: false } });

    expect(launch()).toEqual(CONFIGURED_CLAUDE);

    render({ settings: CONFIGURED });

    expect(launch()).toEqual(CHOSEN_B);
  });

  it("applies a settings change to an untouched draft and to a fresh scope", () => {
    const projects = [projectFixture(), otherProject()];
    render({ projects, settings: CONFIGURED });

    expect(launch()).toEqual(CONFIGURED_CLAUDE);

    render({ projects, settings: RECONFIGURED });

    expect(launch()).toEqual(RECONFIGURED_CLAUDE);

    openProject(OTHER_ROOT);

    expect(launch()).toEqual(RECONFIGURED_CLAUDE);
  });

  it("keeps an explicit choice of the current scope across a settings change", () => {
    const projects = [projectFixture(), otherProject()];
    render({ projects, settings: CONFIGURED });
    act(() => composer().composerProps.onLaunchChange(CHOSEN_A));

    render({ projects, settings: RECONFIGURED });

    expect(launch()).toEqual(CHOSEN_A);

    render({ projects, settings: lastUsedSource(RECONFIGURED) });

    expect(launch()).toEqual(CHOSEN_A);

    openProject(OTHER_ROOT);

    expect(launch()).toEqual(RECONFIGURED_CLAUDE);
  });

  it("keeps the choices of project A and project B apart across A, B and A again", () => {
    const projects = [projectFixture(), otherProject()];
    render({ projects, settings: CONFIGURED });
    act(() => composer().composerProps.onLaunchChange(CHOSEN_A));

    openProject(OTHER_ROOT);

    expect(launch()).toEqual(CONFIGURED_CLAUDE);

    act(() => composer().composerProps.onLaunchChange(CHOSEN_B));
    openProject(SURFACE_FIXTURE_ROOT);

    expect(launch()).toEqual(CHOSEN_A);

    openProject(OTHER_ROOT);

    expect(launch()).toEqual(CHOSEN_B);

    render({ projects, settings: RECONFIGURED });
    openProject(SURFACE_FIXTURE_ROOT);

    expect(launch()).toEqual(CHOSEN_A);
  });

  it("does not change the launch of an existing thread when the settings change", () => {
    const agents = threadsSurfaceFixture({
      lastUsedLaunch: () => LAST_USED,
      threads: [threadWithLaunch(CHOSEN_A)],
    });
    render({ agents, settings: CONFIGURED });
    act(() => navigation().selectThread("agt-1"));

    expect(launch()).toEqual(CHOSEN_A);

    render({ agents, settings: RECONFIGURED });

    expect(launch()).toEqual(CHOSEN_A);

    render({ agents, settings: lastUsedSource(RECONFIGURED) });

    expect(launch()).toEqual(CHOSEN_A);

    act(() => navigation().clearSelectedThread());

    expect(launch()).toEqual(LAST_USED);
  });

  it("starts a server draft from the same configured defaults", () => {
    const projects = [projectFixture(), serverProject()];
    render({
      agents: threadsSurfaceFixture({ lastUsedLaunch: () => LAST_USED }),
      projects,
      settings: CONFIGURED,
    });

    openProject(SERVER_ROOT);

    expect(launch()).toEqual(CONFIGURED_CLAUDE);

    render({
      agents: threadsSurfaceFixture({ lastUsedLaunch: () => LAST_USED }),
      projects,
      settings: RECONFIGURED,
    });

    expect(launch()).toEqual(RECONFIGURED_CLAUDE);
  });

  it("stops carrying a displayed last used launch to a server once the source is defaults", () => {
    const agents = threadsSurfaceFixture({
      lastUsedLaunch: (rootKey) => (rootKey === SURFACE_FIXTURE_ROOT ? LAST_USED : null),
    });
    const projects = [projectFixture(), serverProject()];
    render({ agents, projects, settings: lastUsedSource(CONFIGURED) });

    expect(launch()).toEqual(LAST_USED);

    render({ agents, projects, settings: CONFIGURED });
    openProject(SERVER_ROOT);

    expect(launch()).toEqual(CONFIGURED_CLAUDE);
  });

  it("shows the configured default on a server visited before the source became defaults", () => {
    const agents = threadsSurfaceFixture({
      lastUsedLaunch: (rootKey) => (rootKey === SURFACE_FIXTURE_ROOT ? LAST_USED : null),
    });
    const projects = [projectFixture(), serverProject()];
    render({ agents, projects, settings: lastUsedSource(CONFIGURED) });
    openProject(SERVER_ROOT);

    expect(launch()).toEqual(LAST_USED);

    render({ agents, projects, settings: CONFIGURED });

    expect(launch()).toEqual(CONFIGURED_CLAUDE);

    render({ agents, projects, settings: lastUsedSource(CONFIGURED) });

    expect(launch()).toEqual(LAST_USED);
  });

  it("keeps a launch chosen on a server when the source becomes defaults", () => {
    const agents = threadsSurfaceFixture({
      lastUsedLaunch: (rootKey) => (rootKey === SURFACE_FIXTURE_ROOT ? LAST_USED : null),
    });
    const projects = [projectFixture(), serverProject()];
    render({ agents, projects, settings: lastUsedSource(CONFIGURED) });
    openProject(SERVER_ROOT);
    act(() => composer().composerProps.onLaunchChange(CHOSEN_B));

    render({ agents, projects, settings: CONFIGURED });

    expect(launch()).toEqual(CHOSEN_B);
  });

  it("carries a displayed last used launch to a server while the source is lastUsed", () => {
    const agents = threadsSurfaceFixture({
      lastUsedLaunch: (rootKey) => (rootKey === SURFACE_FIXTURE_ROOT ? LAST_USED : null),
    });
    render({
      agents,
      projects: [projectFixture(), serverProject()],
      settings: lastUsedSource(CONFIGURED),
    });

    openProject(SERVER_ROOT);

    expect(launch()).toEqual(LAST_USED);
  });

  it("starts from the automatic Claude model when the configured model left the catalog", () => {
    const settings: AgentNewThreadDefaults = {
      ...CONFIGURED,
      claudeCode: { model: "claude-opus-4-5", effort: "max" },
    };
    const withoutModel: ClaudeModelManifest = {
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      claudeCode: BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.filter(
        (entry) => entry.choice !== "claude-opus-4-5",
      ),
    };
    render({ settings });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-opus-4-5" });

    render({ settings, claudeCatalog: withoutModel });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "default" });

    render({ settings });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-opus-4-5" });
  });

  it.each(["opus", "claude-opus-5-0"] as const)(
    "starts from the catalog choice when the configured Claude model is %s",
    (model) => {
      render({ settings: { ...CONFIGURED, claudeCode: { model, effort: "max" } } });

      expect(launch()).toEqual(CONFIGURED_CLAUDE);
    },
  );

  it("starts a local draft from the automatic Claude model when the local Claude CLI is too old", () => {
    const settings: AgentNewThreadDefaults = {
      ...CONFIGURED,
      claudeCode: { model: "claude-sonnet-5-5", effort: "max" },
    };
    render({ settings, localClaudeCliVersion: "2.1.283" });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "default" });

    render({ settings, localClaudeCliVersion: "2.1.284" });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-sonnet-5-5" });

    render({ settings, localClaudeCliVersion: null });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-sonnet-5-5" });
  });

  it("does not apply the local Claude CLI version to a server draft", () => {
    const settings: AgentNewThreadDefaults = {
      ...CONFIGURED,
      claudeCode: { model: "claude-sonnet-5-5", effort: "max" },
    };
    render({
      projects: [projectFixture(), serverProject()],
      settings,
      localClaudeCliVersion: "2.1.283",
    });

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "default" });

    openProject(SERVER_ROOT);

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "claude-sonnet-5-5" });

    openProject(SURFACE_FIXTURE_ROOT);

    expect(launch()).toEqual({ ...CONFIGURED_CLAUDE, model: "default" });
  });

  it("keeps the same launch object while renders repeat the same settings and catalog models", () => {
    const agents = threadsSurfaceFixture();
    const projects = [projectFixture()];
    render({ agents, projects, settings: { ...CONFIGURED } });
    const first = launch();

    render({
      agents,
      projects,
      settings: { ...CONFIGURED, claudeCode: { ...CONFIGURED.claudeCode } },
    });

    expect(launch()).toBe(first);

    render({
      agents,
      projects,
      settings: CONFIGURED,
      claudeCatalog: { ...BUNDLED_CLAUDE_MODEL_MANIFEST },
    });

    expect(launch()).toBe(first);

    render({ agents, projects, settings: CONFIGURED, localClaudeCliVersion: "2.1.284" });

    expect(launch()).toBe(first);

    render({ agents, projects, settings: RECONFIGURED });

    expect(launch()).not.toBe(first);
  });
});
