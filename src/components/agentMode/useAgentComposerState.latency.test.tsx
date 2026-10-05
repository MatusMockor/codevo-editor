// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentComposerDraftStore,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import type { AgentComposerMode, AgentComposerSubmission } from "./AgentComposer";
import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
import {
  useAgentComposerPromptState,
  type AgentComposerPromptController,
  type AgentComposerPromptProps,
} from "./useAgentComposerState";

const SUBMISSION: AgentComposerSubmission = {
  launch: defaultAgentLaunchOptions("codex"),
  dangerousLaunchConfirmed: false,
};
const MODES: ReadonlyArray<AgentComposerMode> = [
  { kind: "new" },
  { kind: "followUp", blockedReason: null },
];

interface Deferred {
  readonly promise: Promise<boolean>;
  resolve(value: boolean): void;
}

function deferred(): Deferred {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("composer send latency and admission stress", () => {
  let host: HTMLDivElement;
  let root: Root;
  let drafts: AgentComposerDraftStore;
  let captured: AgentComposerPromptProps | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    drafts = createAgentComposerDraftStore();
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function current(): AgentComposerPromptProps {
    expect(captured).not.toBeNull();
    return captured as AgentComposerPromptProps;
  }

  function field(): HTMLTextAreaElement {
    const element = host.querySelector("textarea");
    if (element === null) throw new Error("Prompt field missing");
    return element;
  }

  function Harness({ controller }: { readonly controller: AgentComposerPromptController }) {
    const props = useAgentComposerPromptState(controller);
    captured = props;
    return (
      <textarea
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.target.value)}
      />
    );
  }

  function render(
    mode: AgentComposerMode,
    submit: AgentComposerPromptController["submit"],
    ownerKey = "owner-a",
    draftKey = mode.kind === "new" ? "new:/workspace/app" : "thread-a",
  ): void {
    const controller: AgentComposerPromptController = {
      drafts,
      submit,
      submissionBlocked: false,
      composerProps: {
        draftKey,
        promptOwnerKey: ownerKey,
        target: null,
        isolation: "in-place",
        isolationReason: null,
        worktreeAvailable: true,
        worktreeOnly: false,
        worktreeOnlyReason: null,
        guard: { kind: "safe" },
        launch: SUBMISSION.launch,
        launchProvider: "codex",
        dispatching: false,
        running: false,
        mode,
        onStop: () => undefined,
        onSelectRepository: () => undefined,
        onIsolationChange: () => undefined,
        onLaunchChange: () => undefined,
        onNewThread: () => undefined,
      },
    };
    act(() => root.render(<Harness controller={controller} />));
  }

  it.each(MODES)(
    "clears the field independently of slow provider acceptance in $kind (64 sends)",
    async (mode) => {
      let pending = deferred();
      const submit = vi.fn(() => pending.promise);
      const commitLatencies: number[] = [];
      render(mode, submit);

      for (let index = 0; index < 64; index += 1) {
        pending = deferred();
        act(() => current().onPromptChange(`Message ${index}`));
        const startedAt = performance.now();
        act(() => current().onSubmit(SUBMISSION));
        commitLatencies.push(performance.now() - startedAt);
        expect(field().value).toBe("");
        expect(submit).toHaveBeenCalledTimes(index + 1);
        act(() => current().onPromptChange(`Next draft ${index}`));
        await act(async () => pending.resolve(true));
        expect(field().value).toBe(`Next draft ${index}`);
      }
      if (process.env.CODEVO_SEND_LATENCY_REPORT === "1") {
        const sorted = [...commitLatencies].sort((left, right) => left - right);
        console.info("Composer jsdom Send → act-settled DOM commit", {
          mode: mode.kind,
          samples: sorted.length,
          p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          maxMs: sorted[sorted.length - 1],
        });
      }
    },
  );

  it.each(MODES)(
    "admits one send from a burst of 100 retained callbacks in $kind",
    async (mode) => {
      const pending = deferred();
      const submit = vi.fn(() => pending.promise);
      render(mode, submit);
      act(() => current().onPromptChange("One message"));
      const retained = current().onSubmit;

      act(() => {
        for (let index = 0; index < 100; index += 1) retained(SUBMISSION);
      });

      expect(submit).toHaveBeenCalledTimes(1);
      expect(field().value).toBe("");
      await act(async () => pending.resolve(false));
      expect(field().value).toBe("One message");
    },
  );

  it("refuses a retained callback after another prompt was typed", () => {
    const submit = vi.fn(async () => true);
    render(MODES[0]!, submit);
    act(() => current().onPromptChange("Old prompt"));
    const retained = current().onSubmit;
    act(() => current().onPromptChange("New prompt"));

    act(() => retained(SUBMISSION));

    expect(submit).not.toHaveBeenCalled();
    expect(field().value).toBe("New prompt");
  });

  it("refuses retained callbacks after owner A → B → A replacement", () => {
    const submit = vi.fn(async () => true);
    render(MODES[0]!, submit);
    act(() => current().onPromptChange("Old owner"));
    const retained = current().onSubmit;
    render(MODES[0]!, submit, "owner-b");
    render(MODES[0]!, submit, "owner-a");

    act(() => retained(SUBMISSION));

    expect(submit).not.toHaveBeenCalled();
    expect(field().value).toBe("Old owner");
  });

  it.each(MODES)(
    "restores a late failure next to edits made during a slow $kind send",
    async (mode) => {
      const pending = deferred();
      render(mode, () => pending.promise);
      act(() => current().onPromptChange("Sent text"));
      act(() => current().onSubmit(SUBMISSION));
      act(() => current().onPromptChange("New draft"));

      await act(async () => pending.resolve(false));

      expect(field().value).toBe("New draft\n\nSent text");
    },
  );

  it("keeps a late failure under its own draft when another owner is composed", async () => {
    const pending = deferred();
    render(MODES[1]!, () => pending.promise);
    act(() => current().onPromptChange("Sent text"));
    act(() => current().onSubmit(SUBMISSION));
    render(MODES[1]!, async () => true, "owner-b", "thread-b");
    act(() => current().onPromptChange("Other owner's draft"));

    await act(async () => pending.resolve(false));

    expect(field().value).toBe("Other owner's draft");
    expect(drafts.readDraft("thread-a")).toBe("Sent text");
    expect(drafts.readDraft("thread-b")).toBe("Other owner's draft");
  });
});
