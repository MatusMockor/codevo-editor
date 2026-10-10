// @vitest-environment jsdom

import {
  act,
  useLayoutEffect,
  useReducer,
  useState,
  type ComponentProps,
  type Dispatch,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentThreads } from "../../application/useAgentThreads";
import type { AgentThread } from "../../domain/agentThread";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../../domain/agentWorkbenchLayout";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  UNDO_FIXTURE_PROJECTS,
  UNDO_FIXTURE_ROOT,
  undoStoredThread,
  undoThreadDependencies,
  undoThreadGateways,
  type UndoThreadGateways,
} from "../../test/agentThreadUndoFixtures";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import {
  captureConsoleErrors,
  expectNoUnexpectedConsoleErrors,
  expectOnlyCaughtErrorReports,
  type ConsoleErrorSpy,
} from "../errorBoundaryTestSupport";
import { regionFallback, regionFallbackAction } from "./agentRegionBoundaryTestSupport";
import {
  AGENT_REGION_FAILURE_DETAILS_MAX_CHARS,
  type AgentRegion,
} from "./agentRegionFailurePresentation";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

type RegionCrash = "none" | "throw" | "updateLoop";

const crashes = vi.hoisted(() => {
  const state: Record<"sidebar" | "conversation" | "composer" | "rightPanel", RegionCrash> = {
    sidebar: "none",
    conversation: "none",
    composer: "none",
    rightPanel: "none",
  };
  return state;
});

function FreshValueSource({ onChange }: { onChange(value: object): void }) {
  useLayoutEffect(() => {
    onChange({});
  });
  return null;
}

function UpdateLoop() {
  const [value, setValue] = useState<object>({});
  return (
    <>
      <FreshValueSource onChange={setValue} />
      <output hidden>{Object.keys(value).length}</output>
    </>
  );
}

function CrashSwitch({ region }: { readonly region: AgentRegion }) {
  const crash = crashes[region];
  if (crash === "throw") throw new Error(`Minified React error #185; ${region} fixture`);
  if (crash === "updateLoop") return <UpdateLoop />;
  return null;
}

vi.mock("./AgentThreadsSidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentThreadsSidebar")>();
  return {
    ...actual,
    AgentThreadsSidebar: (props: ComponentProps<typeof actual.AgentThreadsSidebar>) => (
      <>
        <CrashSwitch region="sidebar" />
        <actual.AgentThreadsSidebar {...props} />
      </>
    ),
  };
});

vi.mock("./AgentThreadSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentThreadSession")>();
  return {
    ...actual,
    AgentThreadSession: (props: ComponentProps<typeof actual.AgentThreadSession>) => (
      <>
        <CrashSwitch region="conversation" />
        <actual.AgentThreadSession {...props} />
      </>
    ),
  };
});

vi.mock("./AgentComposerController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentComposerController")>();
  return {
    ...actual,
    AgentComposerController: (props: ComponentProps<typeof actual.AgentComposerController>) => (
      <>
        <CrashSwitch region="composer" />
        <actual.AgentComposerController {...props} />
      </>
    ),
  };
});

vi.mock("./AgentSurfaceHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AgentSurfaceHost")>();
  return {
    ...actual,
    AgentSurfaceHost: (props: ComponentProps<typeof actual.AgentSurfaceHost>) => (
      <>
        <CrashSwitch region="rightPanel" />
        <actual.AgentSurfaceHost {...props} />
      </>
    ),
  };
});

const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const THREADS: ReadonlyArray<AgentThread> = [undoStoredThread("agt-a"), undoStoredThread("agt-b")];
const ALL_REGIONS: ReadonlyArray<AgentRegion> = [
  "sidebar",
  "conversation",
  "composer",
  "rightPanel",
];

