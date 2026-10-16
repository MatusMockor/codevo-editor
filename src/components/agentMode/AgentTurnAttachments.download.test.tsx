// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView, AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  agentAttachmentImageKey,
  type AgentAttachmentImageState,
  type AgentAttachmentImagesSurface,
} from "../../application/useAgentAttachmentImages";
import { AgentAttachmentDownloadError } from "../../application/remoteAttachmentDownload";
import type { AgentAttachment } from "../../domain/agentAttachment";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurn } from "../../domain/agentThread";
import { REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR } from "../../domain/remoteRunnerFileAttachment";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import {
  AGENT_ATTACHMENT_DOWNLOAD_TITLE,
  AGENT_ATTACHMENT_DOWNLOADING_TITLE,
} from "./agentTurnAttachmentPresentation";
import { useAgentAttachmentDownloads } from "./useAgentAttachmentDownloads";
import { useScopedAgentNotice } from "./useScopedAgentNotice";

type Download = AgentThreadsSurface["downloadAttachment"];
type Outcome = Awaited<ReturnType<Download>>;

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const NOW = 1_700_000_600_000;
const THREAD_A = "remote-thread-a";
const THREAD_B = "remote-thread-b";
const FILE_ID = "b".repeat(32);
const OTHER_FILE_ID = "d".repeat(32);
const IMAGE_ID = "a".repeat(32);
const LOCAL_FILE_ID = "c".repeat(32);
const RUNNER_FILE_ID = "3f0c1e0a-0d3b-4d5e-9a51-6c2b7d8e9f00";
const SERVER_ID = "server-one";
const FOLDER_PATH = "/Users/x/Documents/invoices";
const REFERENCE_PATH = "/workspace/app/clip.mp4";

const REMOTE_FILE: AgentAttachment = {
  kind: "file",
  attachmentId: FILE_ID,
  name: "report.pdf",
  bytes: 5_000_000,
  remote: { serverId: SERVER_ID, attachmentId: RUNNER_FILE_ID },
};

const REMOTE_FILE_DECLARING_IMAGE: AgentAttachment = {
  kind: "file",
  attachmentId: OTHER_FILE_ID,
  name: "photo.png",
  bytes: 2_048,
  remote: { serverId: SERVER_ID, attachmentId: "9b2d6c1e-4a7f-4c3d-8e21-0f5a6b7c8d90" },
};

const LOCAL_FILE: AgentAttachment = {
  kind: "file",
  attachmentId: LOCAL_FILE_ID,
  name: "notes.txt",
  bytes: 1_024,
  storedPath: `/data/agent-attachments/threads/${THREAD_A}/${LOCAL_FILE_ID}.bin`,
};

const IMAGE: AgentAttachment = {
  kind: "image",
  attachmentId: IMAGE_ID,
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  remote: { serverId: SERVER_ID, attachmentId: "5c7e9a1b-2d4f-4a6b-9c8d-1e2f3a4b5c6d" },
};

const REFERENCE: AgentAttachment = {
  kind: "reference",
  name: "clip.mp4",
  path: REFERENCE_PATH,
  bytes: 5_000_000,
};

const FOLDER: AgentAttachment = {
  kind: "reference",
  name: "invoices",
  path: FOLDER_PATH,
  bytes: 0,
};

const MIXED_PROMPT = [
  "Read these",
  "",
  `[Attached folder "invoices" is at: ${FOLDER_PATH}]`,
  `[Attached file "clip.mp4" is at: ${REFERENCE_PATH}]`,
].join("\n");

interface Deferred {
  readonly promise: Promise<Outcome>;
  resolve(outcome: Outcome): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: (outcome: Outcome) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Outcome>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("downloading a server file attachment from thread history", () => {
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

  function Harness({
    attachmentImages = null,
    download,
    thread,
  }: {
    readonly attachmentImages?: AgentAttachmentImagesSurface | null;
    readonly download: Download;
    readonly thread: AgentThreadView;
  }) {
    const [notice, reportNotice] = useScopedAgentNotice(thread.thread.threadId);
    const attachmentDownloads = useAgentAttachmentDownloads({ download, reportNotice });
    return (
      <AgentClockProvider nowTickMs={600_000}>
        <p data-notice="">{notice?.message ?? ""}</p>
        <AgentThreadSession
          attachmentDownloads={attachmentDownloads}
          attachmentImages={attachmentImages}
          composerRepositoryLabel="app"
          markdownViewport={null}
          onReviewInDiff={() => undefined}
          thread={thread}
        />
      </AgentClockProvider>
    );
  }

  function render(
    download: Download,
    thread: AgentThreadView,
    attachmentImages: AgentAttachmentImagesSurface | null = null,
  ): void {
    act(() =>
      root.render(
        <Harness attachmentImages={attachmentImages} download={download} thread={thread} />,
      ),
    );
  }

  function notice(): string {
    return host.querySelector("[data-notice]")?.textContent ?? "";
  }

  function downloadButtons(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>(".agent-attachments__download")];
  }

  function downloadButton(name = "report.pdf"): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Download ${name}"]`);
    expect(button).not.toBeNull();
    return button ?? document.createElement("button");
  }

