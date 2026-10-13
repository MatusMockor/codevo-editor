// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice, AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  AgentAttachmentDownloadError,
  LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL,
  REMOTE_ATTACHMENT_DOWNLOAD_FAILED,
} from "../../application/remoteAttachmentDownload";
import { REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR } from "../../domain/remoteRunnerFileAttachment";
import { MAX_AGENT_ATTACHMENT_DOWNLOADS } from "./agentAttachmentDownloadStore";
import {
  AGENT_ATTACHMENT_DOWNLOADS_FULL_MESSAGE,
  useAgentAttachmentDownloads,
  type AgentAttachmentDownloadsSurface,
} from "./useAgentAttachmentDownloads";
import { useScopedAgentNotice } from "./useScopedAgentNotice";

type Download = AgentThreadsSurface["downloadAttachment"];
type Outcome = Awaited<ReturnType<Download>>;

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

describe("useAgentAttachmentDownloads", () => {
  let host: HTMLDivElement;
  let root: Root;
  let surface!: AgentAttachmentDownloadsSurface;
  let notices: AgentTasksNotice[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    notices = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({ download, owner }: { readonly download: Download; readonly owner: string }) {
    const [notice, reportNotice] = useScopedAgentNotice(owner);
    surface = useAgentAttachmentDownloads({
      download,
      reportNotice: (next) => {
        notices.push(next);
        reportNotice(next);
      },
    });
    const busy = useSyncExternalStore(surface.subscribe, () =>
      surface.isDownloading(owner, "file-1"),
    );
    return (
      <p data-busy={busy} data-owner={owner}>
        {notice?.message ?? ""}
      </p>
    );
  }

  function render(download: Download, owner = "thread-a"): void {
    act(() => root.render(<Probe download={download} owner={owner} />));
  }

  function shown(): string {
    return host.textContent ?? "";
  }

  function busy(): string | undefined {
    return host.querySelector<HTMLElement>("p")?.dataset.busy;
  }

  it("starts the download with the exact thread and attachment ids and marks it busy", () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download);

    act(() => surface.download("thread-a", "file-1"));

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("thread-a", "file-1");
    expect(busy()).toBe("true");
    expect(surface.isDownloading("thread-b", "file-1")).toBe(false);
    expect(surface.isDownloading("thread-a", "file-2")).toBe(false);
  });

  it("ignores a repeated activation while the same download is running", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download);

    act(() => {
      surface.download("thread-a", "file-1");
      surface.download("thread-a", "file-1");
    });
    act(() => surface.download("thread-a", "file-1"));
    expect(download).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve("saved"));
    expect(busy()).toBe("false");

    act(() => surface.download("thread-a", "file-1"));
    expect(download).toHaveBeenCalledTimes(2);
  });

  it.each(["saved", "cancelled"] as const)(
    "clears the busy state silently when the download is %s",
    async (outcome) => {
      const pending = deferred();
      render(() => pending.promise);
      act(() => surface.download("thread-a", "file-1"));

      await act(async () => pending.resolve(outcome));

      expect(busy()).toBe("false");
      expect(notices).toEqual([]);
      expect(shown()).toBe("");
    },
  );

  it("reports a rejected download once with the error's own message", async () => {
    const pending = deferred();
    render(() => pending.promise);
    act(() => surface.download("thread-a", "file-1"));

    await act(async () =>
      pending.reject(new AgentAttachmentDownloadError(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR)),
    );

    expect(busy()).toBe("false");
    expect(notices).toEqual([
      { kind: "warning", message: REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR, action: null },
    ]);
    expect(shown()).toBe(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR);
  });

  it("reports the local refusal verbatim", async () => {
    render(() =>
      Promise.reject(new AgentAttachmentDownloadError(LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL)),
    );

    await act(async () => surface.download("thread-a", "file-1"));

    expect(notices.map((notice) => notice.message)).toEqual([LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL]);
    expect(busy()).toBe("false");
  });

  it("reports a download that throws before returning a promise", async () => {
    render(() => {
      throw new AgentAttachmentDownloadError("The file could not be saved.");
    });

    await act(async () => surface.download("thread-a", "file-1"));

    expect(notices.map((notice) => notice.message)).toEqual(["The file could not be saved."]);
    expect(busy()).toBe("false");
  });

  it.each([[""], [undefined], [{ code: 7 }], ["x".repeat(1_001)]])(
    "falls back to bounded copy when a rejection carries no presentable message",
    async (reason) => {
      render(() => Promise.reject(reason === undefined ? undefined : toRejection(reason)));

      await act(async () => surface.download("thread-a", "file-1"));

      expect(notices.map((notice) => notice.message)).toEqual([REMOTE_ATTACHMENT_DOWNLOAD_FAILED]);
    },
  );

  it("refuses more than the bounded number of concurrent downloads and says so", () => {
    const download = vi.fn<Download>(() => deferred().promise);
    render(download);

    act(() => {
      for (let index = 0; index <= MAX_AGENT_ATTACHMENT_DOWNLOADS; index += 1)
        surface.download("thread-a", `file-${index}`);
    });

    expect(download).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_DOWNLOADS);
    expect(surface.isDownloading("thread-a", `file-${MAX_AGENT_ATTACHMENT_DOWNLOADS}`)).toBe(false);
    expect(notices.map((notice) => notice.message)).toEqual([
      AGENT_ATTACHMENT_DOWNLOADS_FULL_MESSAGE,
    ]);
  });

  it("publishes nothing into another thread when a failure arrives after switching", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, "thread-a");
    act(() => surface.download("thread-a", "file-1"));

    render(download, "thread-b");
    expect(busy()).toBe("false");
    expect(surface.isDownloading("thread-a", "file-1")).toBe(true);

    await act(async () => pending.reject(new AgentAttachmentDownloadError("Late failure.")));

    expect(shown()).toBe("");
    expect(busy()).toBe("false");
    expect(surface.isDownloading("thread-a", "file-1")).toBe(false);

    render(download, "thread-a");
    expect(shown()).toBe("");
    expect(busy()).toBe("false");
  });

  it("keeps the busy state of the first thread while another thread is shown", async () => {
    const pending = deferred();
    const download = vi.fn<Download>(() => pending.promise);
    render(download, "thread-a");
    act(() => surface.download("thread-a", "file-1"));

    render(download, "thread-b");
    render(download, "thread-a");
    expect(busy()).toBe("true");
    act(() => surface.download("thread-a", "file-1"));
    expect(download).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve("saved"));
    expect(busy()).toBe("false");
  });

  it("publishes nothing after unmount", async () => {
    const pending = deferred();
    render(() => pending.promise);
    const held = surface;
    const listener = vi.fn();
    held.subscribe(listener);
    act(() => held.download("thread-a", "file-1"));
    listener.mockClear();

    act(() => root.unmount());
    expect(held.isDownloading("thread-a", "file-1")).toBe(false);
    listener.mockClear();

    await act(async () => pending.reject(new AgentAttachmentDownloadError("Late failure.")));

    expect(listener).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    root = createRoot(host);
  });
});

function toRejection(reason: string | object): unknown {
  return typeof reason === "string" ? new Error(reason) : reason;
}
