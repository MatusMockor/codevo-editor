// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { press } from "../../../../ui/foundation/foundationTestSupport";
import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import {
  createAgentFileViewerSessions,
  externalFileDocument,
  type AgentFileViewerSessions,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import { rightPanelTestContext } from "../agentRightPanelTestSupport";
import type { AgentFilesReveal } from "../files/AgentFilesSurface";
import {
  ROOT,
  deferred,
  entry,
  fileTree,
  installViewerTestEnvironment,
  memoryReader,
  render,
  row,
  settle,
  text,
  tree,
  unmountSurface,
  viewerText,
} from "./fileViewerTestSupport";
import { FILE_VIEWER_EXTERNAL_NOTE } from "./AgentFileViewer";
import { FILE_VIEWER_WRAP_STORAGE_KEY } from "./useFileViewerWrap";

installViewerTestEnvironment();

function thread(threadId: string): AgentThreadView {
  const base = surfaceThreadView();
  return {
    ...base,
    thread: {
      ...base.thread,
      threadId,
      target: { isolation: "in-place", worktreePath: null },
    },
  };
}

function viewerPath(host: HTMLElement): string | null {
  return host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-path") ?? null;
}

function scroller(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(".cv-file-viewer__code");
  if (element === null) throw new Error("No code scroller");
  return element;
}

const files = {
  "src/app.ts": text("src/app.ts", "thread a file"),
  "src/big.ts": text("src/big.ts", "thread b file"),
};

describe("viewer state per thread", () => {
  it("keeps each thread's own open file across A -> B -> A on the same checkout", async () => {
    const { reader } = memoryReader(files);
    const a = rightPanelTestContext({ thread: thread("agt-a") });
    const b = rightPanelTestContext({ thread: thread("agt-b") });

    const host = render({ reader, context: a });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(viewerPath(host)).toBe("src/app.ts");

    render({ reader, context: b });
    await settle();
    expect(viewerPath(host)).toBeNull();
    act(() => row(host, `${ROOT}/src/big.ts`).click());
    await settle();
    expect(viewerText(host)).toContain("thread b file");

    render({ reader, context: a });
    await settle();
    expect(viewerPath(host)).toBe("src/app.ts");
    expect(viewerText(host)).toContain("thread a file");

    render({ reader, context: b });
    await settle();
    expect(viewerPath(host)).toBe("src/big.ts");
  });

  it("restores each thread's file across A -> B -> A with different roots", async () => {
    const { reader, calls } = memoryReader(files);
    const a = rightPanelTestContext({ thread: thread("agt-a") });
    const b = rightPanelTestContext({ thread: thread("agt-b") });
    const otherRoot = "/other";
    const otherTree = fileTree({
      tree: tree({
        rootPath: otherRoot,
        entriesByDirectory: { [otherRoot]: [entry(`${otherRoot}/src/big.ts`)] },
        expandedDirectories: new Set(),
      }),
    });

    const host = render({ reader, context: a });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    render({ reader, context: b, fileTree: otherTree });
    await settle();
    expect(viewerPath(host)).toBeNull();
    act(() => row(host, `${otherRoot}/src/big.ts`).click());
    await settle();

    render({ reader, context: a });
    await settle();
    expect(viewerPath(host)).toBe("src/app.ts");
    expect(calls[calls.length - 1]).toEqual({ root: ROOT, path: "src/app.ts" });
    render({ reader, context: b, fileTree: otherTree });
    await settle();
    expect(viewerPath(host)).toBe("src/big.ts");
    expect(calls[calls.length - 1]).toEqual({ root: otherRoot, path: "src/big.ts" });
  });

  it("never publishes thread A's pending preview into thread B", async () => {
    const pending = deferred();
    const { reader } = memoryReader({ "src/app.ts": () => pending.promise });
    const a = rightPanelTestContext({ thread: thread("agt-a") });
    const b = rightPanelTestContext({ thread: thread("agt-b") });
    const host = render({ reader, context: a });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    render({ reader, context: b });
    await act(async () => pending.resolve(text("src/app.ts", "late a contents")));

    expect(viewerPath(host)).toBeNull();
    expect(host.textContent).not.toContain("late a contents");
  });

  it("does not replay a handled reveal when the Files tab is closed and reopened", async () => {
    const sessions = createAgentFileViewerSessions();
    const { reader } = memoryReader(files);
    const reveal: AgentFilesReveal = { path: `${ROOT}/src/app.ts`, line: 1, sequence: 7 };
    const host = render({ reader, sessions, reveal });
    await settle();
    expect(viewerPath(host)).toBe("src/app.ts");
    press(host.querySelector<HTMLElement>(".cv-file-viewer") as HTMLElement, "Escape");

    unmountSurface();
    const reopened = render({ reader, sessions, reveal });
    await settle();

    expect(viewerPath(reopened)).toBeNull();
    expect(reopened.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
  });

  it("keeps the open file and its scroll position while another tab is shown", async () => {
    const sessions = createAgentFileViewerSessions();
    const contents = Array.from({ length: 2_000 }, (_unused, index) => `row ${index}`).join("\n");
    const { reader } = memoryReader({ "src/big.ts": text("src/big.ts", contents) });
    const host = render({ reader, sessions });
    act(() => row(host, `${ROOT}/src/big.ts`).click());
    await settle();
    act(() => {
      const element = scroller(host);
      element.scrollTop = 4_000;
      element.dispatchEvent(new Event("scroll"));
    });

    render({ reader, sessions, treeShown: false, fileTree: null });
    expect(viewerPath(host)).toBeNull();
    unmountSurface();
    const shown = render({ reader, sessions });
    await settle();

    expect(viewerPath(shown)).toBe("src/big.ts");
    expect(scroller(shown).scrollTop).toBe(4_000);
  });
});

describe("reveal requests report whether the viewer accepted them", () => {
  function requester(sessions: AgentFileViewerSessions, context = rightPanelTestContext()) {
    const { reader, calls } = memoryReader({ "src/app.ts": text("src/app.ts", "inside") });
    let sequence = 0;
    const show = (reveal: AgentFilesReveal) => render({ reader, sessions, context, reveal });
    const reveal = (path: string, line: number | null = null, contents?: string) => {
      const payload = contents === undefined ? null : externalFileDocument(path, contents);
      const ticket = sessions.requests.begin(path, line, sessions.requests.currentOwner(), payload);
      if (ticket === null) throw new Error("reveal refused");
      sequence += 1;
      return { ticket, reveal: { path, line, sequence, request: ticket.id } };
    };
    return { calls, show, reveal, host: show({ path: "", line: null, sequence: 0 }) };
  }

  it("resolves true for a file in the tree and false for one outside it", async () => {
    const sessions = createAgentFileViewerSessions();
    const view = requester(sessions);

    const inside = view.reveal(`${ROOT}/src/app.ts`);
    view.show(inside.reveal);
    await settle();
    await expect(inside.ticket.settled).resolves.toBe(true);
    expect(viewerPath(view.host)).toBe("src/app.ts");

    const outside = view.reveal("/elsewhere/notes.txt");
    view.show(outside.reveal);
    await settle();
    await expect(outside.ticket.settled).resolves.toBe(false);
    expect(viewerPath(view.host)).toBe("src/app.ts");
  });

  it("settles only the request that was consumed, not another one for the same location", async () => {
    const sessions = createAgentFileViewerSessions();
    sessions.requests.bindOwner("agt-b");
    const view = requester(sessions, rightPanelTestContext({ thread: thread("agt-b") }));
    const earlier = view.reveal(`${ROOT}/src/app.ts`, 3);
    const later = view.reveal(`${ROOT}/src/app.ts`, 3);

    view.show(later.reveal);
    await settle();

    await expect(later.ticket.settled).resolves.toBe(true);
    expect(sessions.requests.stateOf(earlier.ticket.id)).toBe("pending");
  });

  it("rejects a reveal that belongs to another thread", async () => {
    const sessions = createAgentFileViewerSessions();
    sessions.requests.bindOwner("agt-a");
    const view = requester(sessions, rightPanelTestContext({ thread: thread("agt-b") }));
    const fromA = view.reveal(`${ROOT}/src/app.ts`);

    view.show(fromA.reveal);
    await settle();

    await expect(fromA.ticket.settled).resolves.toBe(false);
    expect(viewerPath(view.host)).toBeNull();
  });

  it("expires a thread's reveal when that thread is left and re-entered (A -> B -> A)", async () => {
    const sessions = createAgentFileViewerSessions();
    sessions.requests.bindOwner("agt-a");
    const view = requester(sessions, rightPanelTestContext({ thread: thread("agt-a") }));
    const stale = view.reveal(`${ROOT}/src/app.ts`);

    sessions.requests.bindOwner("agt-b");
    sessions.requests.bindOwner("agt-a");
    await expect(stale.ticket.settled).resolves.toBe(false);
    expect(sessions.requests.stateOf(stale.ticket.id)).toBe("expired");
    view.show(stale.reveal);
    await settle();

    expect(viewerPath(view.host)).toBeNull();
    expect(view.calls).toEqual([]);

    const fresh = view.reveal(`${ROOT}/src/app.ts`);
    view.show(fresh.reveal);
    await settle();
    await expect(fresh.ticket.settled).resolves.toBe(true);
    expect(viewerPath(view.host)).toBe("src/app.ts");
  });

  it("never executes a reveal after its request timed out", async () => {
    const sessions = createAgentFileViewerSessions(30);
    const view = requester(sessions);
    const late = view.reveal(`${ROOT}/src/app.ts`);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await expect(late.ticket.settled).resolves.toBe(false);
    expect(sessions.requests.stateOf(late.ticket.id)).toBe("expired");
    view.show(late.reveal);
    await settle();

    expect(viewerPath(view.host)).toBeNull();
    expect(view.calls).toEqual([]);
  });

  it("shows an external file as a bounded read-only snapshot, once", async () => {
    const sessions = createAgentFileViewerSessions();
    const view = requester(sessions);
    const external = view.reveal("/home/me/notes.txt", 1, "outside notes");

    view.show(external.reveal);
    await settle();

    await expect(external.ticket.settled).resolves.toBe(true);
    expect(view.calls).toEqual([]);
    expect(
      view.host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-document"),
    ).toBe("external");
    expect(view.host.querySelector('.cv-file-viewer [role="note"]')?.textContent).toBe(
      FILE_VIEWER_EXTERNAL_NOTE,
    );
    expect(viewerText(view.host)).toContain("outside notes");
    expect(view.host.querySelector('[aria-label="Reload file"]')).toBeNull();

    const again = view.reveal("/home/me/notes.txt");
    view.show(again.reveal);
    await settle();
    await expect(again.ticket.settled).resolves.toBe(false);
  });
});

describe("code font and wrapped reveal", () => {
  it("follows the editor font family and size", async () => {
    const { reader } = memoryReader(files);
    const host = render({ reader, font: { family: "Fira Code", size: 15 } });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    const element = scroller(host);
    expect(element.style.fontFamily).toContain("Fira Code");
    expect(element.style.fontSize).toBe("15px");
    expect(element.style.getPropertyValue("--file-viewer-line-height")).toBe("23px");
  });

  it("re-centres a revealed line after wrapped rows above it are measured", async () => {
    window.localStorage.setItem(FILE_VIEWER_WRAP_STORAGE_KEY, "true");
    const rowHeight = 40;
    const viewportHeight = 400;
    const restore = installWrappedLayout(rowHeight, viewportHeight);
    try {
      const contents = Array.from({ length: 200 }, (_unused, index) => `line ${index + 1}`).join(
        "\n",
      );
      const { reader } = memoryReader({ "src/big.ts": text("src/big.ts", contents) });
      const host = render({
        reader,
        reveal: { path: `${ROOT}/src/big.ts`, line: 100, sequence: 1 },
      });
      await settle();
      await settle();

      const expected = 99 * rowHeight - viewportHeight / 2 + rowHeight / 2;
      expect(scroller(host).scrollTop).toBe(expected);
      expect(host.querySelector('[data-line="100"]')?.getAttribute("aria-current")).toBe("true");
    } finally {
      restore();
    }
  });
});

function installWrappedLayout(rowHeight: number, viewportHeight: number): () => void {
  const prototype = HTMLElement.prototype;
  const originals = {
    offsetHeight: Object.getOwnPropertyDescriptor(prototype, "offsetHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
    rect: prototype.getBoundingClientRect,
  };
  const rowsIn = (element: HTMLElement) => element.querySelectorAll("[data-line]").length;
  const scrollerOf = (element: Element) => element.closest<HTMLElement>(".cv-file-viewer__code");
  Object.defineProperty(prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-file-viewer-block")) return rowsIn(this) * rowHeight;
      if (this.hasAttribute("data-line")) return rowHeight;
      return 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.classList.contains("cv-file-viewer__code") ? viewportHeight : 0;
    },
  });
  prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    const line = Number(this.getAttribute("data-line"));
    const container = scrollerOf(this);
    const top =
      this.hasAttribute("data-line") && container !== null
        ? (line - 1) * rowHeight - container.scrollTop
        : 0;
    return { top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top } as DOMRect;
  };
  return () => {
    if (originals.offsetHeight !== undefined) {
      Object.defineProperty(prototype, "offsetHeight", originals.offsetHeight);
    }
    if (originals.clientHeight !== undefined) {
      Object.defineProperty(Element.prototype, "clientHeight", originals.clientHeight);
    }
    prototype.getBoundingClientRect = originals.rect;
  };
}
