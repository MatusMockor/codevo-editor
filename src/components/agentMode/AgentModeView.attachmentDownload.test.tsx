// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import { AgentAttachmentDownloadError } from "../../application/remoteAttachmentDownload";
import type { AgentAttachment } from "../../domain/agentAttachment";
import type { AgentTurn } from "../../domain/agentThread";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR } from "../../domain/remoteRunnerFileAttachment";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

type Download = AgentThreadsSurface["downloadAttachment"];

const FILE_ID = "b".repeat(32);

const REMOTE_FILE: AgentAttachment = {
  kind: "file",
  attachmentId: FILE_ID,
  name: "report.pdf",
  bytes: 5_000_000,
  remote: { serverId: "server-one", attachmentId: "3f0c1e0a-0d3b-4d5e-9a51-6c2b7d8e9f00" },
};

function turnWithFile(): AgentTurn {
  return {
    turnId: "turn-1",
    prompt: "Read the report",
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
    attachments: [REMOTE_FILE],
  };
}

describe("downloading a file attachment from the agent view", () => {
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

  async function open(downloadAttachment: Download): Promise<string> {
    const view = surfaceThreadView({
      thread: { ...surfaceThreadView().thread, turns: [turnWithFile()] },
    });
    const agents: AgentThreadsSurface = threadsSurfaceFixture({
      threads: [view],
      downloadAttachment,
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
              effectiveLayout: "agent",
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
    await waitForReact(() => expect(downloadButton()).not.toBeNull());
    return view.thread.threadId;
  }

  function downloadButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('button[aria-label="Download report.pdf"]');
  }

  function notices(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-thread-notice")].map(
      (notice) => notice.textContent ?? "",
    );
  }

  it("calls the thread surface with the selected thread and the display attachment id", async () => {
    const downloadAttachment = vi.fn<Download>(async () => "saved");
    const threadId = await open(downloadAttachment);

    await act(async () => downloadButton()?.click());

    expect(downloadAttachment).toHaveBeenCalledTimes(1);
    expect(downloadAttachment).toHaveBeenCalledWith(threadId, FILE_ID);
    expect(notices()).toEqual([]);
    expect(downloadButton()?.getAttribute("aria-busy")).toBeNull();
  });

  it("stays silent when the save dialog is dismissed", async () => {
    const downloadAttachment = vi.fn<Download>(async () => "cancelled");
    await open(downloadAttachment);

    await act(async () => downloadButton()?.click());

    expect(downloadAttachment).toHaveBeenCalledTimes(1);
    expect(notices()).toEqual([]);
  });

  it("shows the download failure once in the thread notice with the error's own message", async () => {
    const downloadAttachment = vi.fn<Download>(() =>
      Promise.reject(new AgentAttachmentDownloadError(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR)),
    );
    await open(downloadAttachment);

    await act(async () => downloadButton()?.click());

    await waitForReact(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]).toContain(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR);
    expect(host.textContent?.split(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR)).toHaveLength(2);
    expect(downloadButton()?.getAttribute("aria-busy")).toBeNull();
  });
});
