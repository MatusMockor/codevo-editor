import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "../../application/agentTurnAttachments";
import { DISABLED_AGENT_SESSION_RESTORE } from "./useAgentSessionRestore";
import type { LocalProjectCloneGateway } from "../../application/ports/localProjectCloneGateway";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../../domain/remoteRunner";
import type {
  RepositoryHostsSnapshot,
  RepositoryLookupOutcome,
} from "../../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { WorkspaceTrustDialogHost } from "../projects/WorkspaceTrustDialogHost";
import { WorkspaceTrustPromptCoordinator } from "../../application/workspaceTrustPrompt";
import type { WorkspaceTrustOrigin } from "../../domain/trust";
import { waitForReact } from "../../test/reactTestLifecycle";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import {
  controlledInvoke,
  dictationTestPorts,
  flushAsync,
  installFakeBrowserAudio,
  type FakeBrowserAudio,
} from "../../test/speechDictationTestSupport";
import { installFakeAudioInputs } from "../../test/audioInputDevicesTestSupport";
import { createSpeechDictationPorts } from "../../infrastructure/speechDictationComposition";
import type { SpeechInputSetting } from "../../domain/speechDictationInputSetting";
import { dictationUtterance } from "./dictation/agentComposerDictationTestSupport";
import { dictationRemoteGateway } from "./dictation/dictationRemoteGatewayTestSupport";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentWorkbenchLayout } from "../../application/useAgentWorkbenchLayout";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { agentWorkbenchHydration } from "../../application/useWorkbenchControllerAgents";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import {
  defaultAgentProviderPreferences,
  type PersistedAgentProviderSettingsAuthority,
} from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import { shortcutForCommand } from "../../domain/keymap";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import {
  initialAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeWorkspaceSettings,
  WORKSPACE_SESSION_VERSION,
} from "../../domain/settings";
import { classicTerminalTheme } from "../../domain/editorColorThemes";
import type {
  RevealPathGateway,
  RevealPathRequest,
} from "../../infrastructure/tauriRevealPathGateway";
import {
  recordedLayoutState,
  type RecordedAgentWorkbenchLayout,
} from "./agentWorkbenchChromeTestFixtures";
import {
  attachmentImagesSurfaceFixture,
  composerAttachmentsSurfaceFixture,
  externalSessionsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { agentShortcutGlyphs } from "./agentThreadHeaderPresentation";
import { PREVIEW_REVEAL_DELAY_MS } from "./useDeferredPreviewReveal";
import {
  ADD_PROJECT_REFUSED_REASON,
  AgentWorkbenchScreen,
  SEARCH_FILES_COMMAND,
  type AgentWorkbenchScreenProps,
  type AgentWorkbenchScreenWorkbench,
} from "./AgentWorkbenchScreen";

const resolveTauriWorkspaceHome = vi.hoisted(() =>
  vi.fn(async () => ({ path: "/Users/dev", pathCase: "insensitive" as const })),
);
vi.mock("../../infrastructure/tauriHomeDirectory", () => ({ resolveTauriWorkspaceHome }));
vi.mock("../../infrastructure/webviewAgentImageSurface", () => ({
  WebviewAgentImageSurface: class {
    decode = async () => ({ width: 64, height: 64 });
    encodeMime = async () => "image/jpeg" as const;
    encode = async () => new ArrayBuffer(16);
    release = () => undefined;
  },
}));

const ROOT_A = "/workspace/app";
const ORDERS_ENTRY = { name: "orders.ts", path: `${ROOT_A}/orders.ts`, kind: "file" as const };
const ROOT_B = "/workspace/api";

describe("AgentWorkbenchScreen", () => {
  let host: HTMLDivElement;
  let root: Root;
  let reveals: RevealPathRequest[];
  let revealPathGateway: RevealPathGateway;
  let directoryListingGateway: DirectoryListingGateway;
  let dictationAudio: FakeBrowserAudio | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    reveals = [];
    revealPathGateway = {
      revealPath: async (request) => {
        reveals.push(request);
      },
    };
    directoryListingGateway = {
      listDirectoryEntries: async ({ path }) =>
        path === "/Users/dev/Developer"
          ? { path, parent: "/Users/dev", entries: [], truncated: false }
          : {
              path: "/Users/dev",
              parent: "/Users",
              entries: [{ name: "Developer", kind: "directory", hidden: false }],
              truncated: false,
            },
      revealDirectory: async () => undefined,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
    vi.unstubAllGlobals();
    dictationAudio?.restore();
    dictationAudio = null;
  });

  it("isolates a reused thread ID in another workspace and restores the original project selection", async () => {
    render(createWorkbench(ROOT_A));

    click('[data-thread-id="agt-1"]');
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();

    render(createWorkbench(ROOT_B));
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();

    render(createWorkbench(ROOT_A));
    await act(async () => {});
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
    expect(host.querySelector('[data-thread-id="agt-1"]')).not.toBeNull();
  });

  it("respects an external editor workspace switch without reactivating the old thread project", async () => {
    const first = createWorkbench(ROOT_A);
    render(first);
    click('[data-thread-id="agt-1"]');
    const next = createWorkbench(ROOT_B);
    render(next);
    await act(async () => {});
    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(next.openWorkspaceRootWithReceipt).not.toHaveBeenCalled();
    expect(currentPaletteProjectLabel()).toBe(project(ROOT_B).label);
  });

  it("projects the workbench scripts and keymap onto the thread header controls", () => {
    render(createWorkbench(ROOT_A));
    click('[data-thread-id="agt-1"]');

    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="dev (running elsewhere)"]'),
    ).not.toBeNull();
    expect(host.querySelector('button[aria-label="Toggle terminal panel"]')).not.toBeNull();
  });

  it("opens the Git surface from the rail footer", () => {
    const workbench = createWorkbench(ROOT_A);
    render(workbench);

    click('button[aria-label="Open Source Control"]');

    expect(workbench.agentWorkbench.actions).toEqual([{ kind: "openSurface", surface: "git" }]);
    expect(workbench.setSidebarView).not.toHaveBeenCalled();
  });

  it("opens Environments settings from the execution picker", () => {
    const openSettingsSection = vi.fn();
    render(createWorkbench(ROOT_A, { openSettingsSection }));

    click('button[aria-label^="Workspace: "]');
    const manage = [
      ...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
    ].find((button) => button.textContent === "Manage environments");
    expect(manage).toBeDefined();
    act(() => manage?.click());

    expect(openSettingsSection).toHaveBeenCalledWith("environments");
  });

  it("opens Settings > Usage from the rail footer", () => {
    const openSettingsSection = vi.fn();
    render(createWorkbench(ROOT_A, { openSettingsSection }));

    click('button[aria-label="Open Usage"]');

    expect(openSettingsSection).toHaveBeenCalledWith("usage");
    expect(document.querySelector('[role="dialog"][aria-label="Usage details"]')).toBeNull();
  });

  it("keeps provider runtime UI on persisted authority until registration succeeds", () => {
    const preferences = defaultAgentProviderPreferences();
    const initialPreferences = {
      ...preferences,
      codex: { ...preferences.codex, enabled: false },
    };
    let authorities: Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>> = {
      claudeCode: providerAuthority("claudeCode", 1, true),
      codex: providerAuthority("codex", 1, false),
    };
    let selectedProviderAuthority: AgentProviderManagementSurface["selectedProviderAuthority"] = {
      settingsRevision: 1,
      provider: "claudeCode",
    };
    const management = providerManagement({
      authority: (provider) => authorities[provider] ?? null,
      admissionAuthority: (provider) => ({
        provider,
        revision: 1,
        disposition: { kind: "ready" },
        cliPath: `/usr/local/bin/${provider}`,
        providerGeneration: 1,
      }),
    });
    Object.defineProperty(management, "selectedProviderAuthority", {
      get: () => selectedProviderAuthority,
    });
    const persistedAgents = {
      ...surface(ROOT_A),
      agentCliKind: "claudeCode" as const,
      providerManagement: management,
    };
    const persistedSettings = {
      ...defaultAppSettings(),
      agentCliKind: "claudeCode" as const,
      agentProviderPreferences: initialPreferences,
    };

    render(createWorkbench(ROOT_A, { agents: persistedAgents, appSettings: persistedSettings }));

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("Claude Sonnet 5");
    expect(prompt().disabled).toBe(false);
    click('button[aria-label="Agent model"]');
    expect(host.querySelector('button[aria-label="Claude Code models"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Codex models"]')).toBeNull();

    authorities = {};
    const pendingPreferences = {
      ...initialPreferences,
      claudeCode: { ...initialPreferences.claudeCode, enabled: false },
    };
    const pendingAgents = { ...persistedAgents, agentCliKind: "codex" as const };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("Claude Sonnet 5");
    expect(modelPicker().disabled).toBe(false);
    expect(prompt().disabled).toBe(false);
    expect(host.querySelector('button[aria-label="Claude Code models"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Codex models"]')).toBeNull();

    authorities = {
      claudeCode: providerAuthority("claudeCode", 2, true),
      codex: providerAuthority("codex", 1, false),
    };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(modelPicker().textContent).toContain("Claude Sonnet 5");
    expect(prompt().disabled).toBe(false);

    selectedProviderAuthority = { settingsRevision: 3, provider: "codex" };
    authorities = {
      claudeCode: providerAuthority("claudeCode", 2, false),
      codex: providerAuthority("codex", 1, false),
    };
    render(
      createWorkbench(ROOT_A, {
        agents: pendingAgents,
        appSettings: {
          ...persistedSettings,
          agentCliKind: "codex",
          agentProviderPreferences: pendingPreferences,
        },
      }),
    );

    expect(providerFooter("claudeCode")).toBeNull();
    expect(providerFooter("codex")).toBeNull();
    expect(modelPicker().textContent).toContain("GPT-6.1-Sol");
    expect(modelPicker().disabled).toBe(true);
    expect(prompt().disabled).toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]')?.disabled,
    ).toBe(true);

    selectedProviderAuthority = null;
    authorities = {};
    render(
      createWorkbench(ROOT_A, {
        agents: persistedAgents,
        appSettings: persistedSettings,
      }),
    );

    expect(providerFooter("claudeCode")).not.toBeNull();
    expect(modelPicker().textContent).toContain("Claude Sonnet 5");
    expect(prompt().disabled).toBe(false);
  });

  it("starts the composer from the new-thread defaults of the app settings and follows a change", () => {
    const agents = surface(ROOT_A);
    const settings = {
      ...defaultAppSettings(),
      agentNewThreadDefaults: {
        source: "defaults",
        claudeCode: { model: "claude-opus-5", effort: "max" },
        codex: { model: "gpt-6-astra", effort: "xhigh" },
      },
    } as const;

    render(createWorkbench(ROOT_A, { agents, appSettings: settings }));

    expect(modelPicker().dataset.value).toBe("claude-opus-5");

    render(
      createWorkbench(ROOT_A, {
        agents,
        appSettings: {
          ...settings,
          agentNewThreadDefaults: {
            ...settings.agentNewThreadDefaults,
            claudeCode: { model: "claude-fable-5-1", effort: "low" },
          },
        },
      }),
    );

    expect(modelPicker().dataset.value).toBe("claude-fable-5-1");
  });

  it("falls back to the automatic Claude model while the detected Claude CLI is too old for the default", () => {
    const appSettings = {
      ...defaultAppSettings(),
      agentNewThreadDefaults: {
        source: "defaults",
        claudeCode: { model: "claude-sonnet-5-5", effort: "max" },
        codex: { model: "default", effort: "default" },
      },
    } as const;
    const withClaudeCli = (version: string) => ({
      ...surface(ROOT_A),
      providerManagement: providerManagement({
        cliDiscovery: {
          ...defaultAgentCliDiscoveryResult(),
          claudeCode: { kind: "detected", path: "/usr/local/bin/claude", version },
        },
      }),
    });

    render(createWorkbench(ROOT_A, { agents: withClaudeCli("2.1.283"), appSettings }));

    expect(modelPicker().dataset.value).toBe("claude-sonnet-5");

    render(createWorkbench(ROOT_A, { agents: withClaudeCli("2.1.284"), appSettings }));

    expect(modelPicker().dataset.value).toBe("claude-sonnet-5-5");
  });

  it("toggles the bottom panel through the controller authority only", () => {
    const layout = recordedLayoutState();
    const hidden = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false });
    render(hidden);

    click('button[aria-label="Toggle terminal panel"]');
    expect(hidden.showBottomPanelView).toHaveBeenCalledWith("terminal");
    expect(hidden.hideBottomPanel).not.toHaveBeenCalled();

    const visible = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: true });
    render(visible);
    click('button[aria-label="Toggle terminal panel"]');
    expect(visible.hideBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps an unchanged drawer view the controller shows again in the agent layout", () => {
    const layout = recordedLayoutState();
    render(
      createWorkbench(ROOT_A, {
        agentWorkbench: layout,
        bottomPanelView: "problems",
        bottomPanelVisible: false,
      }),
    );

    const opened = createWorkbench(ROOT_A, {
      agentWorkbench: layout,
      bottomPanelView: "problems",
      bottomPanelVisible: true,
    });
    render(opened);
    expect(opened.showBottomPanelView).not.toHaveBeenCalled();

    const closed = createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false });
    render(closed);
    expect(closed.showBottomPanelView).not.toHaveBeenCalled();
    expect(layout.actions).toEqual([]);
  });

  it("keeps a view the controller opened together with the panel", () => {
    const layout = recordedLayoutState();
    render(createWorkbench(ROOT_A, { agentWorkbench: layout, bottomPanelVisible: false }));

    const problems = createWorkbench(ROOT_A, {
      agentWorkbench: layout,
      bottomPanelView: "problems",
      bottomPanelVisible: true,
    });
    render({ ...problems, bottomPanelView: "terminal" });
    expect(problems.showBottomPanelView).not.toHaveBeenCalled();
  });

  it("applies a persisted open bottom panel once at hydration", () => {
    const layout = recordedLayoutState();
    const workbench = createWorkbench(ROOT_A, {
      agentWorkbench: layout,
      bottomPanelVisible: false,
    });
    render(workbench);
    expect(workbench.showBottomPanelView).not.toHaveBeenCalled();

    const hydrated = createWorkbench(ROOT_A, {
      agentWorkbench: recordedLayoutState({}, true),
      bottomPanelVisible: false,
    });
    render(hydrated);
    expect(hydrated.showBottomPanelView).toHaveBeenCalledWith("terminal");

    const settled = createWorkbench(ROOT_A, {
      agentWorkbench: recordedLayoutState({}, true),
      bottomPanelView: "terminal",
      bottomPanelVisible: true,
    });
    render(settled);
    render({ ...settled, bottomPanelVisible: false });
    render({ ...settled, bottomPanelVisible: false });
    expect(settled.showBottomPanelView).not.toHaveBeenCalled();
    expect(layout.actions).toEqual([]);
  });

  it("restores the persisted terminal panel from the normalized workspace settings", async () => {
    const settings = normalizeWorkspaceSettings({
      session: {
        version: WORKSPACE_SESSION_VERSION,
        agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
      },
    });
    expect(settings.session.agentWorkbench?.bottomPanel).toBe(true);

    const workbench = createWorkbench(ROOT_A, { bottomPanelVisible: false });
    function Hydrated({ terminalShown }: { readonly terminalShown: boolean }) {
      const { agentWorkbench } = useAgentWorkbenchLayout({
        workspaceOwnerKey: ROOT_A,
        hasWorkspace: true,
        bottomPanelVisible: terminalShown,
        hydration: agentWorkbenchHydration(ROOT_A, settings),
      });
      return (
        <AgentWorkbenchScreen
          {...defaultProps({
            ...workbench,
            agentWorkbench,
            bottomPanelView: terminalShown ? "terminal" : "problems",
            bottomPanelVisible: terminalShown,
          })}
        />
      );
    }

    await act(async () => root.render(<Hydrated terminalShown={false} />));

    expect(workbench.showBottomPanelView).toHaveBeenCalledTimes(1);
    expect(workbench.showBottomPanelView).toHaveBeenCalledWith("terminal");

    await act(async () => root.render(<Hydrated terminalShown={true} />));
    await act(async () => root.render(<Hydrated terminalShown={true} />));

    expect(workbench.showBottomPanelView).toHaveBeenCalledTimes(1);
  });

  it("does not leak a persisted open panel across a workspace switch", () => {
    render(
      createWorkbench(ROOT_A, {
        agentWorkbench: recordedLayoutState({}, true),
        bottomPanelVisible: true,
      }),
    );

    const other = createWorkbench(ROOT_B, {
      agentWorkbench: recordedLayoutState(),
      bottomPanelVisible: true,
    });
    render(other);

    expect(other.showBottomPanelView).not.toHaveBeenCalled();
  });

  it("hints the Quick Open chord on the Files surface search field", () => {
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    const workbench = createWorkbench(ROOT_A, { agentWorkbench: layout });
    render(workbench);
    click('[data-thread-id="agt-1"]');

    expect(host.querySelector('input[aria-label="Search workspace files"]')).not.toBeNull();
    expect(host.querySelector(".cv-files__search .cv-kbd")?.textContent).toBe(
      agentShortcutGlyphs(shortcutForCommand(defaultAppSettings().keymap, SEARCH_FILES_COMMAND)),
    );
    expect(workbench.runCommand).not.toHaveBeenCalledWith(SEARCH_FILES_COMMAND);
    expect(layout.actions).toEqual([]);
  });

  it("searches Files through the injected workspace file search gateway", async () => {
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    const searchFiles = vi.fn(async (root: string, _query: string) => [
      { name: "users.ts", path: `${root}/users.ts`, relativePath: "users.ts" },
    ]);
    const workbench = createWorkbench(ROOT_A, { agentWorkbench: layout });
    act(() =>
      root.render(
        <AgentWorkbenchScreen {...defaultProps(workbench)} fileSearch={{ searchFiles }} />,
      ),
    );
    click('[data-thread-id="agt-1"]');
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search workspace files"]',
    );
    expect(input?.disabled).toBe(false);
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "users",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitForReact(() => expect(searchFiles).toHaveBeenCalledOnce());
    expect(searchFiles.mock.calls[0]?.[1]).toBe("users");
  });

  it("reveals a single-clicked Files entry only after the double-click window", async () => {
    const { layout, previewFile, workbench, row } = await renderFilesTree();

    click(row);
    await act(async () => Promise.resolve());
    expect(previewFile).toHaveBeenCalledExactlyOnceWith(ORDERS_ENTRY);
    expect(editorReveals(layout)).toBe(0);

    await waitForReact(() => expect(editorReveals(layout)).toBe(1));
    expect(workbench.openPinnedFile).not.toHaveBeenCalled();
  });

  it("pins a double-clicked Files entry and reveals the editor exactly once", async () => {
    const { layout, previewFile, workbench, row } = await renderFilesTree();

    click(row);
    await act(async () => Promise.resolve());
    expect(editorReveals(layout)).toBe(0);
    const target = host.querySelector<HTMLElement>(row);
    act(() => {
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      target?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });
    await act(
      async () => new Promise((resolve) => setTimeout(resolve, PREVIEW_REVEAL_DELAY_MS * 2)),
    );

    expect(previewFile).toHaveBeenCalledExactlyOnceWith(ORDERS_ENTRY);
    expect(workbench.openPinnedFile).toHaveBeenCalledExactlyOnceWith(ORDERS_ENTRY);
    expect(editorReveals(layout)).toBe(1);
  });

  async function renderFilesTree() {
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    const previewFile = vi.fn(async () => true);
    const openPinnedFile = vi.fn(async () => true);
    const workbench = {
      ...createWorkbench(ROOT_A, { agentWorkbench: layout }),
      openPinnedFile,
      previewFile,
    };
    act(() =>
      root.render(
        <AgentWorkbenchScreen
          {...defaultProps(workbench)}
          files={{ readDirectory: async (path) => (path === ROOT_A ? [ORDERS_ENTRY] : []) }}
        />,
      ),
    );
    click('[data-thread-id="agt-1"]');
    const row = '.tree-row[title$="orders.ts"]';
    await waitForReact(() => expect(host.querySelector(row)).not.toBeNull());
    return { layout, previewFile, workbench, row };
  }

  it("opens the Scripts surface from the scripts menu", async () => {
    const layout = recordedLayoutState();
    const workbench = createWorkbench(ROOT_A, { agentWorkbench: layout });
    render(workbench);
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Choose a script"]');
    await act(async () => {});
    clickMenuItem("Open Scripts and Tasks");

    expect(layout.actions).toContainEqual({ kind: "openSurface", surface: "scripts" });
    expect(layout.actions).not.toContainEqual({ kind: "openSurface", surface: "files" });
    expect(workbench.setSidebarView).not.toHaveBeenCalled();
  });

  it("reveals a worktree path through the injected gateway", async () => {
    render(createWorkbench(ROOT_A));
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Open options"]');
    await act(async () => {});
    clickMenuItem("Reveal in Finder");
    await act(async () => {});

    expect(reveals).toEqual([{ rootPath: ROOT_A, path: ROOT_A }]);
  });

  it("reports a reveal outside the project roots in the notice bar", async () => {
    render(createWorkbench(ROOT_A, { agents: surface(ROOT_A, "/elsewhere/agt-1") }));
    click('[data-thread-id="agt-1"]');

    click('button[aria-label="Open options"]');
    await act(async () => {});
    clickMenuItem("Reveal in Finder");
    await act(async () => {});

    expect(reveals).toEqual([]);
    expect(host.textContent).toContain("Unable to reveal that path in the file manager.");
  });

  describe("project switcher with background workspace tabs", () => {
    const EDITOR = "/Users/dev/Developer/editor";
    const CRM = "/Users/dev/Developer/ebox-crm";
    const PLAYABLE = "/Users/dev/Developer/playablemaker";

    function identitySetup(
      active: string,
      admitted: ReadonlySet<string>,
      openWorkspaceRootWithReceipt: MockedWorkbench["openWorkspaceRootWithReceipt"],
    ): MockedWorkbench {
      const workbench = createWorkbench(active, { openWorkspaceRootWithReceipt });
      const labels = new Map([
        [EDITOR, "editor"],
        [CRM, "ebox-crm"],
        [PLAYABLE, "playablemaker"],
      ]);
      const ownerId = (root: string) =>
        admitted.has(root) ? `workspace-${labels.get(root)}` : agentRootOwnerId(root);
      const base = threadView(EDITOR, null);
      const ownedThread = (threadId: string, root: string): AgentThreadView => ({
        ...base,
        thread: {
          ...base.thread,
          threadId,
          title: `Thread in ${labels.get(root)}`,
          owner: { rootKey: root, ownerId: `workspace-${labels.get(root)}`, repositoryRoot: root },
        },
      });
      return {
        ...workbench,
        agents: {
          ...workbench.agents,
          threads: [
            ownedThread("agt-editor", EDITOR),
            ownedThread("agt-crm", CRM),
            ownedThread("agt-playable", PLAYABLE),
          ],
          agentProjects: {
            ...workbench.agents.agentProjects,
            projects: [EDITOR, CRM, PLAYABLE].map((root) => ({
              ...project(root),
              ownerId: ownerId(root),
              label: labels.get(root) ?? "",
              origin: root === active ? ("active-tab" as const) : ("background-tab" as const),
            })),
          },
        },
      } as MockedWorkbench;
    }

    function railProjectNames(): ReadonlyArray<string> {
      return [...host.querySelectorAll(".agent-rail .cv-sb-project__name")].map(
        (node) => node.textContent ?? "",
      );
    }

    function switcherLabels(): ReadonlyArray<string> {
      return [
        ...document.querySelectorAll<HTMLElement>('[role="option"] .cv-project-switch__label'),
      ].map((label) => label.textContent ?? "");
    }

    function chooseProject(label: string): void {
      click(".agent-rail .cv-sb-switch");
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.querySelector(".cv-project-switch__label")?.textContent === label,
      );
      expect(option, `Missing project ${label}`).toBeDefined();
      act(() => option?.click());
    }

    function tabHarness(setup: (active: string, admitted: ReadonlySet<string>) => MockedWorkbench) {
      const tabs: string[] = [];
      const pending: Array<() => void> = [];
      const admitted = new Set([EDITOR]);
      const show = (active: string) => {
        const workbench = setup(active, new Set(admitted));
        workbench.activateWorkspaceTab = vi.fn((path: string) => {
          tabs.push(path);
          return new Promise<void>((resolve) => pending.push(resolve));
        }) as MockedWorkbench["activateWorkspaceTab"];
        render(workbench);
        return workbench;
      };
      const settle = async () => {
        await act(async () => pending.shift()?.());
      };
      const follow = async (path: string) => {
        show(path);
        await settle();
        admitted.add(path);
        show(path);
        await act(async () => {});
      };
      return { tabs, show, settle, follow };
    }

    it("switches the editor tab like clicking it when a background project is picked", async () => {
      const opening = vi.fn() as unknown as MockedWorkbench["openWorkspaceRootWithReceipt"];
      const harness = tabHarness((active, admitted) => identitySetup(active, admitted, opening));
      harness.show(EDITOR);
      await act(async () => {});
      click('[data-thread-id="agt-editor"]');
      await act(async () => {});

      click(".agent-rail .cv-sb-switch");
      expect(switcherLabels()).toEqual(["All projects", "editor", "ebox-crm", "playablemaker"]);
      click(".agent-rail .cv-sb-switch");

      chooseProject("playablemaker");
      expect(harness.tabs).toEqual([PLAYABLE]);
      await harness.follow(PLAYABLE);
      expect(currentPaletteProjectLabel()).toBe("playablemaker");
      expect(railProjectNames()).toEqual(["playablemaker"]);

      chooseProject("ebox-crm");
      expect(harness.tabs).toEqual([PLAYABLE, CRM]);
      await harness.follow(CRM);
      expect(currentPaletteProjectLabel()).toBe("ebox-crm");

      chooseProject("editor");
      expect(harness.tabs).toEqual([PLAYABLE, CRM, EDITOR]);
      await harness.follow(EDITOR);
      expect(currentPaletteProjectLabel()).toBe("editor");
      expect(host.querySelector('section[aria-label="Agent thread agt-editor"]')).not.toBeNull();
    });

    it("keeps all projects and reports it when the editor tab does not switch", async () => {
      const opening = vi.fn() as unknown as MockedWorkbench["openWorkspaceRootWithReceipt"];
      const harness = tabHarness((active, admitted) => identitySetup(active, admitted, opening));
      harness.show(EDITOR);
      await act(async () => {});

      chooseProject("playablemaker");
      expect(harness.tabs).toEqual([PLAYABLE]);
      await harness.settle();

      expect(host.textContent).toContain("Could not switch to playablemaker.");
      expect(railProjectNames()).toEqual(["editor", "ebox-crm", "playablemaker"]);
      expect(currentPaletteProjectLabel()).toBe("editor");
    });

    it("switches the editor tab from a project name in the tree", async () => {
      const opening = vi.fn() as unknown as MockedWorkbench["openWorkspaceRootWithReceipt"];
      const harness = tabHarness((active, admitted) => identitySetup(active, admitted, opening));
      harness.show(EDITOR);
      await act(async () => {});

      const name = [...host.querySelectorAll<HTMLButtonElement>(".cv-sb-project__select")].find(
        (button) => button.querySelector(".cv-sb-project__name")?.textContent === "ebox-crm",
      );
      expect(name).toBeDefined();
      act(() => name?.click());

      expect(harness.tabs).toEqual([CRM]);
      await harness.follow(CRM);
      expect(currentPaletteProjectLabel()).toBe("ebox-crm");
    });
  });

  it("opens the browsed directory through the workspace open flow", async () => {
    const workbench = createWorkbench(ROOT_A);
    render(workbench);

    click('button[aria-label="Add project"]');
    act(() => {
      const source = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
        option.textContent?.includes("Open folder"),
      );
      expect(source).toBeDefined();
      source!.click();
    });
    await act(async () => {});
    await openAddProjectDeveloper();

    const input = host.querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
      );
    });

    expect(workbench.openWorkspaceRootWithReceipt).toHaveBeenCalledWith("/Users/dev/Developer");
  });

  it.each([false, true])(
    "selects an added project after keyed remount and delayed descriptor (empty rail: %s)",
    async (emptyRail) => {
      const next = createWorkbench(ROOT_B);
      const result = await next.openWorkspaceRootWithReceipt(ROOT_B);
      let complete: (
        result: Awaited<ReturnType<AgentWorkbenchScreenWorkbench["openWorkspaceRootWithReceipt"]>>,
      ) => void = () => undefined;
      const pending = new Promise<
        Awaited<ReturnType<AgentWorkbenchScreenWorkbench["openWorkspaceRootWithReceipt"]>>
      >((resolve) => {
        complete = resolve;
      });
      const opening = vi.fn(() => pending);
      const first = createWorkbench(ROOT_A, { openWorkspaceRootWithReceipt: opening });
      render(first);
      click('[data-thread-id="agt-1"]');
      click('button[aria-label="Add project"]');
      act(() => {
        const source = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (option) => option.textContent?.includes("Open folder"),
        );
        expect(source).toBeDefined();
        source!.click();
      });
      await act(async () => {});
      await openAddProjectDeveloper();
      await act(async () => {
        host
          .querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]')
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
          );
      });
      expect(opening).toHaveBeenCalledWith("/Users/dev/Developer");
      const nextAgents = {
        ...next.agents,
        agentProjects: {
          ...next.agents.agentProjects,
          projects: emptyRail ? [] : [{ ...project(ROOT_A), origin: "background-tab" as const }],
        },
      };
      render({ ...next, agents: nextAgents, openWorkspaceRootWithReceipt: opening });
      await act(async () => complete(result));
      expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
      render({
        ...next,
        openWorkspaceRootWithReceipt: opening,
        agents: {
          ...nextAgents,
          agentProjects: {
            ...nextAgents.agentProjects,
            projects: [
              { ...project(ROOT_A), origin: "background-tab" },
              { ...project(ROOT_B), ownerId: "workspace-app", label: "api" },
            ],
          },
        },
      });
      expect(currentPaletteProjectLabel()).toBe("api");
    },
  );

  it.each([false, true])(
    "retains a remote clone draft across local workspace remounts and continues on its exact server project (ack pending: %s)",
    async (pendingAcknowledgement) => {
      const { gateway, finishClone } = gatewayFixture();
      let acknowledge: (job: RemoteRunnerCloneJob) => void = () => undefined;
      if (pendingAcknowledgement)
        gateway.cloneProject.mockImplementationOnce(
          () =>
            new Promise<RemoteRunnerCloneJob>((resolve) => {
              acknowledge = resolve;
            }),
        );
      const lookup = lookupGatewayFixture();
      const startThread = vi.fn(async () => ({ threadId: "must-not-start" }));
      const opening = vi.fn();
      const show = async (path: string) => {
        const workbench = createWorkbench(path, { openWorkspaceRootWithReceipt: opening });
        await act(async () =>
          root.render(
            <RemoteRunnerProvider gateway={gateway} repositoryLookup={lookup}>
              <AgentWorkbenchScreen
                {...defaultProps({ ...workbench, agents: { ...workbench.agents, startThread } })}
              />
            </RemoteRunnerProvider>,
          ),
        );
      };
      const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        act(() => {
          const prototype =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      await show(ROOT_A);
      click('button[aria-label="Add project"]');
      const environment = document.querySelector<HTMLElement>(
        'button[title="Where the project lives"]',
      );
      expect(environment).not.toBeNull();
      act(() => environment!.click());
      const serverOption = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
      ].find((option) => option.textContent?.includes("Linux server"));
      expect(serverOption).toBeDefined();
      act(() => serverOption!.click());
      chooseAddProjectSource("Clone repository");
      const gitUrl = () =>
        [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
          row.textContent?.includes("Git URL"),
        );
      await waitForReact(() => expect(gitUrl()?.getAttribute("aria-disabled")).toBe("false"));
      act(() => gitUrl()!.click());
      const urlInput = () =>
        host.querySelector<HTMLInputElement>(".agent-remote-add-project .palette-search input")!;
      await waitForReact(() => expect(urlInput()?.placeholder).toBe("Enter Git clone URL"));
      type(urlInput(), CLONE_URL);
      act(() =>
        urlInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
      );
      await waitForReact(() =>
        expect(host.querySelector(".agent-remote-add-project__primary")?.textContent).toBe(
          "Clone on server",
        ),
      );
      click(".agent-remote-add-project__primary");
      await waitForReact(() => expect(gateway.cloneProject).toHaveBeenCalledOnce());
      if (pendingAcknowledgement) {
        await show(ROOT_B);
        await act(async () => acknowledge(runningClone));
        expect(host.querySelector(".agent-clone-composer")).toBeNull();
        await waitForReact(() =>
          expect(host.querySelector('[aria-label="Repository clone"]')).not.toBeNull(),
        );
        click(".agent-rail-clone__name");
      }
      await waitForReact(() =>
        expect(host.querySelector(".agent-clone-composer textarea")).not.toBeNull(),
      );
      type(
        host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")!,
        "Remote clone draft",
      );
      await show(ROOT_B);
      await show(ROOT_A);
      expect(opening).not.toHaveBeenCalled();
      expect(host.querySelector(".agent-rail-clone__name")).not.toBeNull();
      click(".agent-rail-clone__name");
      expect(host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")?.value).toBe(
        "Remote clone draft",
      );
      finishClone();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1600));
      });
      await waitForReact(() =>
        expect(host.querySelector(".agent-clone-composer")?.textContent).not.toContain("Cloning"),
      );
      await act(async () => {});
      expect(prompt().value).toBe("Remote clone draft");
      expect(host.querySelector('[aria-label="Repository clone"]')?.textContent).toContain(
        "storefront-api",
      );
      expect(opening).not.toHaveBeenCalled();
      expect(startThread).not.toHaveBeenCalled();
      expect(gateway.createTask).not.toHaveBeenCalled();
      expect(gateway.cloneProject).toHaveBeenCalledOnce();
    },
  );

  it("retains a server new-thread image draft with its text across a real keyed workspace remount", async () => {
    const { gateway } = gatewayFixture();
    gateway.getRunner.mockResolvedValue(LAUNCHABLE_RUNNER);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:server-draft";
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const show = async (path: string) => {
      const workbench = createWorkbench(path);
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <AgentWorkbenchScreen {...defaultProps(workbench)} />
          </RemoteRunnerProvider>,
        ),
      );
    };
    await show(ROOT_A);
    await chooseServerProject();
    typeInto(prompt(), "Look at this screenshot");
    pasteImage(prompt());
    await waitForReact(() =>
      expect(host.querySelector('[data-agent-attachment-state="ready"]')).not.toBeNull(),
    );

    await show(ROOT_B);
    expect(host.querySelector("[data-agent-attachment-state]")).toBeNull();
    await show(ROOT_A);
    await chooseServerProject();
    await waitForReact(() => expect(prompt().value).toBe("Look at this screenshot"));
    expect(host.querySelector('[data-agent-attachment-state="ready"]')).not.toBeNull();
    expect(host.textContent).not.toContain(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:server-draft");
    expect(gateway.uploadAttachment).not.toHaveBeenCalled();
    expect(gateway.createTask).not.toHaveBeenCalled();
  });

  it("keeps a running clone and its draft across A to B to A navigation", async () => {
    agentComposerDraftStore.reset();
    let finish = false;
    let cloneId = "";
    const gateway: LocalProjectCloneGateway = {
      start: vi.fn<LocalProjectCloneGateway["start"]>(async (request) => {
        cloneId = request.idempotencyKey;
        return {
          cloneId,
          status: "running",
          path: ROOT_B,
          error: null,
          progress: null,
          failure: null,
        };
      }),
      get: vi.fn<LocalProjectCloneGateway["get"]>(async () =>
        finish
          ? {
              cloneId,
              status: "completed",
              path: ROOT_B,
              error: null,
              progress: null,
              failure: null,
            }
          : {
              cloneId,
              status: "running",
              path: ROOT_B,
              error: null,
              progress: null,
              failure: null,
            },
      ),
      cancel: vi.fn(async () => {
        throw new Error("Unexpected cancellation");
      }),
    };
    const startThread = vi.fn(async () => ({ threadId: "must-not-start" }));
    const destination = createWorkbench(ROOT_B);
    const receipt = await destination.openWorkspaceRootWithReceipt(ROOT_B);
    const opening = vi.fn(async () => {
      root.render(
        <AgentWorkbenchScreen
          {...defaultProps({
            ...destination,
            agents: { ...destination.agents, startThread },
            openWorkspaceRootWithReceipt: opening,
          })}
          localCloneGateway={gateway}
        />,
      );
      return receipt;
    });
    const show = async (path: string) => {
      const workbench = createWorkbench(path, { openWorkspaceRootWithReceipt: opening });
      await act(async () =>
        root.render(
          <AgentWorkbenchScreen
            {...defaultProps({ ...workbench, agents: { ...workbench.agents, startThread } })}
            localCloneGateway={gateway}
          />,
        ),
      );
    };
    const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      act(() => {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await show(ROOT_A);
    click('button[aria-label="Add project"]');
    chooseAddProjectSource("Git URL");
    await submitLocalCloneForm("https://github.com/example/api.git");
    await waitForReact(() =>
      expect(host.querySelector(".agent-clone-composer textarea")).not.toBeNull(),
    );
    type(
      host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")!,
      "Keep this running clone draft",
    );
    await show(ROOT_B);
    await show(ROOT_A);
    expect(opening).not.toHaveBeenCalled();
    expect(gateway.cancel).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-rail-clone__name")).not.toBeNull();
    click(".agent-rail-clone__name");
    expect(host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")?.value).toBe(
      "Keep this running clone draft",
    );
    finish = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    await waitForReact(() => expect(opening.mock.calls.length === 1).toBe(true));
    await act(async () => {});
    expect(opening).toHaveBeenCalledExactlyOnceWith(ROOT_B);
    expect(prompt().value).toBe("Keep this running clone draft");
    expect(agentComposerDraftStore.readDraft(`clone:local:${cloneId}`)).toBe(
      "Keep this running clone draft",
    );
    expect(startThread).not.toHaveBeenCalled();
    expect(gateway.start).toHaveBeenCalledOnce();
  });

  it.each(["", "Existing destination draft"])(
    "retains clone draft across a real keyed workspace remount (destination: %s)",
    async (existing) => {
      agentComposerDraftStore.reset();
      agentComposerDraftStore.writeDraft(`new:${ROOT_B}`, existing);
      const startThread = vi.fn(async () => ({ threadId: "must-not-start" }));
      const next = createWorkbench(ROOT_B);
      const receipt = await next.openWorkspaceRootWithReceipt(ROOT_B);
      let resolveReceipt!: (value: typeof receipt) => void;
      const pendingReceipt = new Promise<typeof receipt>((resolve) => {
        resolveReceipt = resolve;
      });
      const cloneStart = vi.fn<LocalProjectCloneGateway["start"]>(async (request) => ({
        cloneId: request.idempotencyKey,
        status: "completed",
        path: ROOT_B,
        error: null,
        progress: null,
        failure: null,
      }));
      const gateway: LocalProjectCloneGateway = {
        start: cloneStart,
        get: vi.fn(async () => {
          throw new Error("Clone already completed");
        }),
        cancel: vi.fn(async () => {
          throw new Error("Not canceled");
        }),
      };
      const opening = vi.fn(() => {
        root.render(
          <AgentWorkbenchScreen
            {...defaultProps({
              ...next,
              agents: { ...next.agents, startThread },
              openWorkspaceRootWithReceipt: opening,
            })}
            localCloneGateway={gateway}
          />,
        );
        return pendingReceipt;
      });
      const first = createWorkbench(ROOT_A, { openWorkspaceRootWithReceipt: opening });
      await act(async () =>
        root.render(
          <AgentWorkbenchScreen
            {...defaultProps({ ...first, agents: { ...first.agents, startThread } })}
            localCloneGateway={gateway}
          />,
        ),
      );
      const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        act(() => {
          const prototype =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      click('button[aria-label="Add project"]');
      chooseAddProjectSource("Git URL");
      await submitLocalCloneForm("https://github.com/example/api.git");
      await waitForReact(() =>
        expect(host.querySelector(".agent-clone-composer textarea")).not.toBeNull(),
      );
      type(
        host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")!,
        "Cloned project draft",
      );
      await waitForReact(() => expect(opening).toHaveBeenCalledOnce());
      const cloneId = cloneStart.mock.calls[0]![0].idempotencyKey;
      await act(async () => {});
      expect(opening).toHaveBeenCalledWith(ROOT_B);
      // The old AgentModeView has unmounted before the open receipt settles.
      expect(host.querySelector(".agent-clone-composer")).not.toBeNull();
      await act(async () => resolveReceipt(receipt));
      await waitForReact(() => expect(prompt().value).toBe("Cloned project draft"));
      expect(host.querySelector('[aria-label="Repository clone"]')).not.toBeNull();
      expect(agentComposerDraftStore.readDraft(`new:${ROOT_B}`)).toBe(existing);
      expect(agentComposerDraftStore.readDraft(`clone:local:${cloneId}`)).toBe(
        "Cloned project draft",
      );
      expect(startThread).not.toHaveBeenCalled();
      agentComposerDraftStore.reset();
    },
  );

  it("shows the clone source in the trust dialog and resolves the clone home without a HOME listing", async () => {
    agentComposerDraftStore.reset();
    const listDirectoryEntries = vi.fn(directoryListingGateway.listDirectoryEntries);
    directoryListingGateway = { ...directoryListingGateway, listDirectoryEntries };
    resolveTauriWorkspaceHome.mockClear();
    const prompt = new WorkspaceTrustPromptCoordinator();
    const next = createWorkbench(ROOT_B);
    const receipt = await next.openWorkspaceRootWithReceipt(ROOT_B);
    const grantProjectTrust = vi.fn(
      async (rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void> => {
        await prompt.request({
          rootPath: rootKey,
          label: "api",
          origin: origin ?? { kind: "local" },
        });
      },
    );
    const gateway: LocalProjectCloneGateway = {
      start: vi.fn<LocalProjectCloneGateway["start"]>(async (request) => ({
        cloneId: request.idempotencyKey,
        status: "completed",
        path: ROOT_B,
        error: null,
        progress: null,
        failure: null,
      })),
      get: vi.fn(async () => {
        throw new Error("Clone already completed");
      }),
      cancel: vi.fn(async () => {
        throw new Error("Not canceled");
      }),
    };
    const destination: AgentWorkbenchScreenWorkbench = {
      ...next,
      agents: {
        ...next.agents,
        agentProjects: {
          ...next.agents.agentProjects,
          projects: [{ ...project(ROOT_B), ownerId: "workspace-app", trust: "untrusted" }],
          grantProjectTrust,
        },
      },
    };
    const screen = (workbench: AgentWorkbenchScreenWorkbench) => (
      <>
        <AgentWorkbenchScreen {...defaultProps(workbench)} localCloneGateway={gateway} />
        <WorkspaceTrustDialogHost prompt={prompt} workspaceScope={null} />
      </>
    );
    const opening = vi.fn(async () => {
      root.render(screen({ ...destination, openWorkspaceRootWithReceipt: opening }));
      return receipt;
    });
    await act(async () =>
      root.render(screen(createWorkbench(ROOT_A, { openWorkspaceRootWithReceipt: opening }))),
    );
    click('button[aria-label="Add project"]');
    chooseAddProjectSource("Git URL");
    await submitLocalCloneForm("https://github.com/example/api.git");
    await waitForReact(() => expect(opening).toHaveBeenCalledOnce());
    await waitForReact(() =>
      expect(
        [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Review",
        ),
      ).toBeDefined(),
    );
    act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Review")!
        .click(),
    );
    await waitForReact(() =>
      expect(document.querySelector(".cv-trust__origin")?.textContent).toBe(
        "Cloned from github.com/example/api",
      ),
    );
    expect(grantProjectTrust).toHaveBeenCalledExactlyOnceWith(ROOT_B, {
      kind: "clone",
      host: "github.com",
      path: "example/api",
    });
    await waitForReact(() => expect(resolveTauriWorkspaceHome).toHaveBeenCalled());
    expect(listDirectoryEntries).not.toHaveBeenCalledWith(expect.objectContaining({ path: null }));
    agentComposerDraftStore.reset();
  });

  it("scopes the header to the cloned project and keeps its workspace open after the clone", async () => {
    agentComposerDraftStore.reset();
    const next = createWorkbench(ROOT_B);
    const receipt = await next.openWorkspaceRootWithReceipt(ROOT_B);
    const gateway: LocalProjectCloneGateway = {
      start: vi.fn<LocalProjectCloneGateway["start"]>(async (request) => ({
        cloneId: request.idempotencyKey,
        status: "completed",
        path: ROOT_B,
        error: null,
        progress: null,
        failure: null,
      })),
      get: vi.fn(async () => {
        throw new Error("Clone already completed");
      }),
      cancel: vi.fn(async () => {
        throw new Error("Not canceled");
      }),
    };
    const destination: AgentWorkbenchScreenWorkbench = {
      ...next,
      agents: {
        ...next.agents,
        agentProjects: {
          ...next.agents.agentProjects,
          projects: [
            { ...project(ROOT_A), origin: "background-tab" },
            {
              ...project(ROOT_B),
              ownerId: "workspace-app",
              label: "api",
              trust: "untrusted",
            },
          ],
        },
      },
    };
    const opening = vi.fn(async () => {
      await act(async () =>
        root.render(
          <AgentWorkbenchScreen
            {...defaultProps({ ...destination, openWorkspaceRootWithReceipt: opening })}
            localCloneGateway={gateway}
          />,
        ),
      );
      return receipt;
    });
    await act(async () =>
      root.render(
        <AgentWorkbenchScreen
          {...defaultProps(createWorkbench(ROOT_A, { openWorkspaceRootWithReceipt: opening }))}
          localCloneGateway={gateway}
        />,
      ),
    );
    click('button[aria-label="Add project"]');
    chooseAddProjectSource("Git URL");
    await submitLocalCloneForm("https://github.com/example/api.git");
    await waitForReact(() =>
      expect(
        [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Review",
        ),
      ).toBeDefined(),
    );
    await act(async () => {});
    expect(host.querySelector(".agent-clone-composer")).not.toBeNull();
    expect(
      host.querySelector('nav[aria-label="Thread breadcrumb"] button')?.getAttribute("aria-label"),
    ).toBe("New thread in api");
    expect(opening).toHaveBeenCalledExactlyOnceWith(ROOT_B);
  });

  it("reports the refusal when the workspace open flow declines the directory", async () => {
    const workbench = createWorkbench(ROOT_A, {
      openWorkspaceRootWithReceipt: vi.fn(async () => ({
        outcome: { kind: "failed" as const, requestToken: 1 },
        isCurrent: () => false,
      })),
    });
    render(workbench);

    click('button[aria-label="Add project"]');
    act(() => {
      const source = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
        option.textContent?.includes("Open folder"),
      );
      expect(source).toBeDefined();
      source!.click();
    });
    await act(async () => {});
    await openAddProjectDeveloper();

    const input = host.querySelector<HTMLInputElement>('.agent-add-project input[role="combobox"]');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }),
      );
    });
    await act(async () => {});

    expect(workbench.openWorkspaceRootWithReceipt).toHaveBeenCalledWith("/Users/dev/Developer");
    expect(host.textContent).toContain(ADD_PROJECT_REFUSED_REASON);
  });

  it("updates branch checkout availability immediately after saving and dispatch settlement", async () => {
    const dirty = {
      path: `${ROOT_A}/file.ts`,
      name: "file.ts",
      language: "typescript",
      content: "draft",
      savedContent: "saved",
    };
    const gateway: NonNullable<AgentWorkbenchScreenProps["gitHistoryGateway"]> = {
      getRepoStatus: async () => ({ gitAvailable: true, isRepository: true }),
      getBranches: async () => ({ current: "main", local: ["main", "feature"], remotes: {} }),
      getCommitLog: async () => [],
      getCommitDetails: async () => {
        throw new Error("unused");
      },
      getCommitFiles: async () => [],
      getCommitDiff: async () => {
        throw new Error("unused");
      },
    };
    let workbench = createWorkbench(ROOT_A, {
      openDocuments: [dirty],
      workspaceTrust: { rootPath: ROOT_A, trusted: true },
      agentWorkbench: recordedLayoutState({
        rightPanel: "open",
        openSurfaces: ["history"],
        activeSurface: "history",
      }),
    });
    const mutation = {
      createBranch: vi.fn(async () => undefined),
      getBranches: vi.fn(async () => ({ current: null, local: [], remotes: {} })),
      switchBranch: vi.fn(async () => undefined),
    };
    const show = async () => {
      await act(async () =>
        root.render(
          <AgentWorkbenchScreen
            {...defaultProps(workbench)}
            gitHistoryGateway={gateway}
            gitBranchGateway={mutation}
          />,
        ),
      );
    };
    await show();
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="History branch"]')).not.toBeNull(),
    );
    click('[aria-label="History branch"]');
    const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.includes("feature"),
    );
    expect(option).toBeDefined();
    await act(async () => option?.click());
    const switchButton = () =>
      [...host.querySelectorAll("button")].find(
        (item) => item.textContent === "Switch to this branch",
      );
    await waitForReact(() => expect(switchButton()).toBeDefined());
    expect(switchButton()?.disabled).toBe(true);
    workbench = { ...workbench, openDocuments: [{ ...dirty, savedContent: "draft" }] };
    await show();
    expect(switchButton()?.disabled).toBe(false);
    workbench = { ...workbench, agents: { ...workbench.agents, dispatching: true } };
    await show();
    expect(switchButton()?.disabled).toBe(true);
    workbench = { ...workbench, agents: { ...workbench.agents, dispatching: false } };
    await show();
    expect(switchButton()?.disabled).toBe(false);
    expect(mutation.switchBranch).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<AgentWorkbenchScreenWorkbench>]>([
    ["Settings covers the workbench", { settingsOpen: true }],
    ["the editor layout replaces the agent layout", { agentModeActive: false }],
    [
      "the maximized right panel covers the thread",
      { agentWorkbench: recordedLayoutState({ rightPanel: "open", rightPanelMaximized: true }) },
    ],
  ])("stops dictation and keeps the captured speech when %s", async (_name, hidden) => {
    const audio = installFakeBrowserAudio({ sampleRate: 16000 });
    dictationAudio = audio;
    const speech = controlledInvoke();
    const gateway = dictationRemoteGateway(
      [{ id: "speech", connected: true, speechTranscription: true }],
      speech,
    );
    const ports = dictationTestPorts(gateway);
    const workbench = createWorkbench(ROOT_A);
    const show = (next: AgentWorkbenchScreenWorkbench): void =>
      act(() =>
        root.render(
          <RemoteRunnerProvider gateway={gateway} speechDictation={ports}>
            <AgentWorkbenchScreen {...defaultProps(next)} />
          </RemoteRunnerProvider>,
        ),
      );
    const microphone = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>(".agent-dictation__button");
    show(workbench);
    await waitForReact(() =>
      expect(microphone()?.getAttribute("aria-label")).toBe("Start dictation"),
    );
    act(() => microphone()?.click());
    await act(() => flushAsync());
    act(() => audio.emit(dictationUtterance()));
    expect(audio.microphoneLive()).toBe(true);

    show({ ...workbench, ...hidden });

    expect(audio.microphoneLive()).toBe(false);
    expect(speech.calls).toHaveLength(1);
    await act(async () => {
      speech.calls[0]?.resolve({ text: "said before the view was hidden" });
      await flushAsync();
    });
    expect(prompt().value).toBe("said before the view was hidden");
    act(() => microphone()?.click());
    await act(() => flushAsync());
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);

    show(workbench);
    act(() => microphone()?.click());
    await act(() => flushAsync());
    expect(audio.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("dictates from the microphone chosen in the app settings from the next start on", async () => {
    const inputs = installFakeAudioInputs({ granted: true, sampleRate: 16000 });
    dictationAudio = inputs.audio;
    const gateway = dictationRemoteGateway(
      [{ id: "speech", connected: true, speechTranscription: true }],
      controlledInvoke(),
    );
    const ports = createSpeechDictationPorts(gateway);
    const workbench = createWorkbench(ROOT_A);
    const show = (speechDictationInput: SpeechInputSetting): void =>
      act(() =>
        root.render(
          <RemoteRunnerProvider gateway={gateway} speechDictation={ports}>
            <AgentWorkbenchScreen
              {...defaultProps({
                ...workbench,
                appSettings: { ...workbench.appSettings, speechDictationInput },
              })}
            />
          </RemoteRunnerProvider>,
        ),
      );
    const microphone = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>(".agent-dictation__button");
    const toggle = async (): Promise<void> => {
      act(() => microphone()?.click());
      await act(() => flushAsync());
    };
    show({ kind: "device", id: "studio-1", label: "Studio Mic" });
    await waitForReact(() =>
      expect(microphone()?.getAttribute("aria-label")).toBe("Start dictation"),
    );
    await toggle();
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1"]);

    show({ kind: "system-default" });

    expect(inputs.audio.microphoneLive()).toBe(true);
    expect(inputs.streams[0]?.tracks.every((track) => !track.stopped)).toBe(true);
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1"]);

    await toggle();
    expect(inputs.audio.microphoneLive()).toBe(false);
    await toggle();
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1", null]);
  });

  function render(workbench: AgentWorkbenchScreenWorkbench): void {
    act(() => root.render(<AgentWorkbenchScreen {...defaultProps(workbench)} />));
  }

  function defaultProps(workbench: AgentWorkbenchScreenWorkbench): AgentWorkbenchScreenProps {
    return { ...baseProps(workbench), directoryListingGateway, revealPathGateway };
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }

  function modelPicker(): HTMLButtonElement {
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Agent model"]');
    expect(picker).not.toBeNull();
    return picker!;
  }

  function prompt(): HTMLTextAreaElement {
    const textarea = host.querySelector<HTMLTextAreaElement>("#agent-prompt");
    expect(textarea).not.toBeNull();
    return textarea!;
  }

  function providerFooter(provider: AgentCliKind): HTMLElement | null {
    return host.querySelector(`[data-provider="${provider}"]`);
  }

  function clickMenuItem(label: string): void {
    const item = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item, `Missing menu item ${label}`).not.toBeUndefined();
    act(() => item?.click());
  }

  async function chooseServerProject(): Promise<void> {
    const local = host.querySelector<HTMLElement>('[aria-label="Run on: This computer"]');
    if (local !== null) {
      act(() => local.click());
      const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (entry) => entry.textContent?.includes("Linux server"),
      );
      expect(option, "Missing Linux server option").toBeDefined();
      act(() => option?.click());
    }
    const projectSelect = () =>
      host.querySelector<HTMLSelectElement>('[aria-label="Choose server project"] select');
    await waitForReact(() =>
      expect(projectSelect() !== null || prompt().disabled === false).toBe(true),
    );
    const select = projectSelect();
    if (select !== null) {
      act(() => {
        select.value = "remote:linux:runner:project";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await waitForReact(() => expect(prompt().disabled).toBe(false));
  }

  function typeInto(element: HTMLTextAreaElement, value: string): void {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function pasteImage(element: HTMLTextAreaElement): void {
    const file = new File([new Uint8Array(16)], "clipboard.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(16) });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [file], getData: () => "" },
    });
    act(() => element.dispatchEvent(event));
  }
});

const CLONE_SUBMIT = '.cv-clone-form button[type="submit"]';

function chooseAddProjectSource(title: string): void {
  const source = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
    option.textContent?.includes(title),
  );
  expect(source, title).toBeDefined();
  act(() => source!.click());
}

