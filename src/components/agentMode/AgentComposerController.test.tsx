// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentComposerSubmission } from "./AgentComposer";
import type { AgentComposerControllerProps } from "./AgentComposerController";

const submission: AgentComposerSubmission = {
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  dangerousLaunchConfirmed: false,
};

vi.mock("./useAgentComposerState", () => ({
  useAgentComposerPromptState: () => ({}),
}));

vi.mock("./AgentComposer", () => ({
  AgentComposer: ({
    onCompactContext,
  }: {
    readonly onCompactContext: (submission: AgentComposerSubmission) => void;
  }) => <button onClick={() => onCompactContext(submission)}>Compact</button>,
}));

import { AgentComposerController } from "./AgentComposerController";

describe("AgentComposerController context compaction", () => {
  it("submits Claude's compact command into the existing session", () => {
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

    expect(submit).toHaveBeenCalledWith("/compact", submission);
    act(() => root.unmount());
    host.remove();
  });
});
