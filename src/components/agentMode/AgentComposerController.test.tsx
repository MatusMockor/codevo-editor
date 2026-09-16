// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentComposerSubmission } from "./AgentComposer";
import type { AgentComposerControllerProps } from "./AgentComposerController";

const submission: AgentComposerSubmission = {
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  dangerousLaunchConfirmed: false,
};

vi.mock("./useAgentComposerState", () => ({
  useAgentComposerPromptState: () => ({}),
  WITHOUT_COMPOSER_ATTACHMENTS: { attachments: false },
}));

vi.mock("./AgentComposer", () => ({
  AgentComposer: ({
    onCompactContext,
    contextUsage,
  }: {
    readonly onCompactContext: (submission: AgentComposerSubmission) => void;
    readonly contextUsage?: { readonly usedTokens: number; readonly contextWindow: number } | null;
  }) => (
    <>
      <button onClick={() => onCompactContext(submission)}>Compact</button>
      <output>
        {contextUsage === null || contextUsage === undefined
          ? "Unknown"
          : `${contextUsage.usedTokens}/${contextUsage.contextWindow}`}
      </output>
    </>
  ),
}));

import { AgentComposerController } from "./AgentComposerController";

describe("AgentComposerController context compaction", () => {
  beforeEach(() => {
    agentComposerDraftStore.reset();
  });

  it("submits Claude's compact command into the existing session without attachments", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const submit = vi.fn(async () => true);
    const props = {
      compactionOffer: { key: "offer", contextTokens: 120_000 },
      composerProps: {},
      providerManagement: {},
      providerEnabled: { claudeCode: true, codex: true },
      submissionBlocked: false,
      submit,
      onOpenProviderSettings: () => undefined,
    } as unknown as AgentComposerControllerProps;

    act(() => root.render(<AgentComposerController {...props} />));
    act(() =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(submit).toHaveBeenCalledWith("/compact", submission, { attachments: false });
    act(() => root.unmount());
    host.remove();
  });

  it("updates and clears context telemetry through the memoized controller", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const props = {
      composerProps: {},
      providerManagement: {},
      providerEnabled: { claudeCode: true, codex: true },
      submissionBlocked: false,
      submit: async () => true,
      onOpenProviderSettings: () => undefined,
    } as unknown as AgentComposerControllerProps;
    try {
      for (const [contextUsage, expected] of [
        [null, "Unknown"],
        [{ usedTokens: 120, contextWindow: 200 }, "120/200"],
        [{ usedTokens: 140, contextWindow: 200 }, "140/200"],
        [{ usedTokens: 140, contextWindow: 1000 }, "140/1000"],
        [null, "Unknown"],
      ] as const) {
        act(() => root.render(<AgentComposerController {...props} contextUsage={contextUsage} />));
        expect(host.querySelector("output")?.textContent).toBe(expected);
      }
    } finally {
      act(() => root.unmount());
    }
  });
});
