// @vitest-environment jsdom
import { act, useMemo, useReducer, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../../../domain/agentWorkbenchLayout";
import { unconfiguredAgentProviderManagement } from "../../../test/agentProviderManagementFixture";
import { waitForReact } from "../../../test/reactTestLifecycle";
import { AgentModeView } from "../AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "../agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "../agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "../agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "../useAgentThreadNavigation";

const renders = vi.hoisted(() => ({
  rail: 0,
  header: 0,
  conversation: 0,
  session: 0,
  footer: 0,
  overlays: 0,
  surface: 0,
}));

type RegionKey = keyof typeof renders;

vi.mock("./AgentModeRail", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeRail")>();
  return {
    ...actual,
    AgentModeRail: support.countedComponent(renders, "rail", actual.AgentModeRail),
  };
});
vi.mock("./AgentModeHeader", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeHeader")>();
  return {
    ...actual,
    AgentModeHeader: support.countedComponent(renders, "header", actual.AgentModeHeader),
  };
});
vi.mock("./AgentModeConversation", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeConversation")>();
  return {
    ...actual,
    AgentModeConversation: support.countedComponent(
      renders,
      "conversation",
      actual.AgentModeConversation,
    ),
  };
});
vi.mock("./AgentModeThreadSession", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeThreadSession")>();
  return {
    ...actual,
    AgentModeThreadSession: support.countedComponent(
      renders,
      "session",
      actual.AgentModeThreadSession,
    ),
  };
});
vi.mock("./AgentModeThreadFooter", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeThreadFooter")>();
  return {
    ...actual,
    AgentModeThreadFooter: support.countedComponent(
      renders,
      "footer",
      actual.AgentModeThreadFooter,
    ),
  };
});
vi.mock("./AgentModeOverlays", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeOverlays")>();
  return {
    ...actual,
    AgentModeOverlays: support.countedComponent(renders, "overlays", actual.AgentModeOverlays),
  };
});
vi.mock("./AgentModeSurfaceRegion", async (importOriginal) => {
  const support = await import("../../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("./AgentModeSurfaceRegion")>();
  return {
    ...actual,
    AgentModeSurfaceRegion: support.countedComponent(
      renders,
      "surface",
      actual.AgentModeSurfaceRegion,
    ),
  };
});

const THREAD_A = "agt-a";
const THREAD_B = "agt-b";

interface HarnessControl {
  setThreads: Dispatch<SetStateAction<ReadonlyArray<AgentThreadView>>>;
  refreshGitStatus(): void;
  dispatchLayout: Dispatch<AgentWorkbenchLayoutAction>;
}

function threadView(threadId: string, title: string, updatedAtEpochMs: number): AgentThreadView {
  return surfaceThreadView({
    lifecycle: "settled",
    thread: { ...surfaceThreadView().thread, threadId, title, updatedAtEpochMs },
  });
}

describe("agent mode region render isolation", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("re-renders only the regions whose data changed", async () => {
    const control = await mount();
    const measure = async (work: () => void | Promise<void>) => {
      for (const key of Object.keys(renders) as RegionKey[]) renders[key] = 0;
      await act(async () => {
        await work();
      });
      await settle();
      return { ...renders };
    };

    const railOnly = await measure(() =>
      control.setThreads((threads) =>
        threads.map((view) =>
          view.thread.threadId === THREAD_B
            ? { ...view, unread: true, attention: "attention" as const }
            : view,
        ),
      ),
    );

    const selection = await measure(() => {
      host.querySelector<HTMLElement>(`[data-thread-id="${THREAD_B}"]`)?.click();
    });
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Thread breadcrumb"]')?.textContent).toContain(
        "Second thread",
      ),
    );

    const typing = await measure(() => {
      const prompt = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        prompt,
        "Draft a follow-up",
      );
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const rightPanel = await measure(() => control.dispatchLayout({ kind: "toggleRightPanel" }));
    const gitRefresh = await measure(() => control.refreshGitStatus());

    const table = { railOnly, selection, gitRefresh, typing, rightPanel };
    expect(table).toEqual({
      railOnly: regions({ rail: 1 }),
      selection: regions({ rail: 1, header: 1, session: 1, footer: 1 }),
      typing: regions({}),
      rightPanel: regions({ header: 1, surface: 1 }),
      gitRefresh: regions({ surface: 1 }),
    });
  });

  async function mount(): Promise<HarnessControl> {
    const providerManagement = unconfiguredAgentProviderManagement();
    const base = threadsSurfaceFixture();
    const projects = [projectFixture()];
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: THREAD_A,
        selectedThreadOwnerKey: "agent-root:app",
        scopeState: NO_SCOPE_STATE,
      },
    };
    const control: Partial<HarnessControl> = {};

    function Harness() {
      const [threads, setThreads] = useState<ReadonlyArray<AgentThreadView>>(() => [
        threadView(THREAD_A, "First thread", 2),
        threadView(THREAD_B, "Second thread", 1),
      ]);
      const [statuses, setStatuses] = useState(() => [
        { rootPath: SURFACE_FIXTURE_ROOT, branch: "main" },
      ]);
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      control.setThreads = setThreads;
      control.refreshGitStatus = () =>
        setStatuses((current) => current.map((status) => ({ ...status })));
      control.dispatchLayout = dispatch;
      const layoutState = useMemo(
        () => ({ layout, persistedBottomPanel: false, dispatch }),
        [layout],
      );
      const liveCheckoutBranches = useMemo(
        () => new Map(statuses.map((status) => [status.rootPath, status.branch])),
        [statuses],
      );
      const chrome = useMemo(
        () => chromeFixture({ ...STABLE_CHROME, layout: layoutState, liveCheckoutBranches }),
        [layoutState, liveCheckoutBranches],
      );
      const agents = useMemo(() => ({ ...base, threads, providerManagement }), [threads]);
      return (
        <AgentModeView
          agents={agents}
          chrome={chrome}
          navigationSession={session}
          onReleaseProject={NOOP}
          onTrustProject={NOOP}
          overflowRootPaths={NO_PATHS}
          projects={projects}
          providerEnabled={PROVIDERS}
          workspaceRoot={SURFACE_FIXTURE_ROOT}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await settle();
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${THREAD_B}"]`)).not.toBeNull(),
    );
    return control as HarnessControl;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
    });
  }
});

function regions(counts: Partial<Record<RegionKey, number>>): Record<RegionKey, number> {
  return {
    rail: 0,
    header: 0,
    conversation: 0,
    session: 0,
    footer: 0,
    overlays: 0,
    surface: 0,
    ...counts,
  };
}

const NOOP = () => undefined;
const STABLE_CHROME = {
  onToggleBottomPanel: NOOP,
  onShowTerminalPanel: NOOP,
  revealPath: async () => undefined,
};
const NO_PATHS: ReadonlyArray<string> = [];
const PROVIDERS = { claudeCode: true, codex: true } as const;
