// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInlineImageGateway } from "../../application/agentInlineImagePorts";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentAttachmentImageKey,
  type AgentAttachmentImagesSurface,
} from "../../application/useAgentAttachmentImages";
import {
  AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON,
  AGENT_INLINE_IMAGE_DECODE_FAILED_REASON,
  AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  useAgentInlineImages,
} from "../../application/useAgentInlineImages";
import type { AgentAttachment } from "../../domain/agentAttachment";
import { MAX_AGENT_INLINE_IMAGES_PER_MESSAGE } from "../../domain/agentMarkdown/agentInlineImage";
import { AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE } from "../../domain/agentMarkdown/agentMarkdownTree";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import { findInThread, type AgentThreadFindHit } from "../../domain/agentThreadSearch";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { createIntersectionAgentMarkdownViewport } from "../../infrastructure/viewport/intersectionAgentMarkdownViewport";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AGENT_INLINE_IMAGES_TRUNCATED_NOTE } from "./AgentAssistantText";
import {
  AGENT_LIGHTBOX_NEXT_LABEL,
  AGENT_LIGHTBOX_PREVIOUS_LABEL,
  AGENT_LIGHTBOX_REVEAL_LABEL,
} from "./AgentAttachmentLightbox";
import {
  AGENT_INLINE_IMAGE_RETRY_HINT,
  AGENT_INLINE_IMAGE_WAITING_LABEL,
} from "./AgentMarkdownImage";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import type { AgentLocalFileLinkPort } from "./agentMarkdownLinks";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

type ReadInlineImage = AgentInlineImageGateway["readAgentInlineImage"];

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const OTHER_OWNER_ID = "agent-root:other";
const THREAD_ID = "agt-1";
const OTHER_THREAD_ID = "agt-2";
const NOW = 1_700_000_600_000;
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GONE = "The image is no longer available.";
const BOX = "button.agent-md__inline-image, button.agent-md__inline-image-chip";
const SLOT = 'button.agent-md__inline-image[data-state="loading"]';
const OPENER = 'button.agent-md__inline-image[data-state="ready"]';
const CHIP = "button.agent-md__inline-image-chip";
const LABEL = ".agent-md__image";
const ATTACHMENT_ID = "a".repeat(32);
const ATTACHMENT_URL = "blob:attachment";

const FILE_LINKS: AgentLocalFileLinkPort = {
  open: async () => "opened",
  report: () => undefined,
};

interface ObjectUrls {
  readonly created: string[];
  readonly revoked: string[];
  create(blob: Blob): string;
  revoke(url: string): void;
}

interface PlatformLayout {
  visible(element: Element): boolean;
  near(element: Element): boolean;
}

interface TestPlatform {
  readonly port: AgentMarkdownViewport;
  watched(): ReadonlyArray<Element>;
  enter(element: Element | undefined): void;
  leave(element: Element | undefined): void;
  restore(): void;
}

const FAR_AWAY_PX = 50_000;
const ON_SCREEN: PlatformLayout = { visible: () => true, near: () => true };
const OFF_SCREEN: PlatformLayout = {
  visible: () => true,
  near: (element) => !element.matches(BOX),
};

function png(): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE);
  return bytes.buffer;
}

function objectUrls(): ObjectUrls {
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    create: () => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    },
    revoke: (url) => {
      revoked.push(url);
    },
  };
}