async function submitLocalCloneForm(url: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="Enter Git clone URL or owner/repo"]',
  );
  expect(input).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, url);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitForReact(() =>
    expect(document.querySelector<HTMLButtonElement>(CLONE_SUBMIT)?.disabled).toBe(false),
  );
  act(() => document.querySelector<HTMLButtonElement>(CLONE_SUBMIT)!.click());
}

async function openAddProjectDeveloper(): Promise<void> {
  await waitForReact(() => {
    expect(document.querySelector('.agent-add-project [role="option"]')).not.toBeNull();
  });
  act(() => document.querySelector<HTMLElement>('.agent-add-project [role="option"]')?.click());
  await waitForReact(() => {
    expect(document.querySelector(".agent-add-project__path-value")?.textContent).toBe(
      "~/Developer",
    );
  });
}

function baseProps(workbench: AgentWorkbenchScreenWorkbench): AgentWorkbenchScreenProps {
  return {
    activeFileRevealSignal: 0,
    fileChanges: null,
    fileStatusesByPath: {},
    files: { readDirectory: async () => [] },
    monacoTheme: "calm-dark",
    onResizeRightPanelStart: () => undefined,
    onTrustWorkspace: () => undefined,
    terminalGateway: {
      acknowledgeStart: async () => undefined,
      listProfiles: async () => [],
      resize: async () => undefined,
      start: async () => ({ kind: "starting", sessionId: 1 }),
      stop: async (sessionId) => ({ kind: "stopped", sessionId }),
      stopRoot: async () => undefined,
      stopAll: async () => undefined,
      subscribeOutput: async () => () => undefined,
      writeInput: async () => undefined,
    },
    terminalTheme: classicTerminalTheme("classicDark"),
    sessionRestore: DISABLED_AGENT_SESSION_RESTORE,
    workbench,
  };
}

