// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposer, type AgentComposerProps } from "../AgentComposer";
import { presentAgentApproval } from "../agentApprovalPresenter";
import { AgentComposerFrame } from "./AgentComposerFrame";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function composerFixture(): AgentComposerProps {
  return {
    target: {
      projectLabel: "app",
      projectRoot: "/workspace/app",
      selectedRepositoryRoot: "/workspace/app",
      repositoryOptions: [{ repositoryRoot: "/workspace/app/repo-0", label: "repo-0" }],
    },
    prompt: "half-typed draft",
    promptBytes: 16,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "followUp", blockedReason: null },
    onSelectRepository: vi.fn(),
    onPromptChange: vi.fn(),
    onIsolationChange: vi.fn(),
    onLaunchChange: vi.fn(),
    onNewThread: vi.fn(),
    onOpenProviderSettings: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe("AgentComposerFrame", () => {
  it("stacks banners, slab and drawer in the column with the layout marker", () => {
    act(() =>
      root.render(
        <AgentComposerFrame
          banners={<p>clone</p>}
          drawerEnd={<span>feat/idempotency-keys</span>}
          drawerStart={<span>Local checkout</span>}
          layout="hero"
          slab={<form aria-label="Slab" />}
        />,
      ),
    );

    const dock = host.querySelector<HTMLElement>(".cv-composer-dock");
    expect(dock?.dataset.layout).toBe("hero");
    const column = dock?.querySelector(".cv-composer.cv-conversation-column");
    expect([...(column?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-composer__banners",
      "",
      "cv-composer__drawer agent-composer__footer",
    ]);
    expect(host.querySelector(".cv-composer__drawer-start")?.textContent).toBe("Local checkout");
    expect(host.querySelector(".cv-composer__drawer-end")?.textContent).toBe(
      "feat/idempotency-keys",
    );
  });

  it("keeps the typed draft while an approval replaces the editor", () => {
    const props = composerFixture();
    const approval = {
      kind: "approval" as const,
      key: "approval:task:a1",
      pendingCount: 1,
      sending: false,
      error: null,
      decide: vi.fn().mockResolvedValue(undefined),
      view: presentAgentApproval({
        id: "a1",
        taskId: "task",
        provider: "codex",
        kind: "command",
        title: "outside the sandbox",
        detail: "npm test",
        detailTruncated: false,
        facts: [],
        decisions: ["allowOnce", "deny"],
        status: "pending",
      }),
    };
    act(() => root.render(<AgentComposer {...props} interaction={approval} />));

    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe("half-typed draft");
    expect(textarea?.closest(".agent-composer__box")?.hasAttribute("hidden")).toBe(true);
    expect(
      host
        .querySelector(".cv-composer__slab > .agent-composer > .cv-composer__foot")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(host.querySelector('.cv-composer__slab [aria-label="Approval request"]')).not.toBeNull();

    act(() => root.render(<AgentComposer {...props} interaction={null} />));
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("half-typed draft");
    expect(host.querySelector(".agent-composer__box")?.hasAttribute("hidden")).toBe(false);
  });
});