function deferredReads() {
  const pending: Array<{ resolve(value: ArrayBuffer): void; reject(error: unknown): void }> = [];
  const read = vi.fn<ReadInlineImage>(
    () => new Promise<ArrayBuffer>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return { pending, read };
}

class FakeIntersectionObserver {
  readonly targets = new Set<Element>();

  constructor(readonly deliver: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe(element: Element): void {
    this.targets.add(element);
  }

  unobserve(element: Element): void {
    this.targets.delete(element);
  }

  disconnect(): void {
    this.targets.clear();
  }
}

const observers: FakeIntersectionObserver[] = [];

function testPlatform(layout: PlatformLayout): TestPlatform {
  const rect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function measure(this: Element) {
      const top = layout.near(this) ? 0 : FAR_AWAY_PX;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
    });
  Object.defineProperty(Element.prototype, "checkVisibility", {
    configurable: true,
    value: function checkVisibility(this: Element): boolean {
      return layout.visible(this);
    },
  });
  Reflect.set(globalThis, "IntersectionObserver", FakeIntersectionObserver);
  const viewport = createIntersectionAgentMarkdownViewport(() =>
    document.querySelector(".agent-session__scroll"),
  );
  expect(viewport).not.toBeNull();
  const port = viewport as AgentMarkdownViewport;
  const report = (element: Element | undefined, isIntersecting: boolean): void => {
    expect(element).toBeInstanceOf(Element);
    for (const observer of observers) {
      if (element === undefined || !observer.targets.has(element)) continue;
      const entry = { target: element, isIntersecting } as IntersectionObserverEntry;
      observer.deliver([entry], observer as unknown as IntersectionObserver);
    }
  };
  return {
    port,
    watched: () =>
      observers
        .flatMap((observer) => [...observer.targets])
        .filter((element) => element.matches(BOX)),
    enter: (element) => report(element, true),
    leave: (element) => report(element, false),
    restore() {
      port.dispose();
      rect.mockRestore();
      Reflect.deleteProperty(Element.prototype, "checkVisibility");
      Reflect.deleteProperty(globalThis, "IntersectionObserver");
      observers.length = 0;
    },
  };
}

let sessionRenders = 0;

function Session({
  gateway,
  props,
  urls,
}: {
  readonly gateway: AgentInlineImageGateway | null;
  readonly props: Partial<AgentThreadSessionProps>;
  readonly urls: ObjectUrls;
}) {
  sessionRenders += 1;
  const inlineImages = useAgentInlineImages({
    gateway,
    createObjectUrl: urls.create,
    revokeObjectUrl: urls.revoke,
  });
  return (
    <AgentClockProvider nowTickMs={600_000}>
      <AgentThreadSession
        composerRepositoryLabel="app"
        localFileLinks={FILE_LINKS}
        onReviewInDiff={ignore}
        thread={null}
        {...props}
        inlineImages={inlineImages}
      />
    </AgentClockProvider>
  );
}

describe("AgentThreadSession inline images", () => {
  let host: HTMLDivElement;
  let shell: HTMLDivElement;
  let root: Root;
  let urls: ObjectUrls;
  let read: ReturnType<typeof vi.fn<ReadInlineImage>>;
  let platform: TestPlatform | null = null;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    shell = document.createElement("div");
    shell.className = "workbench-frame";
    host.append(shell);
    document.body.append(host);
    root = createRoot(shell);
    urls = objectUrls();
    read = vi.fn<ReadInlineImage>(async () => png());
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    platform?.restore();
    platform = null;
    vi.useRealTimers();
  });

  function onPlatform(layout: PlatformLayout): TestPlatform {
    platform = testPlatform(layout);
    return platform;
  }

  function render(props: Partial<AgentThreadSessionProps>, reader: ReadInlineImage = read): void {
    act(() =>
      root.render(<Session gateway={{ readAgentInlineImage: reader }} props={props} urls={urls} />),
    );
  }

  async function renderSettled(
    props: Partial<AgentThreadSessionProps>,
    images: number,
    reader: ReadInlineImage = read,
  ): Promise<void> {
    render(props, reader);
    await waitForReact(() =>
      expect(shell.querySelectorAll(`${OPENER} > img`)).toHaveLength(images),
    );
  }

  function message(index = 0): HTMLElement {
    const element = shell.querySelector<HTMLElement>(`[data-agent-event="e${index}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function pictures(scope: ParentNode = shell): ReadonlyArray<HTMLImageElement> {
    return [...scope.querySelectorAll<HTMLImageElement>(`${OPENER} > img`)];
  }

  function openers(scope: ParentNode = shell): ReadonlyArray<HTMLButtonElement> {
    return [...scope.querySelectorAll<HTMLButtonElement>(OPENER)];
  }

  function boxes(scope: ParentNode = shell): ReadonlyArray<HTMLButtonElement> {
    return [...scope.querySelectorAll<HTMLButtonElement>(BOX)];
  }

  function lightbox(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".agent-lightbox");
  }

  function lightboxSource(): string | null {
    const image = lightbox()?.querySelector<HTMLImageElement>(".agent-lightbox__image");
    return image?.getAttribute("src") ?? null;
  }

  function click(target: Element | null | undefined): void {
    expect(target).toBeInstanceOf(Element);
    act(() => {
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function press(
    target: Element | null | undefined,
    key: string,
    init: KeyboardEventInit = {},
  ): void {
    expect(target).toBeInstanceOf(Element);
    act(() => {
      target?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
      );
    });
  }

  function fire(target: Element | null | undefined, type: "load" | "error"): void {
    expect(target).toBeInstanceOf(Element);
    act(() => {
      target?.dispatchEvent(new Event(type));
    });
  }

  function loadPicture(target: HTMLImageElement | undefined, width: number, height: number): void {
    expect(target).toBeInstanceOf(HTMLImageElement);
    if (target === undefined) return;
    Object.defineProperties(target, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
    fire(target, "load");
  }

  function scrollContainer(dimensions: {
    readonly scrollHeight: number;
    readonly clientHeight: number;
    readonly scrollTop: number;
  }): HTMLDivElement {
    const scroll = shell.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: dimensions.scrollHeight },
      clientHeight: { configurable: true, value: dimensions.clientHeight },
      scrollTop: { configurable: true, value: dimensions.scrollTop, writable: true },
    });
    return scroll as HTMLDivElement;
  }

  describe("which images render inline", () => {
    it.each([
      ["an absolute path", "![shot](/abs/x.png)", "/abs/x.png"],
      ["a workspace-relative path", "![shot](rel/x.png)", `${ROOT}/rel/x.png`],
      ["a file URL", "![shot](file:///abs/x.png)", "/abs/x.png"],
      [
        "an angle-bracket path with a space",
        "![shot](<dir with space/x.png>)",
        `${ROOT}/dir with space/x.png`,
      ],
      ["a percent-encoded space", "![shot](My%20Image.png)", `${ROOT}/My Image.png`],
      ["an encoded percent sign", "![shot](My%2520Image.png)", `${ROOT}/My%20Image.png`],
      ["a literal percent sign", "![shot](50%25faster.png)", `${ROOT}/50%faster.png`],
      ["an encoded hash", "![shot](shots/a%23b.png)", `${ROOT}/shots/a#b.png`],
    ])("shows the real image for %s", async (_label, markdown, path) => {
      await renderSettled({ thread: view(SETTLED, [markdown]) }, 1);

      const [picture] = pictures();
      expect(picture?.getAttribute("src")).toBe("blob:0");
      expect(picture?.getAttribute("decoding")).toBe("async");
      expect(picture?.getAttribute("draggable")).toBe("false");
      expect(picture?.alt).toBe("shot");
      expect(openers()[0]?.getAttribute("aria-label")).toBe("Open image shot");
      expect(read.mock.calls).toEqual([[{ workspaceId: OWNER_ID, threadId: THREAD_ID, path }]]);
      expect(message().querySelector(LABEL)).toBeNull();
    });

    it("names an image without alt text by its file name", async () => {
      await renderSettled({ thread: view(SETTLED, ["![](</abs/login page.png>)"]) }, 1);

      expect(openers()[0]?.getAttribute("aria-label")).toBe("Open image login page.png");
    });

    it("reserves a 16:9 slot for a standalone image and a small one inside a sentence", async () => {
      const { pending, read: deferred } = deferredReads();
      const text = "![alone](/abs/a.png)\n\nSee ![inside](/abs/b.png) here.";
      render({ thread: view(SETTLED, [text]) }, deferred);

      const slots = [...message().querySelectorAll<HTMLElement>(SLOT)];
      expect(slots.map((slot) => slot.getAttribute("data-layout"))).toEqual([
        "standalone",
        "inline",
      ]);
      expect(slots.map((slot) => slot.hasAttribute("role"))).toEqual([false, false]);
      expect(slots.map((slot) => slot.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
      expect(slots.map((slot) => slot.getAttribute("tabindex"))).toEqual(["-1", "-1"]);
      expect(slots.map((slot) => slot.getAttribute("data-box"))).toEqual(["slot", "slot"]);
      expect(slots.map((slot) => slot.getAttribute("aria-label"))).toEqual([
        "Loading image",
        "Loading image",
      ]);
      expect(message().querySelector('[role="status"]')).toBeNull();
      expect(pictures()).toHaveLength(0);
      expect(slots[1]?.closest("p")?.textContent).toBe("See  here.");

      await act(async () => pending.forEach((entry) => entry.resolve(png())));

      expect(openers().map((opener) => opener.getAttribute("data-layout"))).toEqual([
        "standalone",
        "inline",
      ]);
      expect(message().querySelector(SLOT)).toBeNull();
    });

    it("keeps the reserved box until the picture has loaded, then sizes it from the picture", async () => {
      const { pending, read: deferred } = deferredReads();
      render({ thread: view(SETTLED, ["![alone](/abs/a.png)"]) }, deferred);
      const slot = message().querySelector<HTMLButtonElement>(SLOT);
      expect(slot?.getAttribute("data-box")).toBe("slot");

      await act(async () => pending[0]?.resolve(png()));

      const opener = openers()[0];
      expect(opener).toBe(slot);
      expect(opener?.getAttribute("data-loaded")).toBe("false");
      expect(opener?.getAttribute("data-box")).toBe("slot");
      expect(opener?.getAttribute("data-layout")).toBe("standalone");
      expect(opener?.style.inlineSize).toBe("");
      expect(opener?.hasAttribute("aria-disabled")).toBe(false);
      expect(opener?.hasAttribute("tabindex")).toBe(false);
      expect(pictures()[0]?.hasAttribute("width")).toBe(false);

      loadPicture(pictures()[0], 2_560, 1_440);

      expect(openers()[0]).toBe(slot);
      expect(opener?.getAttribute("data-loaded")).toBe("true");
      expect(opener?.getAttribute("data-box")).toBe("sized");
      expect(opener?.style.inlineSize).toBe("min(100%, 2560px, 30rem, 53.333rem)");
      expect(opener?.style.aspectRatio).toBe("2560 / 1440");
      expect(pictures()[0]?.getAttribute("width")).toBe("2560");
      expect(pictures()[0]?.getAttribute("height")).toBe("1440");
    });

    it("caps a picture in a table cell at the cell slot size", async () => {
      const text = "| shot |\n|---|\n| ![tall](/abs/tall.png) |";
      await renderSettled({ thread: view(SETTLED, [text]) }, 1);
      expect(openers()[0]?.getAttribute("data-host")).toBe("cell");

      loadPicture(pictures()[0], 600, 1_200);

      expect(openers()[0]?.style.inlineSize).toBe("min(600px, 12rem, 6rem)");
    });

    it("renders a remounted picture at its known size without going back to the slot", async () => {
      const text = "Intro parser.\n\n![parser diagram](/abs/x.png)";
      const thread = view(SETTLED, [text]);
      await renderSettled({ thread }, 1);
      loadPicture(pictures()[0], 800, 400);
      const hits = hitsFor(thread, "diagram");

      render({ thread, findQuery: "diagram", findHits: hits, findHitIndex: 0 });
      await act(async () => undefined);
      expect(pictures()).toHaveLength(0);
      render({ thread, findQuery: "", findHits: [], findHitIndex: undefined });
      await act(async () => undefined);

      const opener = openers()[0];
      expect(opener?.getAttribute("data-box")).toBe("sized");
      expect(opener?.getAttribute("data-loaded")).toBe("false");
      expect(opener?.style.inlineSize).toBe("min(100%, 800px, 30rem, 60rem)");
      expect(pictures()[0]?.getAttribute("width")).toBe("800");
      expect(pictures()[0]?.getAttribute("height")).toBe("400");
      expect(read).toHaveBeenCalledTimes(1);
    });

    it("treats an emphasised lone image, a list item and a table cell as standalone", async () => {
      const text = [
        "*![one](/abs/1.png)*",
        "",
        "- ![two](/abs/2.png)",
        "",
        "| shot |",
        "|---|",
        "| ![three](/abs/3.png) |",
      ].join("\n");
      await renderSettled({ thread: view(SETTLED, [text]) }, 3);

      expect(openers().map((opener) => opener.getAttribute("data-layout"))).toEqual([
        "standalone",
        "standalone",
        "standalone",
      ]);
      expect(openers()[0]?.closest("em")).not.toBeNull();
      expect(openers()[1]?.closest("li")).not.toBeNull();
      expect(openers()[2]?.closest("td")).not.toBeNull();
    });
  });

  describe("presentations that stay unchanged", () => {
    it("keeps an external image a text link and unsupported sources a label", async () => {
      const text = [
        "![remote](https://example.com/x.png)",
        "![vector](/abs/x.svg)",
        "![home](~/x.png)",
        "![data](data:image/png;base64,AAAA)",
        "[![badge](/abs/badge.png)](https://example.com)",
      ].join(" ");
      render({ thread: view(SETTLED, [text]) });
      await act(async () => undefined);

      const body = message();
      expect(body.querySelector("img")).toBeNull();
      expect(body.querySelector(SLOT)).toBeNull();
      expect(read).not.toHaveBeenCalled();
      const labels = [...body.querySelectorAll<HTMLElement>(LABEL)];
      expect(labels.map((label) => label.textContent)).toEqual([
        "remote",
        "vector",
        "home",
        "data",
        "badge",
      ]);
      expect(labels.map((label) => label.tagName)).toEqual(["A", "SPAN", "SPAN", "SPAN", "SPAN"]);
      expect(labels[0]?.getAttribute("href")).toBe("https://example.com/x.png");
      expect(labels[4]?.closest("a")?.getAttribute("href")).toBe("https://example.com");
    });

    it("keeps a relative image a label when the thread has no base directory", async () => {
      await renderSettled(
        {
          thread: view(SETTLED, ["![rel](rel/x.png) ![abs](/abs/x.png)"]),
          localFileLinks: null,
        },
        1,
      );

      expect(message().querySelector(LABEL)?.textContent).toBe("rel");
      expect(read.mock.calls.map(([request]) => request.path)).toEqual(["/abs/x.png"]);
    });

    it("never reads an image for a remote thread", async () => {
      render({ thread: remoteView(["![shot](/abs/x.png)"]) });
      await act(async () => undefined);

      expect(message().querySelector("img")).toBeNull();
      expect(message().querySelector(SLOT)).toBeNull();
      expect(message().querySelector(`span${LABEL}`)?.textContent).toBe("shot");
      expect(read).not.toHaveBeenCalled();
    });

    it("never reads an image for imported history", async () => {
      render({ thread: importedView("![shot](/abs/x.png)") });
      await act(async () => undefined);

      const body = shell.querySelector<HTMLElement>('[data-agent-event="x0"]');
      expect(body?.getAttribute("data-agent-markdown")).toBe("rendered");
      expect(body?.querySelector("img")).toBeNull();
      expect(body?.querySelector(SLOT)).toBeNull();
      expect(body?.querySelector(`span${LABEL}`)?.textContent).toBe("shot");
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("unavailable images", () => {
    it("shows a chip with the bounded reason and never the path, and retries on click", async () => {
      read.mockRejectedValueOnce(GONE);
      render({ thread: view(SETTLED, ["![shot](/abs/secret-dir/x.png)"]) });
      await waitForReact(() => expect(shell.querySelector(CHIP)).not.toBeNull());

      const chip = shell.querySelector<HTMLButtonElement>(CHIP);
      expect(chip?.title).toBe(`${GONE} ${AGENT_INLINE_IMAGE_RETRY_HINT}`);
      expect(chip?.querySelector(".agent-attachments__name")?.textContent).toBe(
        "Image unavailable: shot",
      );
      expect(chip?.querySelector(".agent-visually-hidden")?.textContent).toContain(GONE);
      expect(chip?.getAttribute("data-agent-attachment")).toBe("unavailable");
      expect(shell.innerHTML).not.toContain("secret-dir");
      expect(shell.innerHTML).not.toContain("x.png");
      expect(read).toHaveBeenCalledTimes(1);

      click(chip);
      await waitForReact(() => expect(pictures()).toHaveLength(1));

      expect(read).toHaveBeenCalledTimes(2);
      expect(read.mock.calls[1]).toEqual(read.mock.calls[0]);
      expect(shell.querySelector(CHIP)).toBeNull();
    });

    it("does not retry on its own when the store publishes or the chip re-enters the viewport", async () => {
      const { pending, read: deferred } = deferredReads();
      const viewport = onPlatform(ON_SCREEN);
      render(
        {
          thread: view(SETTLED, ["![bad](/abs/bad.png)\n\n![good](/abs/good.png)"]),
          markdownViewport: viewport.port,
        },
        deferred,
      );
      const [bad] = boxes();
      await act(async () => pending[0]?.reject(GONE));
      expect(bad?.matches(CHIP)).toBe(true);

      await act(async () => pending[1]?.resolve(png()));
      expect(pictures()).toHaveLength(1);
      await act(async () => {
        viewport.leave(bad);
        viewport.enter(bad);
        viewport.enter(bad);
      });
      await act(async () => undefined);

      expect(bad?.matches(CHIP)).toBe(true);
      expect(deferred).toHaveBeenCalledTimes(2);
    });

    it("keeps keyboard focus on the same element from the chip through loading to the picture", async () => {
      const { pending, read: deferred } = deferredReads();
      render({ thread: view(SETTLED, ["![shot](/abs/x.png)"]) }, deferred);
      const [box] = boxes();
      await act(async () => pending[0]?.reject(GONE));
      expect(box?.matches(CHIP)).toBe(true);
      act(() => box?.focus());

      press(box, "Enter");

      expect(box?.matches(SLOT)).toBe(true);
      expect(document.activeElement).toBe(box);
      await act(async () => pending[1]?.resolve(png()));
      expect(box?.matches(OPENER)).toBe(true);
      expect(boxes()).toEqual([box]);
      expect(document.activeElement).toBe(box);
      expect(deferred).toHaveBeenCalledTimes(2);
    });

    it("shows the same chip when the loaded bytes fail to decode and reloads on retry", async () => {
      await renderSettled({ thread: view(SETTLED, ["![](/abs/x.png)"]) }, 1);

      fire(pictures()[0], "error");

      const chip = shell.querySelector<HTMLButtonElement>(CHIP);
      expect(chip?.title).toContain(AGENT_INLINE_IMAGE_DECODE_FAILED_REASON);
      expect(chip?.querySelector(".agent-attachments__name")?.textContent).toBe(
        "Image unavailable",
      );
      expect(pictures()).toHaveLength(0);
      expect(shell.innerHTML).not.toContain("x.png");

      click(chip);
      await waitForReact(() => expect(pictures()).toHaveLength(1));

      expect(urls.revoked).toEqual(["blob:0"]);
      expect(pictures()[0]?.getAttribute("src")).toBe("blob:1");
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  describe("bounded loading", () => {
    it("shows the first sixteen images of an answer, labels the rest and notes it once", async () => {
      const text = Array.from(
        { length: MAX_AGENT_INLINE_IMAGES_PER_MESSAGE + 1 },
        (_, index) => `![shot ${index}](/abs/${index}.png)`,
      ).join("\n\n");
      await renderSettled({ thread: view(SETTLED, [text]) }, MAX_AGENT_INLINE_IMAGES_PER_MESSAGE);

      const body = message();
      const labels = [...body.querySelectorAll(LABEL)];
      expect(labels.map((label) => label.textContent)).toEqual(["shot 16"]);
      const notes = [...body.querySelectorAll(".agent-md__note")];
      expect(notes.map((note) => note.textContent)).toEqual([AGENT_INLINE_IMAGES_TRUNCATED_NOTE]);
      expect(notes[0]?.className).toBe("agent-note agent-md__note");
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGES_PER_MESSAGE);
      expect(read.mock.calls.map(([request]) => request.path)).not.toContain("/abs/16.png");
    });

    it("shows no note for exactly sixteen images", async () => {
      const text = Array.from(
        { length: MAX_AGENT_INLINE_IMAGES_PER_MESSAGE },
        (_, index) => `![shot ${index}](/abs/${index}.png)`,
      ).join("\n\n");
      await renderSettled({ thread: view(SETTLED, [text]) }, MAX_AGENT_INLINE_IMAGES_PER_MESSAGE);

      expect(message().querySelector(".agent-md__note")).toBeNull();
    });

    it("says truthfully that an image over the preview limit waits and loads by itself", async () => {
      const answer = (from: number, count: number): string =>
        Array.from({ length: count }, (_, index) => `![shot](/abs/${from + index}.png)`).join(
          "\n\n",
        );
      const answers = [answer(0, 16), answer(16, 16), answer(32, 1)];
      await renderSettled({ thread: view(SETTLED, answers) }, 32);

      const chip = message(2).querySelector<HTMLButtonElement>(CHIP);
      expect(chip?.getAttribute("data-state")).toBe("waiting");
      expect(chip?.title).toBe(AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON);
      expect(chip?.title).not.toContain(AGENT_INLINE_IMAGE_RETRY_HINT);
      expect(chip?.getAttribute("aria-disabled")).toBe("true");
      expect(chip?.querySelector(".agent-attachments__name")?.textContent).toBe(
        `${AGENT_INLINE_IMAGE_WAITING_LABEL}: shot`,
      );
      click(chip);
      await act(async () => undefined);
      expect(read).toHaveBeenCalledTimes(32);
    });

    it("says a picture does not fit in the preview memory and loads it on a click once room exists", async () => {
      const large = vi.fn<ReadInlineImage>(async () => {
        const bytes = new Uint8Array(10 * 1_024 * 1_024);
        bytes.set(PNG_SIGNATURE);
        return bytes.buffer;
      });
      const viewport = onPlatform(ON_SCREEN);
      const text = Array.from({ length: 7 }, (_, index) => `![big](/abs/${index}.png)`).join(
        "\n\n",
      );
      render({ thread: view(SETTLED, [text]), markdownViewport: viewport.port }, large);
      await waitForReact(() => expect(shell.querySelector(CHIP)).not.toBeNull());
      const all = boxes();
      const chip = all[6];

      expect(chip?.matches(CHIP)).toBe(true);
      expect(chip?.getAttribute("data-state")).toBe("unavailable");
      expect(chip?.title).toBe(
        `${AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON} ${AGENT_INLINE_IMAGE_RETRY_HINT}`,
      );
      expect(chip?.hasAttribute("aria-disabled")).toBe(false);
      expect(large).toHaveBeenCalledTimes(7);

      click(chip);
      await waitForReact(() => expect(large).toHaveBeenCalledTimes(8));
      await waitForReact(() => expect(chip?.matches(CHIP)).toBe(true));
      await act(async () => undefined);
      expect(large).toHaveBeenCalledTimes(8);
      expect(urls.revoked).toEqual([]);

      await act(async () => viewport.leave(all[0]));
      expect(chip?.matches(CHIP)).toBe(true);
      expect(large).toHaveBeenCalledTimes(8);
      click(chip);
      await waitForReact(() => expect(chip?.matches(OPENER)).toBe(true));

      expect(large).toHaveBeenCalledTimes(9);
      expect(urls.revoked).toEqual(["blob:0"]);
      expect(all[0]?.matches(SLOT)).toBe(true);
    });

    it("does not read an off-screen image until the observer reports its entry", async () => {
      const viewport = onPlatform(OFF_SCREEN);
      render({ thread: view(SETTLED, ["![shot](/abs/x.png)"]), markdownViewport: viewport.port });
      await act(async () => undefined);

      const slot = message().querySelector(SLOT);
      expect(slot).not.toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(viewport.watched()).toEqual([slot]);

      await act(async () => viewport.leave(slot ?? undefined));
      act(() => viewport.port.remeasure());
      expect(read).not.toHaveBeenCalled();

      await act(async () => viewport.enter(slot ?? undefined));
      await waitForReact(() => expect(pictures()).toHaveLength(1));

      expect(read).toHaveBeenCalledTimes(1);
      expect(viewport.watched()).toEqual(boxes());
    });

    it("reads an on-screen image in its first commit and keeps watching it", async () => {
      const viewport = onPlatform(ON_SCREEN);
      render({ thread: view(SETTLED, ["![shot](/abs/x.png)"]), markdownViewport: viewport.port });

      expect(read).toHaveBeenCalledTimes(1);
      expect(viewport.watched()).toEqual(boxes());
    });

    it("stops watching an image when the thread unmounts", async () => {
      const viewport = onPlatform(OFF_SCREEN);
      render({ thread: view(SETTLED, ["![shot](/abs/x.png)"]), markdownViewport: viewport.port });
      expect(viewport.watched()).toHaveLength(1);

      render({ thread: null, markdownViewport: viewport.port });

      expect(viewport.watched()).toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it("does not read an image inside a collapsed work fold until the fold opens", async () => {
      const viewport = onPlatform({
        visible: (element) => element.closest("details:not([open])") === null,
        near: () => true,
      });
      const events: ReadonlyArray<AgentTurnEvent> = [
        { kind: "assistantText", text: "Checking.\n\n![hidden](/abs/hidden.png)" },
        { kind: "toolCall", toolId: "c1", name: "Bash", inputSummary: "ls" },
        { kind: "toolResult", toolId: "c1", outputSummary: "done", isError: false },
        { kind: "assistantText", text: "Done.\n\n![shown](/abs/shown.png)" },
      ];
      render({ thread: viewOf([turnWith(SETTLED, events)]), markdownViewport: viewport.port });
      await waitForReact(() => expect(pictures()).toHaveLength(1));

      const fold = shell.querySelector<HTMLDetailsElement>("details.agent-work");
      expect(fold?.open).toBe(false);
      const hidden = fold?.querySelector<HTMLButtonElement>(BOX) ?? undefined;
      expect(hidden?.matches(SLOT)).toBe(true);
      expect(viewport.watched()).toContain(hidden);
      await act(async () => viewport.leave(hidden));
      act(() => viewport.port.remeasure());
      await act(async () => undefined);
      expect(read.mock.calls.map(([request]) => request.path)).toEqual(["/abs/shown.png"]);

      act(() => {
        if (fold !== null) fold.open = true;
      });
      act(() => viewport.port.remeasure());
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => viewport.enter(hidden));
      await waitForReact(() => expect(pictures()).toHaveLength(2));

      expect(read.mock.calls.map(([request]) => request.path)).toEqual([
        "/abs/shown.png",
        "/abs/hidden.png",
      ]);
    });

    it("does not keep a horizontally clipped table image pinned after the observer reports it outside", async () => {
      const viewport = onPlatform(ON_SCREEN);
      const answer = (from: number): string =>
        Array.from({ length: 16 }, (_, index) => `![shot](/abs/${from + index}.png)`).join("\n\n");
      const table = "| a | wide |\n|---|---|\n| x | ![clipped](/abs/clipped.png) |";
      render({
        thread: view(SETTLED, [table, answer(0), answer(16)]),
        markdownViewport: viewport.port,
      });
      await waitForReact(() => expect(pictures()).toHaveLength(MAX_AGENT_INLINE_IMAGE_ENTRIES));
      const all = boxes();
      const clipped = all[0];
      const last = all[MAX_AGENT_INLINE_IMAGE_ENTRIES];
      expect(clipped?.closest("td")).not.toBeNull();
      expect(clipped?.matches(OPENER)).toBe(true);
      expect(last?.getAttribute("data-state")).toBe("waiting");
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

      await act(async () => viewport.leave(clipped));
      await waitForReact(() => expect(last?.matches(OPENER)).toBe(true));
      expect(clipped?.matches(SLOT)).toBe(true);
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);

      act(() => viewport.port.remeasure());
      act(() => viewport.port.remeasure());
      await act(async () => undefined);

      expect(clipped?.matches(SLOT)).toBe(true);
      expect(last?.matches(OPENER)).toBe(true);
      expect(shell.querySelector(CHIP)).toBeNull();
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);

      await act(async () => viewport.enter(clipped));
      await act(async () => undefined);
      expect(clipped?.getAttribute("data-state")).toBe("waiting");
    });

    it("releases off-screen previews of a long thread, loads the latest and reloads on scroll back", async () => {
      const total = MAX_AGENT_INLINE_IMAGE_ENTRIES + 2;
      const answer = (from: number, count: number): string =>
        Array.from({ length: count }, (_, index) => `![shot](/abs/${from + index}.png)`).join(
          "\n\n",
        );
      const viewport = onPlatform(OFF_SCREEN);
      render({
        thread: view(SETTLED, [answer(0, 16), answer(16, 16), answer(32, 2)]),
        markdownViewport: viewport.port,
      });
      const all = boxes();
      expect(all).toHaveLength(total);
      expect(read).not.toHaveBeenCalled();

      await act(async () => all.slice(0, MAX_AGENT_INLINE_IMAGE_ENTRIES).forEach(viewport.enter));
      await waitForReact(() => expect(pictures()).toHaveLength(MAX_AGENT_INLINE_IMAGE_ENTRIES));
      loadPicture(pictures()[0], 400, 200);

      await act(async () => all.slice(MAX_AGENT_INLINE_IMAGE_ENTRIES).forEach(viewport.enter));
      await act(async () => undefined);
      expect(
        all.slice(MAX_AGENT_INLINE_IMAGE_ENTRIES).map((box) => box.getAttribute("data-state")),
      ).toEqual(["waiting", "waiting"]);
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

      await act(async () => all.slice(0, 4).forEach(viewport.leave));
      await waitForReact(() => expect(pictures()).toHaveLength(MAX_AGENT_INLINE_IMAGE_ENTRIES));

      expect(read).toHaveBeenCalledTimes(total);
      expect(all.slice(MAX_AGENT_INLINE_IMAGE_ENTRIES).every((box) => box.matches(OPENER))).toBe(
        true,
      );
      expect(all.slice(0, 2).every((box) => box.matches(SLOT))).toBe(true);
      expect(all.slice(2, 4).every((box) => box.matches(OPENER))).toBe(true);
      expect(all[0]?.getAttribute("data-box")).toBe("sized");
      expect(all[0]?.style.inlineSize).toBe("min(100%, 400px, 30rem, 60rem)");
      expect(urls.revoked).toEqual(["blob:0", "blob:1"]);
      expect(shell.querySelector(CHIP)).toBeNull();

      await act(async () => viewport.enter(all[0]));
      await waitForReact(() => expect(all[0]?.matches(OPENER)).toBe(true));

      expect(read).toHaveBeenCalledTimes(total + 1);
      expect(read.mock.calls[total]?.[0].path).toBe("/abs/0.png");
      expect(all[2]?.matches(SLOT)).toBe(true);
      expect(boxes()).toEqual(all);
      act(() => viewport.port.remeasure());
      await act(async () => undefined);
      expect(read).toHaveBeenCalledTimes(total + 1);
    });

    it("loads a good image after thirty-two failed references that are all on screen", async () => {
      const answer = (from: number): string =>
        Array.from({ length: 16 }, (_, index) => `![bad](/abs/bad-${from + index}.png)`).join(
          "\n\n",
        );
      const reader = vi.fn<ReadInlineImage>((request) =>
        request.path === "/abs/good.png" ? Promise.resolve(png()) : Promise.reject(GONE),
      );
      render({ thread: view(SETTLED, [answer(0), answer(16), "![good](/abs/good.png)"]) }, reader);
      await waitForReact(() => expect(pictures(message(2))).toHaveLength(1));

      expect(shell.querySelectorAll(CHIP)).toHaveLength(MAX_AGENT_INLINE_IMAGE_ENTRIES);
      expect(reader).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);
    });
  });

  describe("turns", () => {
    it("reads a path again when a later turn shows it and leaves the earlier turn its own picture", async () => {
      const { pending, read: deferred } = deferredReads();
      const first = turnWith(
        SETTLED,
        texts(["![chart](out/chart.png)", "Again ![chart](out/chart.png)"]),
      );
      const second = {
        ...turnWith(SETTLED, texts(["![chart](out/chart.png)"])),
        turnId: "agt-1-t2",
      };
      render({ thread: viewOf([first]) }, deferred);
      await act(async () => pending[0]?.resolve(png()));
      expect(pictures().map((picture) => picture.getAttribute("src"))).toEqual([
        "blob:0",
        "blob:0",
      ]);
      expect(deferred).toHaveBeenCalledTimes(1);

      render({ thread: viewOf([first, second]) }, deferred);
      await act(async () => undefined);
      expect(deferred).toHaveBeenCalledTimes(2);
      expect(deferred.mock.calls[1]).toEqual(deferred.mock.calls[0]);
      expect(pictures().map((picture) => picture.getAttribute("src"))).toEqual([
        "blob:0",
        "blob:0",
      ]);
      await act(async () => pending[1]?.resolve(png()));

      expect(pictures().map((picture) => picture.getAttribute("src"))).toEqual([
        "blob:0",
        "blob:0",
        "blob:1",
      ]);
      expect(urls.revoked).toEqual([]);
    });

    it("never shows a picture in reasoning text", async () => {
      const events: ReadonlyArray<AgentTurnEvent> = [
        { kind: "reasoning", text: "Looking at ![shot](/abs/thought.png) first." },
        { kind: "assistantText", text: "Done." },
      ];
      render({ thread: viewOf([turnWith(SETTLED, events)]) });
      shell.querySelectorAll<HTMLDetailsElement>("details").forEach((fold) => {
        act(() => {
          fold.open = true;
        });
      });
      for (const toggle of [".agent-activity-group__toggle", ".agent-thought__toggle"]) {
        shell
          .querySelectorAll<HTMLElement>(`${toggle}[aria-expanded="false"]`)
          .forEach((button) => click(button));
      }
      await act(async () => undefined);

      const thought = shell.querySelector(".agent-thought__body");
      expect(thought?.querySelector(`span${LABEL}`)?.textContent).toBe("shot");
      expect(shell.querySelector(BOX)).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("rendering cost", () => {
    it("re-renders neither the surface owner nor the turn while images load and settle", async () => {
      const { pending, read: deferred } = deferredReads();
      const turnRenders = vi.fn();
      const text = Array.from({ length: 6 }, (_, index) => `![shot](/abs/${index}.png)`).join(
        "\n\n",
      );
      render({ thread: view(SETTLED, [text]), turnRenderProbe: turnRenders }, deferred);
      const owners = sessionRenders;
      const turns = turnRenders.mock.calls.length;

      for (let settled = 0; settled < 6; settled += 1) {
        await act(async () => pending[settled]?.resolve(png()));
      }

      expect(pictures()).toHaveLength(6);
      expect(sessionRenders).toBe(owners);
      expect(turnRenders).toHaveBeenCalledTimes(turns);
    });
  });

  describe("streaming", () => {
    it("keeps the same image node and a single read while the answer keeps streaming", async () => {
      const stream = (text: string): void => render({ thread: view(RUNNING, [text]) });
      stream("Intro.\n\n![shot](/abs/x.png)");
      await waitForReact(() => expect(pictures()).toHaveLength(1));
      const picture = pictures()[0];
      const opener = openers()[0];

      stream("Intro.\n\n![shot](/abs/x.png)\n\nMore");
      stream("Intro.\n\n![shot](/abs/x.png)\n\nMore text arrives.\n\n- and a list");
      await act(async () => undefined);
      render({
        thread: view(SETTLED, [
          "Intro.\n\n![shot](/abs/x.png)\n\nMore text arrives.\n\n- and a list",
        ]),
      });
      await act(async () => undefined);

      expect(pictures()[0]).toBe(picture);
      expect(openers()[0]).toBe(opener);
      expect(picture?.getAttribute("src")).toBe("blob:0");
      expect(read).toHaveBeenCalledTimes(1);
      expect(urls.revoked).toEqual([]);
    });

    it("keeps the image node when streamed text turns a standalone image into an inline one", async () => {
      const stream = (text: string): void => render({ thread: view(RUNNING, [text]) });
      stream("![shot](/abs/x.png)");
      await waitForReact(() => expect(pictures()).toHaveLength(1));
      const picture = pictures()[0];
      expect(openers()[0]?.getAttribute("data-layout")).toBe("standalone");

      stream("![shot](/abs/x.png) with a caption");

      expect(pictures()[0]).toBe(picture);
      expect(openers()[0]?.getAttribute("data-layout")).toBe("inline");
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe("lightbox", () => {
    const FIRST = "![first](/abs/1.png)\n\n![broken](/abs/2.png)\n\n![third](/abs/3.png)";
    const SECOND = "![elsewhere](/abs/4.png)";

    function gallery(): ReadInlineImage {
      return vi.fn<ReadInlineImage>((request) => {
        if (request.path === "/abs/2.png") return Promise.reject(GONE);
        return Promise.resolve(png());
      });
    }

    async function renderGallery(): Promise<void> {
      await renderSettled({ thread: view(SETTLED, [FIRST, SECOND]) }, 3, gallery());
      await waitForReact(() => expect(message().querySelector(CHIP)).not.toBeNull());
    }

    it("opens the clicked image in the workbench frame without a reveal action", async () => {
      await renderGallery();
      const opener = openers(message())[0];

      click(opener);

      const dialog = lightbox();
      expect(dialog?.parentElement).toBe(shell);
      expect(dialog?.getAttribute("aria-label")).toBe("first");
      expect(lightboxSource()).toBe(pictures(message())[0]?.getAttribute("src"));
      expect(dialog?.querySelector(".agent-lightbox__name")?.textContent).toBe("first");
      expect(dialog?.textContent).not.toContain(AGENT_LIGHTBOX_REVEAL_LABEL);
      expect(dialog?.innerHTML).not.toContain("/abs/");
      expect(document.querySelectorAll(".agent-lightbox")).toHaveLength(1);
    });

    it("fits the enlarged image to its natural size once the picture has loaded", async () => {
      await renderGallery();
      const [first, third] = pictures(message());
      Object.defineProperties(first, {
        naturalWidth: { configurable: true, value: 2_560 },
        naturalHeight: { configurable: true, value: 1_440 },
      });
      fire(first, "load");

      click(openers(message())[0]);
      const enlarged = (): HTMLImageElement | null =>
        lightbox()?.querySelector<HTMLImageElement>(".agent-lightbox__image") ?? null;
      expect(enlarged()?.style.maxWidth).toBe("min(92vw, 2560px)");
      expect(enlarged()?.style.maxHeight).toBe("min(86vh, 1440px)");

      press(lightbox(), "ArrowRight");
      expect(enlarged()?.getAttribute("src")).toBe(third?.getAttribute("src"));
      expect(enlarged()?.style.maxWidth).toBe("");
    });

    it.each(["Enter", " "])("opens from the keyboard with %j", async (key) => {
      await renderGallery();

      press(openers(message())[1], key);

      expect(lightbox()?.getAttribute("aria-label")).toBe("third");
    });

    it("walks only the ready images of the same answer in document order", async () => {
      await renderGallery();
      const [first, third] = pictures(message()).map((picture) => picture.getAttribute("src"));
      const elsewhere = pictures(message(1))[0]?.getAttribute("src");
      click(openers(message())[0]);

      const next = (): HTMLElement | null =>
        lightbox()?.querySelector<HTMLElement>(`[aria-label="${AGENT_LIGHTBOX_NEXT_LABEL}"]`) ??
        null;
      const previous = (): HTMLElement | null =>
        lightbox()?.querySelector<HTMLElement>(`[aria-label="${AGENT_LIGHTBOX_PREVIOUS_LABEL}"]`) ??
        null;
      expect(lightboxSource()).toBe(first);
      expect(previous()?.getAttribute("aria-disabled")).toBe("true");

      press(lightbox(), "ArrowRight");
      expect(lightboxSource()).toBe(third);
      expect(lightbox()?.getAttribute("aria-label")).toBe("third");
      expect(next()?.getAttribute("aria-disabled")).toBe("true");

      press(lightbox(), "ArrowRight");
      expect(lightboxSource()).toBe(third);
      expect(lightboxSource()).not.toBe(elsewhere);

      click(previous());
      expect(lightboxSource()).toBe(first);
    });

    it("starts at the clicked image and shows no arrows for a lone image", async () => {
      await renderGallery();

      click(openers(message())[1]);
      expect(lightbox()?.getAttribute("aria-label")).toBe("third");
      press(lightbox(), "Escape");

      click(openers(message(1))[0]);
      expect(lightbox()?.getAttribute("aria-label")).toBe("elsewhere");
      expect(lightbox()?.querySelector(`[aria-label="${AGENT_LIGHTBOX_NEXT_LABEL}"]`)).toBeNull();
    });

    it("closes on Escape and returns focus to the image that opened it", async () => {
      await renderGallery();
      const opener = openers(message())[1];
      click(opener);
      expect(lightbox()?.contains(document.activeElement)).toBe(true);

      press(document.activeElement, "Escape");

      expect(lightbox()).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it("closes when the shown image stops being available and hands focus to its chip", async () => {
      await renderGallery();
      const opener = openers(message())[0];
      click(opener);
      expect(lightbox()?.contains(document.activeElement)).toBe(true);

      fire(pictures(message())[0], "error");

      expect(lightbox()).toBeNull();
      expect(opener?.matches(CHIP)).toBe(true);
      expect(opener?.isConnected).toBe(true);
      expect(document.activeElement).toBe(opener);
    });

    it("keeps the image it shows under eviction pressure and releases it when it closes", async () => {
      const viewport = onPlatform(OFF_SCREEN);
      const answer = (from: number): string =>
        Array.from({ length: 16 }, (_, index) => `![shot](/abs/${from + index}.png)`).join("\n\n");
      render({
        thread: view(SETTLED, ["![shown](/abs/shown.png)", answer(0), answer(16)]),
        markdownViewport: viewport.port,
      });
      const all = boxes();
      const last = all[MAX_AGENT_INLINE_IMAGE_ENTRIES];
      await act(async () => viewport.enter(all[0]));
      await waitForReact(() => expect(all[0]?.matches(OPENER)).toBe(true));
      click(all[0]);
      expect(lightbox()?.getAttribute("aria-label")).toBe("shown");

      await act(async () => viewport.leave(all[0]));
      await act(async () => all.slice(1).forEach(viewport.enter));
      await waitForReact(() => expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES));
      await act(async () => undefined);

      expect(lightbox()?.getAttribute("aria-label")).toBe("shown");
      expect(all[0]?.matches(OPENER)).toBe(true);
      expect(last?.getAttribute("data-state")).toBe("waiting");
      expect(urls.revoked).toEqual([]);

      press(lightbox(), "Escape");
      await waitForReact(() => expect(last?.matches(OPENER)).toBe(true));

      expect(lightbox()).toBeNull();
      expect(all[0]?.matches(SLOT)).toBe(true);
      expect(urls.revoked).toEqual(["blob:0"]);
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);
    });

    it.each(["Enter", " "])("stays open while %j is held down after opening", async (key) => {
      await renderGallery();
      const opener = openers(message())[0];

      press(opener, key);
      press(opener, key, { repeat: true });
      expect(lightbox()).not.toBeNull();
      const close = document.activeElement;
      expect(lightbox()?.contains(close)).toBe(true);
      press(close, key, { repeat: true });
      press(close, key, { repeat: true });

      expect(lightbox()?.getAttribute("aria-label")).toBe("first");

      press(close, key);
      expect(lightbox()).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it("never shows the attachment lightbox and the inline image lightbox together", async () => {
      const turn = { ...turnOf(SETTLED, [FIRST]), attachments: [ATTACHMENT] };
      await renderSettled(
        { thread: viewOf([turn]), attachmentImages: attachmentSurface() },
        2,
        gallery(),
      );

      click(shell.querySelector(".agent-attachments__open"));
      expect(lightbox()?.getAttribute("aria-label")).toBe("upload.png");

      click(openers(message())[0]);
      expect(document.querySelectorAll(".agent-lightbox")).toHaveLength(1);
      expect(lightbox()?.getAttribute("aria-label")).toBe("first");

      click(shell.querySelector(".agent-attachments__open"));
      await act(async () => undefined);
      expect(document.querySelectorAll(".agent-lightbox")).toHaveLength(1);
      expect(lightbox()?.getAttribute("aria-label")).toBe("upload.png");
    });
  });

  describe("find in thread", () => {
    const TEXT = [
      "The parser is ready.",
      "",
      "![parser diagram](/abs/parser.png)",
      "",
      "Another parser note.",
    ].join("\n");

    function currentHit(): HTMLElement {
      const marks = shell.querySelectorAll<HTMLElement>("mark.agent-find__hit--current");
      expect(marks).toHaveLength(1);
      return marks[0] as HTMLElement;
    }

    it("shows a local image whose alt or path holds a match as source and keeps hit indexes right", async () => {
      const thread = view(SETTLED, [TEXT]);
      const hits = hitsFor(thread, "parser");
      expect(hits).toHaveLength(4);
      const owners: string[] = [];

      for (let index = 0; index < hits.length; index += 1) {
        render({ thread, findQuery: "parser", findHits: hits, findHitIndex: index });
        await act(async () => undefined);
        expect(currentHit().getAttribute("data-hit-index")).toBe(String(index));
        owners.push(currentHit().closest("p")?.textContent ?? "");
      }

      expect(owners).toEqual([
        "The parser is ready.",
        "![parser diagram](/abs/parser.png)",
        "![parser diagram](/abs/parser.png)",
        "Another parser note.",
      ]);
      const body = message();
      expect(body.getAttribute("data-agent-markdown")).toBe("rendered");
      expect(body.querySelectorAll("mark.agent-find__hit")).toHaveLength(4);
      expect(body.querySelector(".agent-md__note")?.textContent).toBe(
        AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE,
      );
      expect(pictures()).toHaveLength(0);
    });

    it("falls back to source when only the alt text of a shown image holds the match", async () => {
      const thread = view(SETTLED, [TEXT]);
      const hits = hitsFor(thread, "diagram");
      expect(hits).toHaveLength(1);

      render({ thread, findQuery: "diagram", findHits: hits, findHitIndex: 0 });
      await act(async () => undefined);

      expect(currentHit().textContent).toBe("diagram");
      expect(currentHit().closest("p")?.textContent).toBe("![parser diagram](/abs/parser.png)");
      expect(pictures()).toHaveLength(0);
      expect(message().querySelectorAll("p.agent-text__paragraph")).toHaveLength(3);

      render({ thread, findQuery: "", findHits: [], findHitIndex: undefined });
      await waitForReact(() => expect(pictures()).toHaveLength(1));
      expect(message().querySelector(".agent-md__note")).toBeNull();
    });

    it("keeps the image and the right current hit for a query that only hits prose", async () => {
      const thread = view(SETTLED, [TEXT]);
      const hits = hitsFor(thread, "note");
      expect(hits).toHaveLength(1);

      await renderSettled({ thread, findQuery: "note", findHits: hits, findHitIndex: 0 }, 1);

      expect(currentHit().closest("p")?.textContent).toBe("Another parser note.");
      expect(message().querySelector(".agent-md__note")).toBeNull();
      expect(openers()[0]?.querySelector("mark")).toBeNull();
    });

    it("leaves the label of a local image that is not shown inline without highlight marks", async () => {
      const thread = remoteView(["A diagram here.\n\n![diagram](/abs/x.svg)"]);
      const hits = hitsFor(thread, "diagram");
      expect(hits).toHaveLength(2);

      render({ thread, findQuery: "diagram", findHits: hits, findHitIndex: 0 });
      await act(async () => undefined);

      expect(currentHit().closest("p")?.textContent).toBe("A diagram here.");
      expect(message().querySelector(`span${LABEL} mark`)).toBeNull();
      expect(message().querySelector(".agent-md__note")?.textContent).toBe(
        AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE,
      );
    });
  });

  describe("isolation", () => {
    it("revokes a thread's images when another thread takes its place and on unmount", async () => {
      await renderSettled({ thread: view(SETTLED, ["![a](/abs/x.png)"]) }, 1);
      expect(urls.revoked).toEqual([]);

      render({ thread: view(SETTLED, ["![b](/abs/y.png)"], OTHER_THREAD_ID) });
      await waitForReact(() => expect(pictures()[0]?.getAttribute("src")).toBe("blob:1"));
      expect(urls.revoked).toEqual(["blob:0"]);

      act(() => root.unmount());
      root = createRoot(shell);
      expect(urls.revoked).toEqual(["blob:0", "blob:1"]);
    });

    it("does not show workspace A's image again after A to B to A without a new read", async () => {
      const { pending, read: deferred } = deferredReads();
      const threadA = view(SETTLED, ["![a](/abs/x.png)"], THREAD_ID, OWNER_ID);
      const threadB = view(SETTLED, ["![b](/abs/x.png)"], OTHER_THREAD_ID, OTHER_OWNER_ID);
      render({ thread: threadA }, deferred);
      await act(async () => pending[0]?.resolve(png()));
      expect(pictures()[0]?.getAttribute("src")).toBe("blob:0");

      render({ thread: threadB }, deferred);
      await act(async () => undefined);
      expect(pictures()).toHaveLength(0);
      expect(urls.revoked).toEqual(["blob:0"]);

      render({ thread: threadA }, deferred);
      await act(async () => undefined);
      expect(pictures()).toHaveLength(0);
      expect(shell.querySelectorAll(SLOT)).toHaveLength(1);
      expect(
        deferred.mock.calls.map(([request]) => [request.workspaceId, request.threadId]),
      ).toEqual([
        [OWNER_ID, THREAD_ID],
        [OTHER_OWNER_ID, OTHER_THREAD_ID],
        [OWNER_ID, THREAD_ID],
      ]);

      await act(async () => pending[1]?.resolve(png()));
      expect(pictures()).toHaveLength(0);
      expect(urls.created).toEqual(["blob:0"]);

      await act(async () => pending[2]?.resolve(png()));
      expect(pictures()[0]?.getAttribute("src")).toBe("blob:1");
    });
  });

  describe("following the latest output", () => {
    it("stays pinned when an image settles and does not move a reader who scrolled up", async () => {
      const { pending, read: deferred } = deferredReads();
      render({ thread: view(SETTLED, ["![shot](/abs/x.png)"]) }, deferred);
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
      act(() => scroll.dispatchEvent(new Event("scroll")));

      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_200 });
      await act(async () => pending[0]?.resolve(png()));
      expect(pictures()).toHaveLength(1);
      expect(scroll.scrollTop).toBe(1_200);

      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_400 });
      fire(pictures()[0], "load");
      expect(scroll.scrollTop).toBe(1_400);

      scroll.scrollTop = 100;
      act(() => scroll.dispatchEvent(new Event("scroll")));
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_700 });
      fire(pictures()[0], "load");
      expect(scroll.scrollTop).toBe(100);

      fire(pictures()[0], "error");
      expect(shell.querySelector(CHIP)).not.toBeNull();
      expect(scroll.scrollTop).toBe(100);
    });

    it("leaves the scroll position to find while a query is active in the answer", async () => {
      const { pending, read: deferred } = deferredReads();
      const thread = view(SETTLED, ["A note first.\n\n![shot](/abs/x.png)"]);
      const hits = hitsFor(thread, "note");
      expect(hits).toHaveLength(1);
      render({ thread, findQuery: "note", findHits: hits, findHitIndex: 0 }, deferred);
      const scroll = scrollContainer({ scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
      act(() => scroll.dispatchEvent(new Event("scroll")));

      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1_200 });
      await act(async () => pending[0]?.resolve(png()));
      loadPicture(pictures()[0], 800, 400);

      expect(openers()[0]?.getAttribute("data-box")).toBe("sized");
      expect(scroll.scrollTop).toBe(600);
    });
  });
});

const ATTACHMENT: AgentAttachment = {
  kind: "image",
  attachmentId: ATTACHMENT_ID,
  name: "upload.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: `/data/agent-attachments/threads/${THREAD_ID}/${ATTACHMENT_ID}.png`,
};

function attachmentSurface(): AgentAttachmentImagesSurface {
  return {
    images: new Map([
      [
        agentAttachmentImageKey(OWNER_ID, THREAD_ID, ATTACHMENT_ID),
        { kind: "ready", url: ATTACHMENT_URL },
      ],
    ]),
    ensure: ignore,
    holdThread: () => ignore,
    releaseWorkspace: ignore,
  };
}

function ignore(): void {}

function hitsFor(thread: AgentThreadView, query: string): ReadonlyArray<AgentThreadFindHit> {
  return findInThread(thread.thread, query, { maxEventsPerTurn: MAX_RENDERED_EVENTS_PER_TURN });
}

function texts(values: ReadonlyArray<string>): ReadonlyArray<AgentTurnEvent> {
  return values.map((text) => ({ kind: "assistantText", text }));
}

function turnOf(status: AgentTurnStatus, values: ReadonlyArray<string>): AgentTurn {
  return turnWith(status, texts(values));
}

function turnWith(status: AgentTurnStatus, events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt: "Check the project",
    status,
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function view(
  status: AgentTurnStatus,
  texts: ReadonlyArray<string>,
  threadId = THREAD_ID,
  ownerId = OWNER_ID,
): AgentThreadView {
  return viewOf([turnOf(status, texts)], threadId, ownerId);
}

function remoteView(texts: ReadonlyArray<string>): AgentThreadView {
  return {
    ...view(SETTLED, texts),
    execution: {
      kind: "remote",
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      conversationId: "conversation",
      latestTaskId: "task",
      resume: null,
      reachability: REMOTE_RUNNER_REACHABLE,
    },
  };
}

function importedView(answer: string): AgentThreadView {
  const sessionId = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
  return viewOf([], THREAD_ID, OWNER_ID, {
    provider: "claudeCode",
    sessionId,
    importedAtEpochMs: NOW - 60_000,
    history: {
      provider: "claudeCode",
      sessionId,
      exchanges: [{ role: "assistant", text: answer }],
      exchangesTruncated: false,
      totalPreviewBytes: 32,
    },
  });
}

function viewOf(
  turns: ReadonlyArray<AgentTurn>,
  threadId = THREAD_ID,
  ownerId = OWNER_ID,
  externalOrigin: AgentThread["externalOrigin"] = null,
): AgentThreadView {
  const running = turns.some((turn) => turn.status.kind === "running");
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