type MockedWorkbench = AgentWorkbenchScreenWorkbench & {
  readonly openWorkspaceRootWithReceipt: ReturnType<typeof vi.fn>;
  readonly agentWorkbench: RecordedAgentWorkbenchLayout;
  readonly hideBottomPanel: ReturnType<typeof vi.fn>;
  readonly runCommand: ReturnType<typeof vi.fn>;
  readonly setSidebarView: ReturnType<typeof vi.fn>;
  readonly showBottomPanelView: ReturnType<typeof vi.fn>;
};

function createWorkbench(
  workspaceRoot: string,
  overrides: Partial<AgentWorkbenchScreenWorkbench> = {},
): MockedWorkbench {
  const nodePackageScripts = {
    scripts: [
      {
        key: "package.json:dev",
        manifestRelativePath: "package.json",
        packageName: "app",
        packageManager: "npm",
        packageRootRelativePath: "",
        scriptName: "dev",
      },
    ],
    truncated: false,
    available: true,
    error: null,
    pending: true,
    task: {
      runId: "run-1",
      workspaceId: "workspace-app",
      manifestRelativePath: "package.json",
      scriptName: "dev",
      status: "acquiring-terminal",
      sessionId: null,
    },
    run: vi.fn(() => true),
    stop: vi.fn(),
  } as unknown as AgentWorkbenchScreenWorkbench["nodePackageScripts"];

  return {
    activePath: null,
    agentWorkbench: recordedLayoutState(),
    agents: surface(workspaceRoot),
    appSettings: defaultAppSettings(),
    bottomPanelView: "problems",
    bottomPanelVisible: false,
    hideBottomPanel: vi.fn(),
    nodePackageScripts,
    openPinnedFile: vi.fn(),
    openProblemNotice: vi.fn(async () => true),
    openWorkspaceRootWithReceipt: vi.fn(async () => ({
      isCurrent: () => true,
      outcome: {
        kind: "opened" as const,
        receipt: {
          kind: "registeredWorkspaceOpenReceipt" as const,
          canonicalRoot: workspaceRoot,
          workspaceId: "workspace-app",
          selectedPath: workspaceRoot,
          requestToken: 1,
          admissionGeneration: 1,
          admissionToken: 1,
          descriptor: {
            canonicalRoot: workspaceRoot,
            caseSensitive: true,
            selectedPath: workspaceRoot,
            unicodeNormalizationPolicy: "preserved" as const,
            workspaceId: "workspace-app",
          },
        },
      },
    })),
    previewFile: vi.fn(),
    runCommand: vi.fn(() => "executed" as const),
    setSidebarView: vi.fn(),
    showBottomPanelView: vi.fn(),
    workspaceIdentityDescriptor: {
      canonicalRoot: workspaceRoot,
      caseSensitive: true,
      selectedPath: workspaceRoot,
      unicodeNormalizationPolicy: "preserved",
      workspaceId: "workspace-app",
    } as AgentWorkbenchScreenWorkbench["workspaceIdentityDescriptor"],
    workspaceRoot,
    workspaceSettings: defaultWorkspaceSettings(),
    ...overrides,
  } as MockedWorkbench;
}