describe("AgentModeView region boundaries", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateways: UndoThreadGateways;
  let consoleError: ConsoleErrorSpy;
  let copied: string[];
  let dispatchLayout: Dispatch<AgentWorkbenchLayoutAction>;
  let rerender: () => void;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  const clipboard: TextClipboardGateway = {
    canWriteText: () => true,
    writeText: async (text) => {
      copied.push(text);
    },
  };

  function Harness() {
    const [layout, dispatch] = useReducer(agentWorkbenchLayoutReducer, initialAgentWorkbenchLayout);
    const [, bump] = useReducer((revision: number) => revision + 1, 0);
    const surface = useAgentThreads(undoThreadDependencies(gateways));
    dispatchLayout = dispatch;
    rerender = bump;
    return (
      <AgentModeView
        agents={{ ...surface, providerManagement: PROVIDER_MANAGEMENT }}
        chrome={chromeFixture({
          layout: { layout, effectiveLayout: "agent", persistedBottomPanel: false, dispatch },
        })}
        onReleaseProject={() => undefined}
        onTrustProject={() => undefined}
        overflowRootPaths={[]}
        projects={UNDO_FIXTURE_PROJECTS}
        providerEnabled={{ claudeCode: true, codex: true }}
        textClipboard={clipboard}
        workspaceRoot={UNDO_FIXTURE_ROOT}
      />
    );
  }

  function row(threadId: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
  }

  function selectedThreadId(): string | null {
    return (
      host
        .querySelector<HTMLElement>('[data-thread-id][aria-current="true"]')
        ?.getAttribute("data-thread-id") ?? null
    );
  }

  function prompt(): HTMLTextAreaElement | null {
    return host.querySelector<HTMLTextAreaElement>(".agent-mode__center textarea");
  }

  function session(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-mode__center .agent-session");
  }

  function surface(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[data-slot="surface"] .agent-surface');
  }

  function typePrompt(text: string): void {
    const field = prompt();
    expect(field).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        text,
      );
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function selectThread(threadId: string): Promise<void> {
    const target = row(threadId);
    expect(target).not.toBeNull();
    await act(async () => target?.click());
  }

  async function crash(region: AgentRegion, kind: RegionCrash): Promise<void> {
    crashes[region] = kind;
    await act(async () => rerender());
  }

  async function press(region: AgentRegion, action: "retry" | "copy-details"): Promise<void> {
    const button = regionFallbackAction(host, region, action);
    expect(button).not.toBeNull();
    await act(async () => button?.click());
  }

  function expectFailedRegions(failed: ReadonlyArray<AgentRegion>): void {
    expect(ALL_REGIONS.filter((region) => regionFallback(host, region) !== null)).toEqual(failed);
    expect(host.querySelector(".error-boundary-fallback")).toBeNull();
    expect(host.textContent).not.toContain("Minified React error");
    expect(host.textContent).not.toContain("Maximum update depth");
  }

  async function mount(): Promise<void> {
    gateways = undoThreadGateways(THREADS);
    await act(async () => root.render(<Harness />));
    await waitForReact(() => expect(host.querySelectorAll("[data-thread-id]")).toHaveLength(2));
    await selectThread("agt-a");
    await act(async () => dispatchLayout({ kind: "openSurface", surface: "diff" }));
    await waitForReact(() => {
      expect(selectedThreadId()).toBe("agt-a");
      expect(session()).not.toBeNull();
      expect(prompt()).not.toBeNull();
      expect(surface()).not.toBeNull();
    });
    expectFailedRegions([]);
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    copied = [];
    consoleError = captureConsoleErrors();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    try {
      expectNoUnexpectedConsoleErrors(consoleError);
    } finally {
      for (const region of ALL_REGIONS) crashes[region] = "none";
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.restoreAllMocks();
    }
  });

  it("contains a sidebar crash and keeps the conversation, composer and side panel", async () => {
    await mount();

    await crash("sidebar", "throw");

    expectFailedRegions(["sidebar"]);
    expect(
      regionFallback(host, "sidebar")?.parentElement?.matches(
        ".agent-mode__grid > aside.agent-rail",
      ),
    ).toBe(true);
    expect(session()).not.toBeNull();
    expect(surface()).not.toBeNull();
    typePrompt("still typing");
    expect(prompt()?.value).toBe("still typing");

    crashes.sidebar = "none";
    await press("sidebar", "retry");

    expectFailedRegions([]);
    expect(selectedThreadId()).toBe("agt-a");
    expect(prompt()?.value).toBe("still typing");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("contains a conversation crash and recovers when another thread is selected", async () => {
    await mount();
    typePrompt("draft for a");

    await crash("conversation", "throw");

    expectFailedRegions(["conversation"]);
    expect(
      regionFallback(host, "conversation")?.parentElement?.matches(".agent-mode__center"),
    ).toBe(true);
    expect(session()).toBeNull();
    expect(prompt()?.value).toBe("draft for a");
    expect(surface()).not.toBeNull();
    expect(selectedThreadId()).toBe("agt-a");

    crashes.conversation = "none";
    await selectThread("agt-b");

    await waitForReact(() => expect(selectedThreadId()).toBe("agt-b"));
    expectFailedRegions([]);
    expect(session()).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("keeps the selected thread and the draft across a conversation retry", async () => {
    await mount();
    typePrompt("keep me");
    await crash("conversation", "throw");

    await press("conversation", "retry");
    expectFailedRegions(["conversation"]);

    crashes.conversation = "none";
    await press("conversation", "retry");

    expectFailedRegions([]);
    expect(session()).not.toBeNull();
    expect(selectedThreadId()).toBe("agt-a");
    expect(prompt()?.value).toBe("keep me");
    expectOnlyCaughtErrorReports(consoleError, 2);
  });

  it("contains a composer crash, copies bounded details and restores the draft", async () => {
    await mount();
    typePrompt("unsent draft");

    await crash("composer", "throw");

    expectFailedRegions(["composer"]);
    expect(prompt()).toBeNull();
    expect(regionFallback(host, "composer")?.textContent).toBe(
      "The composer couldn't be displayedTry againCopy details",
    );
    expect(session()).not.toBeNull();
    expect(surface()).not.toBeNull();
    expect(row("agt-b")).not.toBeNull();

    await press("composer", "copy-details");
    expect(copied).toHaveLength(1);
    expect(copied[0]?.length).toBeLessThanOrEqual(AGENT_REGION_FAILURE_DETAILS_MAX_CHARS);
    expect(copied[0]?.split("\n").slice(0, 3)).toEqual([
      "Codevo agent mode: the composer failed to render",
      "Error: Minified React error #185; composer fixture",
      "Component stack:",
    ]);
    expect(copied[0]).toMatch(/\n {2}at CrashSwitch\b/);

    crashes.composer = "none";
    await press("composer", "retry");

    expectFailedRegions([]);
    expect(prompt()?.value).toBe("unsent draft");
    expect(selectedThreadId()).toBe("agt-a");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("restores a new-thread draft after a composer retry", async () => {
    gateways = undoThreadGateways(THREADS);
    await act(async () => root.render(<Harness />));
    await waitForReact(() => {
      expect(host.querySelectorAll("[data-thread-id]")).toHaveLength(2);
      expect(prompt()).not.toBeNull();
    });
    expect(selectedThreadId()).toBeNull();
    typePrompt("brand new idea");

    await crash("composer", "throw");
    expectFailedRegions(["composer"]);

    crashes.composer = "none";
    await press("composer", "retry");

    expectFailedRegions([]);
    expect(selectedThreadId()).toBeNull();
    expect(prompt()?.value).toBe("brand new idea");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("contains a composer layout-effect update loop to the composer", async () => {
    await mount();

    await crash("composer", "updateLoop");

    expectFailedRegions(["composer"]);
    expect(session()).not.toBeNull();
    expect(surface()).not.toBeNull();
    await press("composer", "copy-details");
    expect(copied[0]).toContain("Error: Maximum update depth exceeded.");

    await selectThread("agt-b");
    await waitForReact(() => expect(selectedThreadId()).toBe("agt-b"));
    expectFailedRegions(["composer"]);

    crashes.composer = "none";
    await selectThread("agt-a");

    await waitForReact(() => expect(selectedThreadId()).toBe("agt-a"));
    expectFailedRegions([]);
    expect(prompt()).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 2);
  });

  it("contains a side panel crash in its slot and recovers when the surface changes", async () => {
    await mount();

    await crash("rightPanel", "throw");

    expectFailedRegions(["rightPanel"]);
    const slot = regionFallback(host, "rightPanel")?.closest('[data-slot="surface"]');
    expect(slot?.matches(".agent-surface-host")).toBe(true);
    expect(slot?.hasAttribute("hidden")).toBe(false);
    expect(slot?.querySelector('.agent-surface[data-editor-slot="none"]')).not.toBeNull();
    expect(session()).not.toBeNull();
    expect(row("agt-a")).not.toBeNull();
    typePrompt("panel is down");
    expect(prompt()?.value).toBe("panel is down");

    crashes.rightPanel = "none";
    await act(async () => dispatchLayout({ kind: "toggleRightPanel" }));
    await act(async () => dispatchLayout({ kind: "toggleRightPanel" }));

    await waitForReact(() => expect(surface()).not.toBeNull());
    expectFailedRegions([]);
    expect(prompt()?.value).toBe("panel is down");
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("keeps every other region alive when two regions fail at once", async () => {
    await mount();

    crashes.sidebar = "throw";
    await crash("rightPanel", "throw");

    expectFailedRegions(["sidebar", "rightPanel"]);
    expect(session()).not.toBeNull();
    typePrompt("two down");
    expect(prompt()?.value).toBe("two down");
    expectOnlyCaughtErrorReports(consoleError, 2);
  });
});
