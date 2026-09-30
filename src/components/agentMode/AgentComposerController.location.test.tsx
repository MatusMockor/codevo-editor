// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceLocation } from "../../domain/agentWorkspaceLocation";
import type { AgentComposerControllerProps } from "./AgentComposerController";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";

vi.mock("./useAgentComposerState", () => ({
  useAgentComposerPromptState: ({
    composerProps,
  }: {
    readonly composerProps: Record<string, unknown>;
  }) => composerProps,
}));

vi.mock("./AgentComposer", () => ({
  AgentComposer: ({
    previousWorktree,
    threadLocation,
  }: {
    readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null;
    readonly threadLocation?: AgentWorkspaceLocation | null;
  }) => (
    <output>
      {`${threadLocation?.checkout ?? "none"}|${threadLocation?.branch ?? "none"}|${
        previousWorktree?.selected === true ? "previous" : "fresh"
      }`}
    </output>
  ),
}));

import { AgentComposerController } from "./AgentComposerController";

function location(branch: string): AgentWorkspaceLocation {
  return { machine: { kind: "thisComputer" }, checkout: "localCheckout", branch, path: "/repo" };
}

describe("AgentComposerController workspace location", () => {
  it("re-renders the composer when the thread location or the previous worktree changes", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const onSelect = vi.fn();
    const available = { threadId: "agt-9", worktreePath: "/wt/agt-9", branch: "agent/retry" };
    const base = {
      providerManagement: {},
      providerEnabled: { claudeCode: true, codex: true },
      submissionBlocked: false,
      submit: async () => true,
      onOpenProviderSettings: () => undefined,
    };
    const renderWith = (composerProps: Record<string, unknown>) => {
      const props = {
        ...base,
        composerProps: {
          guard: { kind: "safe" },
          mode: { kind: "new" },
          worktreeBase: { kind: "head" },
          target: null,
          launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
          ...composerProps,
        },
      } as unknown as AgentComposerControllerProps;
      act(() => root.render(<AgentComposerController {...props} />));
    };

    renderWith({ threadLocation: location("main") });
    expect(host.textContent).toBe("localCheckout|main|fresh");
    renderWith({ threadLocation: location("feature/x") });
    expect(host.textContent).toBe("localCheckout|feature/x|fresh");
    renderWith({
      threadLocation: null,
      previousWorktree: { available, selected: false, onSelect },
    });
    expect(host.textContent).toBe("none|none|fresh");
    renderWith({
      threadLocation: null,
      previousWorktree: { available, selected: true, onSelect },
    });
    expect(host.textContent).toBe("none|none|previous");
    act(() => root.unmount());
  });
});