  it("shows a server file as a chip with its name, size and a real download button", () => {
    render(vi.fn<Download>(), threadView(THREAD_A, [REMOTE_FILE]));

    const chip = host.querySelector<HTMLElement>(".agent-prompt .agent-attachments__chip");
    expect(chip?.getAttribute("data-agent-attachment")).toBe("file");
    expect(chip?.title).toBe("report.pdf");
    expect(chip?.querySelector(".agent-attachments__name")?.textContent).toBe("report.pdf");
    expect(chip?.querySelector(".agent-attachments__size")?.textContent).toBe("4.8 MiB");

    const button = downloadButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(button.tabIndex).toBe(0);
    expect(button.title).toBe(AGENT_ATTACHMENT_DOWNLOAD_TITLE);
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.closest(".agent-attachments__chip")).toBe(chip);
    expect(button.querySelector("svg.lucide-download")).not.toBeNull();
  });

  it("offers no download for a local file, an image, a reference or a folder", () => {
    render(
      vi.fn<Download>(),
      threadView(THREAD_A, [LOCAL_FILE, IMAGE, REFERENCE, FOLDER], MIXED_PROMPT),
      readyImages(),
    );

    expect(host.querySelector<HTMLImageElement>(".agent-attachments__image")?.alt).toBe("shot.png");
    expect(
      [...host.querySelectorAll(".agent-attachments__chip")].map((chip) =>
        chip.getAttribute("data-agent-attachment"),
      ),
    ).toEqual(["file", "reference", "folder"]);
    expect(downloadButtons()).toEqual([]);
    expect(host.querySelector(".agent-attachments__size")).toBeNull();
  });

  it("renders a server file that looks like an image as a chip, never as an image", () => {
    render(vi.fn<Download>(), threadView(THREAD_A, [REMOTE_FILE_DECLARING_IMAGE]));

    expect(host.querySelector(".agent-attachments__image")).toBeNull();
    expect(host.querySelector(".agent-attachments__open")).toBeNull();
    expect(host.querySelector(".agent-attachments__pending")).toBeNull();
    expect(host.querySelector("svg.lucide-file-text")).not.toBeNull();
    expect(downloadButton("photo.png").type).toBe("button");
  });

  it("keeps the server identity of the attachment out of the DOM", () => {
    render(vi.fn<Download>(), threadView(THREAD_A, [REMOTE_FILE]));

    expect(host.innerHTML).not.toContain(RUNNER_FILE_ID);
    expect(host.innerHTML).not.toContain(SERVER_ID);
    expect(host.innerHTML).not.toContain(FILE_ID);
  });

  it("downloads with the thread and display attachment ids and shows a busy control", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, threadView(THREAD_A, [REMOTE_FILE, REMOTE_FILE_DECLARING_IMAGE]));
    const idleClass = downloadButton().className;

    act(() => downloadButton().click());

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(THREAD_A, FILE_ID);
    const busy = downloadButton();
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.disabled).toBe(false);
    expect(busy.title).toBe(AGENT_ATTACHMENT_DOWNLOADING_TITLE);
    expect(busy.className).toBe(idleClass);
    expect(busy.querySelector(".cv-spinner")).not.toBeNull();
    expect(busy.querySelector("svg.lucide-download")).toBeNull();
    expect(downloadButton("photo.png").getAttribute("aria-busy")).toBeNull();

    await act(async () => pending.resolve("saved"));

    expect(downloadButton().getAttribute("aria-busy")).toBeNull();
    expect(downloadButton().querySelector("svg.lucide-download")).not.toBeNull();
    expect(notice()).toBe("");
  });

  it("ignores repeated activation while the download is running", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, threadView(THREAD_A, [REMOTE_FILE]));

    act(() => {
      downloadButton().click();
      downloadButton().click();
    });
    act(() => downloadButton().click());
    expect(download).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve("saved"));
    act(() => downloadButton().click());
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the save dialog is dismissed", async () => {
    const download = vi.fn<Download>(async () => "cancelled");
    render(download, threadView(THREAD_A, [REMOTE_FILE]));

    await act(async () => downloadButton().click());

    expect(download).toHaveBeenCalledTimes(1);
    expect(notice()).toBe("");
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();
  });

  it("reports a failed download once with the error's own message", async () => {
    const reported: string[] = [];
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    function Reporting() {
      const attachmentDownloads = useAgentAttachmentDownloads({
        download,
        reportNotice: (next) => reported.push(next.message),
      });
      return (
        <AgentClockProvider nowTickMs={600_000}>
          <AgentThreadSession
            attachmentDownloads={attachmentDownloads}
            composerRepositoryLabel="app"
            markdownViewport={null}
            onReviewInDiff={() => undefined}
            thread={threadView(THREAD_A, [REMOTE_FILE])}
          />
        </AgentClockProvider>
      );
    }
    act(() => root.render(<Reporting />));
    act(() => downloadButton().click());

    await act(async () =>
      pending.reject(new AgentAttachmentDownloadError(REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR)),
    );

    expect(reported).toEqual([REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR]);
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();
  });

  it("shows the failure in the thread that started the download", async () => {
    const download = vi.fn<Download>(() =>
      Promise.reject(new AgentAttachmentDownloadError(REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR)),
    );
    render(download, threadView(THREAD_A, [REMOTE_FILE]));

    await act(async () => downloadButton().click());

    expect(notice()).toBe(REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR);
  });

  it("publishes nothing into another thread when the result arrives after switching", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, threadView(THREAD_A, [REMOTE_FILE]));
    act(() => downloadButton().click());
    expect(downloadButton().getAttribute("aria-busy")).toBe("true");

    render(download, threadView(THREAD_B, [REMOTE_FILE]));
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();

    await act(async () => pending.reject(new AgentAttachmentDownloadError("Late failure.")));

    expect(notice()).toBe("");
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();

    act(() => downloadButton().click());
    expect(download).toHaveBeenLastCalledWith(THREAD_B, FILE_ID);

    render(download, threadView(THREAD_A, [REMOTE_FILE]));
    expect(notice()).toBe("");
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();
  });

  it("keeps the first thread's download busy when the user returns before it settles", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, threadView(THREAD_A, [REMOTE_FILE]));
    act(() => downloadButton().click());

    render(download, threadView(THREAD_B, [REMOTE_FILE]));
    render(download, threadView(THREAD_A, [REMOTE_FILE]));

    expect(downloadButton().getAttribute("aria-busy")).toBe("true");
    act(() => downloadButton().click());
    expect(download).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve("saved"));
    expect(downloadButton().getAttribute("aria-busy")).toBeNull();
  });

  it("publishes nothing when the result arrives after the view unmounted", async () => {
    const reported: string[] = [];
    const pending = deferred();
    function Reporting() {
      const attachmentDownloads = useAgentAttachmentDownloads({
        download: () => pending.promise,
        reportNotice: (next) => reported.push(next.message),
      });
      return (
        <AgentThreadSession
          attachmentDownloads={attachmentDownloads}
          composerRepositoryLabel="app"
          markdownViewport={null}
          onReviewInDiff={() => undefined}
          thread={threadView(THREAD_A, [REMOTE_FILE])}
        />
      );
    }
    act(() => root.render(<Reporting />));
    act(() => downloadButton().click());

    act(() => root.unmount());
    await act(async () => pending.reject(new AgentAttachmentDownloadError("Late failure.")));

    expect(reported).toEqual([]);
    root = createRoot(host);
  });

  it("is reachable and operable from the keyboard, also while busy", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, threadView(THREAD_A, [REMOTE_FILE]));

    const button = downloadButton();
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });

    expect(download).toHaveBeenCalledWith(THREAD_A, FILE_ID);
    expect(downloadButton().getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(downloadButton());
    expect(downloadButton().tabIndex).toBe(0);

    await act(async () => pending.resolve("saved"));
    expect(document.activeElement).toBe(downloadButton());
  });

  it("shows the chip without a download control when no download surface is wired", () => {
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          markdownViewport={null}
          onReviewInDiff={() => undefined}
          thread={threadView(THREAD_A, [REMOTE_FILE])}
        />,
      ),
    );

    expect(host.querySelector(".agent-attachments__name")?.textContent).toBe("report.pdf");
    expect(host.querySelector(".agent-attachments__size")?.textContent).toBe("4.8 MiB");
    expect(downloadButtons()).toEqual([]);
  });
});

function readyImages(): AgentAttachmentImagesSurface {
  const images = new Map<string, AgentAttachmentImageState>([
    [agentAttachmentImageKey(OWNER_ID, THREAD_A, IMAGE_ID), { kind: "ready", url: "blob:shot" }],
  ]);
  return {
    images,
    ensure: () => undefined,
    holdThread: () => () => undefined,
    releaseWorkspace: () => undefined,
  };
}

function turn(prompt: string, attachments: ReadonlyArray<AgentAttachment>): AgentTurn {
  return {
    turnId: "turn-1",
    prompt,
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: NOW - 30_000,
    events: [{ kind: "assistantText", text: "done" }],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    attachments,
  };
}

function threadView(
  threadId: string,
  attachments: ReadonlyArray<AgentAttachment>,
  prompt = "Read these",
): AgentThreadView {
  const record: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 600_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [turn(prompt, attachments)],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    fileNavigationAvailability: { kind: "available" },
    attention: agentThreadAttention(record),
    unread: agentThreadUnread(record),
    thread: record,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
