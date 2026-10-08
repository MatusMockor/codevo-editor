// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentAttachmentSource } from "../../application/useAgentComposerAttachments";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { installElementFromPoint } from "../../test/elementFromPointTestSupport";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AGENT_ATTACHMENT_DROP_OVERLAY_LABEL } from "./AgentAttachmentDropOverlay";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import {
  composerAttachmentsSurfaceFixture,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

interface WebviewDragDropPayload {
  readonly type: "over" | "drop" | "leave";
  readonly position?: { readonly x: number; readonly y: number };
  readonly paths?: ReadonlyArray<string>;
}

type WebviewDragDropListener = (event: { readonly payload: WebviewDragDropPayload }) => void;

const webview = vi.hoisted(() => ({ listeners: new Set<WebviewDragDropListener>() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: WebviewDragDropListener) => {
      webview.listeners.add(listener);
      return () => {
        webview.listeners.delete(listener);
      };
    },
  }),
}));

const THREAD_ID = "agt-1";
const DROPPED = "/Users/me/Desktop/clip.mp4";
const OVER_TRANSCRIPT = { x: 300, y: 100 };
const OVER_RAIL = { x: 50, y: 100 };

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const COLUMN_BOUNDS: Bounds = { left: 200, top: 0, width: 600, height: 800 };
const COMPOSER_BOUNDS: Bounds = { left: 200, top: 600, width: 600, height: 200 };
const TRANSCRIPT_BOUNDS: Bounds = { left: 200, top: 0, width: 600, height: 600 };

describe("dropping Finder files on the agent thread column", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let restoreElementFromPoint: () => void;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    restoreElementFromPoint = installElementFromPoint();
    Element.prototype.scrollIntoView = () => undefined;
    webview.listeners.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restoreElementFromPoint();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("attaches a file released over the transcript and refocuses the prompt", async () => {
    const intake = await mount();

    await deliver({ type: "over", position: OVER_TRANSCRIPT });
    const pill = overlay();
    expect(pill?.textContent).toBe(AGENT_ATTACHMENT_DROP_OVERLAY_LABEL);
    expect(pill?.closest(".agent-mode__center")).toBe(element(".agent-mode__center"));

    await deliver({ type: "drop", position: OVER_TRANSCRIPT, paths: [DROPPED] });

    expect(intake).toHaveBeenCalledTimes(1);
    expect(intake).toHaveBeenCalledWith([{ kind: "path", path: DROPPED }]);
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(element("textarea#agent-prompt"));
  });

  it("ignores a file released over the thread rail", async () => {
    const intake = await mount();

    await deliver({ type: "over", position: OVER_RAIL });
    expect(overlay()).toBeNull();
    await deliver({ type: "drop", position: OVER_RAIL, paths: [DROPPED] });

    expect(intake).not.toHaveBeenCalled();
  });

  async function mount() {
    const intake = vi.fn(async (_sources: ReadonlyArray<AgentAttachmentSource>) => undefined);
    const view = surfaceThreadView({
      lifecycle: "settled",
      thread: { ...surfaceThreadView().thread, threadId: THREAD_ID },
    });
    const attachments = composerAttachmentsSurfaceFixture({
      captureIntake: () => intake,
      forDraft: () => attachments,
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({ threads: [view], attachments });
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: THREAD_ID,
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
    if (host.querySelector(".agent-session__scroll") === null) {
      const row = host.querySelector<HTMLElement>(`[data-thread-id="${THREAD_ID}"]`);
      await act(async () => row?.click());
    }
    await waitForReact(() => expect(host.querySelector(".agent-session__scroll")).not.toBeNull());
    await waitForReact(() => expect(webview.listeners.size).toBe(1));
    stubBounds(element(".agent-mode__center"), COLUMN_BOUNDS);
    stubBounds(element(".agent-session__scroll"), TRANSCRIPT_BOUNDS);
    stubBounds(element("form.agent-composer"), COMPOSER_BOUNDS);
    return intake;
  }

  async function deliver(payload: WebviewDragDropPayload): Promise<void> {
    await act(async () => {
      for (const listener of [...webview.listeners]) listener({ payload });
    });
  }

  function overlay(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-attachment-drop-overlay [role='status']");
  }

  function element(selector: string): HTMLElement {
    const found = host.querySelector<HTMLElement>(selector);
    expect(found, selector).not.toBeNull();
    return found ?? document.createElement("div");
  }
});

function stubBounds(target: HTMLElement, bounds: Bounds): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height,
      width: bounds.width,
      height: bounds.height,
      x: bounds.left,
      y: bounds.top,
      toJSON: () => ({}),
    }),
  });
}
