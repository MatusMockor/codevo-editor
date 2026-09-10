// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { agentMarkdownPlainReasonLabel } from "../../domain/agentMarkdown/agentMarkdownTree";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";
import {
  useAgentMarkdown,
  useAgentMarkdownRenderer,
  usePreloadAgentMarkdownRenderer,
} from "./useAgentMarkdown";

const loader = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let loaded: AgentMarkdownRenderer | null = null;
  let broken = false;
  const waiting: Array<(renderer: AgentMarkdownRenderer) => void> = [];
  return {
    loadCalls: 0,
    loadAgentMarkdownRenderer: vi.fn(() => {
      loader.loadCalls += 1;
      if (broken) return Promise.reject(new Error("chunk unavailable"));
      return new Promise<AgentMarkdownRenderer>((resolve) => {
        waiting.push(resolve);
      });
    }),
    peekAgentMarkdownRenderer: () => loaded,
    subscribeAgentMarkdownRenderer: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    finish(renderer: AgentMarkdownRenderer) {
      loaded = renderer;
      waiting.splice(0).forEach((resolve) => resolve(renderer));
      listeners.forEach((listener) => listener());
    },
    breakLoad() {
      broken = true;
    },
    reset() {
      loaded = null;
      broken = false;
      waiting.length = 0;
      loader.loadCalls = 0;
      loader.loadAgentMarkdownRenderer.mockClear();
    },
  };
});

vi.mock("../../infrastructure/markdown/agentMarkdownRendererAdapter", () => ({
  loadAgentMarkdownRenderer: loader.loadAgentMarkdownRenderer,
  peekAgentMarkdownRenderer: loader.peekAgentMarkdownRenderer,
  subscribeAgentMarkdownRenderer: loader.subscribeAgentMarkdownRenderer,
}));

const renderer: AgentMarkdownRenderer = {
  lexBlocks: (markdown) => [{ type: "paragraph", raw: markdown, token: {} as never }],
  renderBlock: (block) => paragraphNodes(block.raw),
  renderDocument: (markdown) => paragraphNodes(markdown),
};

function paragraphNodes(text: string): ReturnType<AgentMarkdownRenderer["renderDocument"]> {
  return {
    kind: "nodes",
    nodes: [{ kind: "container", tag: "p", children: [{ kind: "text", text }] }],
  };
}

function threadWith(text: string): AgentThreadView {
  const record: AgentThread = {
    threadId: "agt-1",
    owner: {
      rootKey: "/workspace/app",
      ownerId: "agent-root:app",
      repositoryRoot: "/workspace/app",
    },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "Check the project",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_700_000_000_000,
        endedAtEpochMs: 1_700_000_030_000,
        events: [{ kind: "assistantText", text }],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
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

describe("useAgentMarkdown", () => {
  let host: HTMLDivElement;
  let root: Root;
  const seen: string[] = [];

  function Probe({ override }: { readonly override?: AgentMarkdownRenderer | null }) {
    const active = useAgentMarkdownRenderer(override);
    const presentation = useAgentMarkdown(active, "hello", false, "", "parse");
    seen.push(presentation.kind);
    return (
      <span
        data-kind={presentation.kind}
        data-reason={presentation.kind === "plain" ? presentation.reason : undefined}
      />
    );
  }

  beforeEach(() => {
    loader.reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    seen.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("reports pending until the lazy renderer arrives, then renders without a reload", async () => {
    act(() => root.render(<Probe />));
    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("pending");
    expect(loader.loadAgentMarkdownRenderer).toHaveBeenCalledTimes(1);

    await act(async () => loader.finish(renderer));

    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("rendered");
    expect(seen).toEqual(["pending", "rendered"]);
  });

  it("falls back to readable plain text when the markdown chunk cannot load", async () => {
    loader.breakLoad();

    await act(async () => root.render(<Probe />));

    const span = host.querySelector("span");
    expect(span?.getAttribute("data-kind")).toBe("plain");
    expect(span?.getAttribute("data-reason")).toBe("renderer-unavailable");
    expect(agentMarkdownPlainReasonLabel("renderer-unavailable")).toBe(
      "Shown as plain text: formatting could not be loaded.",
    );
  });

  it("never paints markdown source while the renderer chunk is still loading", async () => {
    const source = "## Heading\n\n| check | outcome |\n|---|---|\n| lint | ok |";
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          markdownViewport={null}
          onReviewInDiff={() => undefined}
          thread={threadWith(source)}
        />,
      ),
    );

    const body = host.querySelector('[data-agent-event="e0"]');
    expect(body?.getAttribute("data-agent-markdown")).toBe("pending");
    expect(body?.querySelectorAll("p.agent-text__paragraph")).toHaveLength(0);
    expect(host.textContent).not.toContain("##");
    expect(host.textContent).not.toContain("|---|");
    expect(host.querySelector(".agent-md__note")).toBeNull();

    await act(async () => loader.finish(renderer));

    expect(host.querySelector('[data-agent-event="e0"]')?.getAttribute("data-agent-markdown")).toBe(
      "rendered",
    );
  });

  it("preloads the renderer once from the agent surface and survives a failed load", async () => {
    loader.breakLoad();
    function Surface() {
      usePreloadAgentMarkdownRenderer();
      return <span data-surface="agent" />;
    }

    await act(async () => root.render(<Surface />));
    await act(async () => root.render(<Surface />));

    expect(loader.loadAgentMarkdownRenderer).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-surface="agent"]')).not.toBeNull();
  });

  it("starts that preload from the agent surface itself, not from the first message", () => {
    const source = readFileSync(join(import.meta.dirname, "AgentModeView.tsx"), "utf8");
    expect(source).toContain("usePreloadAgentMarkdownRenderer");
    expect(source).toContain("usePreloadAgentMarkdownRenderer();");
  });

  it("prefers an injected renderer and skips the lazy load", () => {
    const calls = loader.loadCalls;
    act(() => root.render(<Probe override={renderer} />));

    expect(host.querySelector("span")?.getAttribute("data-kind")).toBe("rendered");
    expect(loader.loadCalls).toBe(calls);
  });
});