function surface(
  workspaceRoot: string,
  worktreePath: string | null = null,
): WorkbenchAgentsSurface {
  return {
    ...threadsSurface(workspaceRoot, worktreePath),
    accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
    externalSessions: externalSessionsSurfaceFixture(),
    providerManagement: providerManagement(),
    providerSignIn: {
      states: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      terminalIntents: { claudeCode: null, codex: null },
      blockedReason: () => null,
      isActive: () => false,
      request: () => false,
      cancelStart: () => undefined,
      start: async () => null,
      settle: async () => undefined,
    },
    agentProjects: {
      projects: [project(workspaceRoot)],
      overflowRootPaths: [],
      refreshProject: async () => undefined,
      trustProject: async () => undefined,
      releaseProject: async () => undefined,
      ensureProjectLease: async () => true,
      launchIdentityForProject: () => ({ workspaceId: "workspace-id", generation: 1 }),
      isCurrentRepositoryOwner: () => true,
      noteDispatchTrustRejected: () => undefined,
    },
  };
}

function providerManagement(
  overrides: Partial<AgentProviderManagementSurface> = {},
): AgentProviderManagementSurface {
  return {
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 0,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    }),
    authority: () => null,
    dismissToast: () => undefined,
    dismissUpdate: async () => false,
    refresh: async () => undefined,
    refreshAll: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
    ...overrides,
    cliDiscovery: overrides.cliDiscovery ?? defaultAgentCliDiscoveryResult(),
  };
}

