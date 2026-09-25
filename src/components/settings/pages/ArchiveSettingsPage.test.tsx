// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadOpener,
  AgentThreadOpenerSource,
} from "../../../application/agentThreadOpener";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { createPaletteProviderSlot } from "../../../application/commandPalette/commandPaletteProvider";
import type { AgentProviderSignInSurface } from "../../../application/useAgentProviderSignIn";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../../domain/settings";
import { settingsEnvironment } from "../settingsEnvironment";
import type { SettingsAgentActivity } from "../settingsPageProps";
import { ArchiveSettingsPage } from "./ArchiveSettingsPage";
import { ARCHIVE_PAGE_SIZE } from "./archivePresentation";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

function threadView(threadId: string, title: string, archived: boolean): AgentThreadView {
  return {
    repositoryLabel: "orders-api",
    thread: {
      threadId,
      title,
      archived,
      createdAtEpochMs: Date.now(),
      owner: { rootKey: "/work/orders-api" },
    },
  } as unknown as AgentThreadView;
}

function archivedViews(count: number, label = "orders-api"): ReadonlyArray<AgentThreadView> {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    repositoryLabel: label,
    thread: {
      threadId: `${label}-${index}`,
      title: `Thread ${index}`,
      archived: true,
      createdAtEpochMs: now - index * 60_000,
      owner: { rootKey: `/work/${label}` },
    },
  })) as unknown as ReadonlyArray<AgentThreadView>;
}

describe("ArchiveSettingsPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    threads: ReadonlyArray<AgentThreadView>,
    unarchive = vi.fn(),
    openThread: SettingsAgentActivity["openThread"] = undefined,
  ) {
    const agentActivity: SettingsAgentActivity = {
      threads,
      accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      turnLog: null,
      refreshAccountUsage: vi.fn(),
      unarchive,
      openThread,
    };
    const props = settingsPagePropsFixture({ env: { agentActivity } });
    act(() => root.render(<ArchiveSettingsPage {...props} />));
  }

  function buttonNamed(name: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((node) => node.textContent === name);
  }

  it("unarchives a thread", () => {
    const unarchive = vi.fn();
    render(archivedViews(1), unarchive);
    expect(host.querySelector(".settings-section__title")?.textContent).toBe("orders-api");
    expect(host.textContent).toContain("Thread 0");
    act(() => buttonNamed("Unarchive")?.click());
    expect(unarchive).toHaveBeenCalledWith("orders-api-0");
  });

  it("opens an archived thread without unarchiving it", () => {
    const unarchive = vi.fn();
    const openThread = vi.fn();
    render(archivedViews(1), unarchive, openThread);

    act(() => buttonNamed("Open")?.click());

    expect(openThread).toHaveBeenCalledWith("orders-api-0");
    expect(unarchive).not.toHaveBeenCalled();
  });

  it("hides Open when the agent view cannot open threads", () => {
    render(archivedViews(1));

    expect(buttonNamed("Open")).toBeUndefined();
    expect(buttonNamed("Unarchive")).toBeDefined();
  });

  it("pages long project groups", () => {
    render(archivedViews(ARCHIVE_PAGE_SIZE + 3));
    expect(host.querySelectorAll(".settings-row").length).toBe(ARCHIVE_PAGE_SIZE);
    act(() => buttonNamed("Show 3 more")?.click());
    expect(host.querySelectorAll(".settings-row").length).toBe(ARCHIVE_PAGE_SIZE + 3);
    expect(buttonNamed("Show 3 more")).toBeUndefined();
  });

  it("shows an empty state", () => {
    render([]);
    expect(host.textContent).toContain("No archived threads.");
    expect(host.querySelector('[data-settings-row="archive.threads"]')).not.toBeNull();
  });

  it("explains when agent data is not loaded and keeps the search anchor", () => {
    const props = settingsPagePropsFixture({ env: { agentActivity: null } });
    act(() => root.render(<ArchiveSettingsPage {...props} />));
    expect(host.textContent).toContain("Archived threads appear after agent mode has loaded.");
    expect(host.querySelector('[data-settings-row="archive.threads"]')).not.toBeNull();
  });

  function workbenchEnvironment(
    unarchive: () => Promise<boolean>,
    setSettingsOpen: (open: boolean) => void,
    agentThreadOpener: AgentThreadOpenerSource | null,
  ) {
    return settingsEnvironment({
      agentThreadOpener,
      appUpdater: null,
      providerManagement: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workbench: {
        appSettings: defaultAppSettings(),
        closeNodeLaunchConfigurations: vi.fn(),
        gitRepositoryMappings: [],
        nodeLaunchConfigurationsOpen: false,
        openNodeLaunchConfigurations: vi.fn(),
        openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
        phpTools: null,
        restartJavaScriptTypeScriptService: vi.fn(async () => undefined),
        saveWorkbenchSettings: vi.fn(async () => undefined),
        settingsInitialSection: "archive",
        settingsOpen: true,
        setSettingsOpen,
        workspaceDescriptor: null,
        workspaceIdentityDescriptor: null,
        workspaceRoot: null,
        workspaceSettings: defaultWorkspaceSettings(),
        workspaceTrust: null,
        agents: {
          providerSignIn: {} as AgentProviderSignInSurface,
          threads: [
            threadView("live", "Live thread", false),
            threadView("old", "Archived thread", true),
          ],
          accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
          turnLog: null,
          refreshAccountUsage: vi.fn(),
          unarchive,
        },
      },
    });
  }

  it("opens the archived thread in agent mode and closes settings without unarchiving", () => {
    const unarchive = vi.fn(async () => true);
    const setSettingsOpen = vi.fn();
    const opener = createPaletteProviderSlot<AgentThreadOpener>();
    const openThread = vi.fn(() => true);
    opener.publish({ openThread });
    act(() =>
      root.render(
        <ArchiveSettingsPage
          {...settingsPagePropsFixture({
            env: workbenchEnvironment(unarchive, setSettingsOpen, opener),
          })}
        />,
      ),
    );

    act(() => buttonNamed("Open")?.click());

    expect(openThread).toHaveBeenCalledWith("old");
    expect(setSettingsOpen).toHaveBeenCalledWith(false);
    expect(unarchive).not.toHaveBeenCalled();
  });

  it("keeps settings open when no agent view accepts the thread", () => {
    const setSettingsOpen = vi.fn();
    const opener = createPaletteProviderSlot<AgentThreadOpener>();
    act(() =>
      root.render(
        <ArchiveSettingsPage
          {...settingsPagePropsFixture({
            env: workbenchEnvironment(
              vi.fn(async () => true),
              setSettingsOpen,
              opener,
            ),
          })}
        />,
      ),
    );

    act(() => buttonNamed("Open")?.click());

    expect(setSettingsOpen).not.toHaveBeenCalled();
  });

  it("lists the workbench's archived threads, not active ones, and unarchives through the surface", async () => {
    const unarchive = vi.fn(async () => true);
    const env = workbenchEnvironment(unarchive, vi.fn(), null);
    const props = settingsPagePropsFixture({ env });
    act(() => root.render(<ArchiveSettingsPage {...props} />));

    expect(host.textContent).toContain("Archived thread");
    expect(host.textContent).not.toContain("Live thread");
    await act(async () => buttonNamed("Unarchive")?.click());
    expect(unarchive).toHaveBeenCalledWith("old");
  });
});
