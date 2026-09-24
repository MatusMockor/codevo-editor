// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const TURN_ID = "turn-claude-1";
const GREET = "src/greet.ts";

function claudeTurn(): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "Create a greet helper",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: 1_700_000_001_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 2,
    lastOutputSequence: 2,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
  };
}

function summary(turnId: string): AgentTurnChangeSummary {
  return {
    turnId,
    state: "ready",
    files: [
      {
        relativePath: GREET,
        oldRelativePath: null,
        status: "added",
        addedLines: 3,
        deletedLines: 0,
      },
    ],
    truncated: false,
    reason: null,
  };
}

function greetDiff(relativePath: string): AgentTurnFileDiff {
  return {
    relativePath,
    original: { text: "", truncated: false },
    modified: {
      text: "export function greet(name: string) {\n  return `Hello, ${name}`;\n}\n",
      truncated: false,
    },
    unavailableReason: null,
  };
}

describe("opening a recorded Claude turn file in the Diff surface", () => {
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

  it("reveals the clicked file of the turn instead of an idle diff", async () => {
    const getTurnChanges = vi.fn(async (_threadId: string, turnId: string) => summary(turnId));
    const getTurnFileDiff = vi.fn(async (_threadId: string, _turnId: string, path: string) =>
      greetDiff(path),
    );
    const view = surfaceThreadView({
      thread: { ...surfaceThreadView().thread, turns: [claudeTurn()] },
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({
      threads: [view],
      getTurnChanges,
      getTurnFileDiff,
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
            layout: {
              layout,
              effectiveLayout: layout.layout,
              persistedBottomPanel: false,
              dispatch,
            },
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
    const threadRow = [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].find(
      (candidate) => candidate.getAttribute("data-thread-id") === view.thread.threadId,
    );
    if (host.querySelector(".agent-turn-list") === null) await act(async () => threadRow?.click());
    await waitForReact(() => expect(buttonWithText("Show files")).toBeDefined());
    act(() => buttonWithText("Show files")?.click());
    const greet = [...host.querySelectorAll<HTMLElement>('[aria-label="Changed files"] button')];
    expect(greet).toHaveLength(1);
    await act(async () => greet[0]?.click());

    await waitForReact(() =>
      expect(
        host
          .querySelector<HTMLElement>(`.cv-diff-file__row[title="${GREET}"]`)
          ?.getAttribute("aria-expanded"),
      ).toBe("true"),
    );
    expect(host.textContent).not.toContain("Select changes to review.");
    await waitForReact(() => expect(host.querySelector(".cv-diff-code--add")).not.toBeNull());
    expect(getTurnFileDiff).toHaveBeenCalledWith(view.thread.threadId, TURN_ID, GREET);
  });

  function buttonWithText(text: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
  }
});