function providerAuthority(
  provider: AgentCliKind,
  settingsRevision: number,
  enabled: boolean,
): PersistedAgentProviderSettingsAuthority {
  return {
    provider,
    settingsRevision,
    preference: {
      enabled,
      healthCheckIntervalSeconds: 300,
      checkForUpdates: false,
      dismissedUpdateVersion: null,
    },
    cliPath: `/usr/local/bin/${provider}`,
  };
}

function project(root: string): AgentProjectDescriptor {
  return {
    rootKey: root,
    rootPath: root,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: root, repositoryRelativePath: "" },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function threadsSurface(root: string, worktreePath: string | null): AgentThreadsSurface {
  return {
    attachments: composerAttachmentsSurfaceFixture(),
    attachmentImages: attachmentImagesSurfaceFixture(),
    revealAttachment: async () => undefined,
    threads: [threadView(root, worktreePath)],
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: root, repositoryRelativePath: "" },
    ],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    agentCliKind: "claudeCode",
    agentCliVersion: null,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    pendingTurnCount: () => 0,
    isolationPreview: (repositoryRoot: string) => ({
      repositoryRoot,
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: true,
      confirmationKey: null,
    }),
    refreshIsolationStatus: async () => undefined,
    startThread: async () => ({ threadId: "agt-default" }),
    sendFollowUp: async () => true,
    deferredFollowUps: new Map(),
    steer: async () => "sent" as const,
    removeDeferredFollowUp: () => undefined,
    importExternalSession: async () => null,
    stop: async () => undefined,
    togglePin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
    hasLiveTasksForOwner: () => false,
    stopProjectTasks: async () => undefined,
    releaseProjectTasks: () => undefined,
    removeOrphanedWorktree: async () => undefined,
    pruneOrphanedWorktrees: async () => undefined,
    showChanges: async () => undefined,
    hideChanges: () => undefined,
    showFileDiff: async () => undefined,
    hideFileDiff: () => undefined,
    removeWorktree: async () => undefined,
    refreshShipStatus: async () => undefined,
    commitThreadChanges: async () => ({ kind: "succeeded" }),
    pushThreadBranch: async () => ({ kind: "succeeded" }),
    openThreadCompareUrl: async () => undefined,
    integrateThreadBranch: async () => undefined,
    removeThreadWorktree: async () => undefined,
    resetThreadShip: () => undefined,
    openChangedFile: async () => undefined,
    openChangedFileDiff: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    markThreadViewed: () => undefined,
    markThreadUnread: () => undefined,
    renameThread: () => undefined,
    threadCopyDetail: () => null,
    lastUsedLaunch: () => null,
  };
}

