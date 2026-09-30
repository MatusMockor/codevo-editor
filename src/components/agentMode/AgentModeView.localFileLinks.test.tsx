// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const TURN_ID = "turn-links-1";
const NO_SNAPSHOT = "No snapshot is available for this turn.";

function answerTurn(text: string): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "Where is the config?",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: 1_700_000_001_000,
    events: [{ kind: "assistantText", text }],
    eventsTruncated: false,
    lastStatusSequence: 2,
    lastOutputSequence: 2,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
  };
}

function missingSnapshot(turnId: string): AgentTurnChangeSummary {
  return { turnId, state: "unavailable", files: [], truncated: false, reason: NO_SNAPSHOT };
}

describe("local file links in agent messages", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

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

  it("explains a missing relative path calmly, marks the link and keeps turn changes out of it", async () => {
    const openFileLocation = vi.fn<AgentFileLocationOpener>(async () => "notFound");
    await renderAnswer("The API URL lives in `src/environment.prod.ts`.", openFileLocation);
    const link = await pathLink("src/environment.prod.ts");

    await act(async () => link.click());

    const message = "src/environment.prod.ts isn't in this project (app).";
    await waitForReact(() => expect(notice()?.textContent).toContain(message));
    expect(notice()?.className).toContain("agent-notice--info");
    expect(openFileLocation).toHaveBeenCalledExactlyOnceWith({
      location: {
        path: `${SURFACE_FIXTURE_ROOT}/src/environment.prod.ts`,
        line: null,
        column: null,
      },
      root: SURFACE_FIXTURE_ROOT,
    });
    const marked = await pathLink("src/environment.prod.ts");
    expect(marked.getAttribute("data-agent-link-state")).toBe("unavailable");
    expect(marked.getAttribute("title")).toBe(message);
    expect(host.textContent).not.toContain(NO_SNAPSHOT);

    await act(async () => dismissButton()?.click());
    expect(notice()).toBeNull();
    await act(async () => marked.click());
    expect(openFileLocation).toHaveBeenCalledTimes(2);
    expect(notice()).toBeNull();
  });

  it("still opens an existing file at the referenced line without a notice", async () => {
    const openFileLocation = vi.fn<AgentFileLocationOpener>(async () => "opened");
    await renderAnswer("See src/app.ts:12 for the handler.", openFileLocation);
    const link = await pathLink("src/app.ts:12");

    await act(async () => link.click());

    expect(openFileLocation).toHaveBeenCalledExactlyOnceWith({
      location: { path: `${SURFACE_FIXTURE_ROOT}/src/app.ts`, line: 12, column: null },
      root: SURFACE_FIXTURE_ROOT,
    });
    expect(notice()).toBeNull();
    expect(link.hasAttribute("data-agent-link-state")).toBe(false);
  });

  it("refuses a path outside the project with a truthful message", async () => {
    const openFileLocation = vi.fn<AgentFileLocationOpener>(async () => "opened");
    await renderAnswer("Compare with [the hosts file](/etc/hosts).", openFileLocation);
    const link = await markdownLink("the hosts file");

    await act(async () => link.click());

    await waitForReact(() =>
      expect(notice()?.textContent).toContain(
        "/etc/hosts is outside this project (app), so it wasn't opened.",
      ),
    );
    expect(notice()?.className).toContain("agent-notice--info");
    expect(openFileLocation).not.toHaveBeenCalled();
  });

  async function renderAnswer(text: string, openFileLocation: AgentFileLocationOpener) {
    const view = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "in-place", worktreePath: null },
        turns: [answerTurn(text)],
      },
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({
      threads: [view],
      getTurnChanges: vi.fn(async (_threadId: string, turnId: string) => missingSnapshot(turnId)),
      getTurnFileDiff: vi.fn(async () => {
        throw new Error(NO_SNAPSHOT);
      }),
    });
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: view.thread.threadId,
        selectedThreadOwnerKey: view.thread.owner.ownerId,
        scopeState: NO_SCOPE_STATE,
      },
    };

    function Harness() {
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      return (
        <AgentModeView
          agents={{ ...agents, providerManagement: unconfiguredAgentProviderManagement() }}
          chrome={chromeFixture({
            layout: { layout, effectiveLayout: "agent", persistedBottomPanel: false, dispatch },
            openFileLocation,
          })}
          navigationSession={session}
          onOpenEnvironmentSettings={() => undefined}
          onReleaseProject={() => undefined}
          onTrustProject={() => undefined}
          overflowRootPaths={[]}
          projects={[projectFixture()]}
          providerEnabled={{ claudeCode: true, codex: true }}
          workspaceRoot={SURFACE_FIXTURE_ROOT}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    if (host.querySelector(".agent-turn-list") === null) {
      const row = host.querySelector<HTMLElement>(`[data-thread-id="${view.thread.threadId}"]`);
      await act(async () => row?.click());
    }
  }

  async function pathLink(text: string): Promise<HTMLAnchorElement> {
    let found: HTMLAnchorElement | undefined;
    await waitForReact(() => {
      found = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__path-link")].find(
        (candidate) => candidate.textContent === text,
      );
      expect(found).toBeDefined();
    });
    return found!;
  }

  async function markdownLink(text: string): Promise<HTMLAnchorElement> {
    let found: HTMLAnchorElement | undefined;
    await waitForReact(() => {
      found = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__link")].find(
        (candidate) => candidate.textContent === text,
      );
      expect(found).toBeDefined();
    });
    return found!;
  }

  function notice(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-notice");
  }

  function dismissButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('[aria-label="Dismiss agent notice"]');
  }
});
