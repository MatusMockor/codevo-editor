// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentComposerSubmission } from "./AgentComposer";
import type { AgentComposerControllerProps } from "./AgentComposerController";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";

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
    banners,
    renderDrawerEnd,
  }: {
    readonly onCompactContext: (submission: AgentComposerSubmission) => void;
    readonly contextUsage?: { readonly usedTokens: number; readonly contextWindow: number } | null;
    readonly banners?: ReactNode;
    readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;
  }) => (
    <>
      <div className="cv-composer__banners">{banners}</div>
      <div className="cv-composer__drawer-end">
        {renderDrawerEnd?.({
          repositoryRoot: null,
          isolation: "in-place",
          locked: true,
          disabled: false,
        })}
      </div>
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

  it("does not forward context usage telemetry into the composer", () => {
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
      act(() => root.render(<AgentComposerController {...props} />));
      expect(host.querySelector("output")?.textContent).toBe("Unknown");
    } finally {
      act(() => root.unmount());
    }
  });

  it("re-renders when the extension slots change and passes them through", () => {
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
    const renderController = (extra: Partial<AgentComposerControllerProps>) =>
      act(() => root.render(<AgentComposerController {...props} {...extra} />));

    renderController({
      banners: <p className="p8-banner">Cloning orders-api</p>,
      renderDrawerEnd: () => <span className="p9-branch">main</span>,
    });
    expect(host.querySelector(".cv-composer__banners .p8-banner")?.textContent).toBe(
      "Cloning orders-api",
    );
    expect(host.querySelector(".cv-composer__drawer-end .p9-branch")?.textContent).toBe("main");

    renderController({
      banners: <p className="p8-banner">Cloned orders-api</p>,
      renderDrawerEnd: () => <span className="p9-branch">feat/idempotency-keys</span>,
    });
    expect(host.querySelector(".cv-composer__banners .p8-banner")?.textContent).toBe(
      "Cloned orders-api",
    );
    expect(host.querySelector(".cv-composer__drawer-end .p9-branch")?.textContent).toBe(
      "feat/idempotency-keys",
    );
    act(() => root.unmount());
  });
});