function threadView(root: string, worktreePath: string | null): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: root, ownerId: "agent-root:app", repositoryRoot: root },
    target:
      worktreePath === null
        ? { isolation: "in-place", worktreePath: null }
        : { isolation: "worktree", worktreePath },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "Refactor the parser",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_700_000_000_000,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

const CLONE_URL = "git@github.com:acme/storefront-api.git";
const LAUNCHABLE_RUNNER = {
  protocolVersion: 1 as const,
  runnerId: "runner",
  name: "Linux server",
  capabilities: {
    taskExecution: true,
    instructionSync: true,
    eventReplay: true,
    taskContinuation: true,
    taskLaunchOptions: true,
  },
};

const runningClone: RemoteRunnerCloneJob = {
  id: "clone-1",
  status: "running",
  project: null,
  error: null,
};

const succeededClone: RemoteRunnerCloneJob = {
  ...runningClone,
  status: "succeeded",
  project: { id: "cloned", name: "storefront-api" },
};

const hostsSnapshot: RepositoryHostsSnapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: { status: "ready", hosts: [], truncated: false },
};

function lookupGatewayFixture(): RepositoryLookupGateway {
  return {
    listHosts: vi.fn(async () => hostsSnapshot),
    lookup: vi.fn(async (): Promise<RepositoryLookupOutcome> => ({ status: "notFound" })),
  };
}

function gatewayFixture() {
  const projects = [{ id: "project", name: "Server app" }];
  let cloneFinished = false;
  const cloneProject = vi.fn(async () => runningClone);
  const gateway = {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn().mockResolvedValue([
      {
        id: "linux",
        name: "Linux server",
        host: "linux",
        username: "codex",
        port: 22,
        connected: true,
      },
    ]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux server",
      capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
    }),
    listProjects: vi.fn(async () => ({ items: [...projects] })),
    cloneProject,
    getProjectClone: vi.fn(async () => (cloneFinished ? succeededClone : runningClone)),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway & { cloneProject: typeof cloneProject };
  const finishClone = () => {
    cloneFinished = true;
    projects.push({ id: "cloned", name: "storefront-api" });
  };
  return { gateway, finishClone };
}

function editorReveals(layout: RecordedAgentWorkbenchLayout): number {
  return layout.actions.filter(
    (action) => action.kind === "openSurface" && action.surface === "editor",
  ).length;
}

function currentPaletteProjectLabel(): string | null {
  const palette = workbenchAgentPaletteProvider.current();
  return palette?.projects.find((entry) => entry.current)?.label ?? null;
}
