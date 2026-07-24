// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MAX_DEBUG_EVALUATION_EXPRESSION_BYTES } from "../domain/debugEvaluationPolicy";
import type {
  DebugEvaluateInConsoleCapture,
  DebugEvaluateInConsoleCaptureReader,
} from "../domain/debugEvaluateInConsoleCapture";
import {
  useDebugEvaluateInConsole,
  type DebugEvaluateInConsoleCommands,
  type DebugEvaluateInConsoleContext,
} from "./useDebugEvaluateInConsole";

const baseCapture: DebugEvaluateInConsoleCapture = {
  currentLineText: "const result = dirtyBuffer.value;",
  documentPath: "/workspace/src/app.ts",
  focused: true,
  modelIdentity: "group-a:model-1",
  modelVersion: 7,
  selection: {
    endColumn: 33,
    endLineNumber: 1,
    startColumn: 16,
    startLineNumber: 1,
  },
  selectionText: "dirtyBuffer.value",
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

const stoppedNode: DebugEvaluateInConsoleContext = {
  adapterKind: "node",
  frameId: 11,
  pauseGeneration: 3,
  rootPath: "/workspace",
  sessionId: 7,
  stateKind: "stopped",
};

interface HookOptions {
  readonly captures?: readonly (DebugEvaluateInConsoleCapture | null)[];
  readonly contexts?: readonly DebugEvaluateInConsoleContext[];
  readonly focusConsole?: () => void;
  readonly isWorkspaceCurrent?: (workspaceRoot: string, workspaceOwnerKey: string) => boolean;
  readonly isWorkspaceTrusted?: () => boolean;
  readonly submit?: (expression: string) => Promise<void>;
}

function renderHook(options: HookOptions = {}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captures = options.captures ?? [baseCapture];
  const contexts = options.contexts ?? [stoppedNode];
  let captureIndex = 0;
  let contextIndex = 0;
  const captureReader: DebugEvaluateInConsoleCaptureReader = {
    readDebugEvaluateInConsoleCapture: vi.fn(
      () => captures[Math.min(captureIndex++, captures.length - 1)] ?? null,
    ),
  };
  const focusConsole = options.focusConsole ?? vi.fn();
  const submit = options.submit ?? vi.fn().mockResolvedValue(undefined);
  const captured: { value: DebugEvaluateInConsoleCommands | null } = { value: null };

  function Harness() {
    captured.value = useDebugEvaluateInConsole({
      captureReader,
      focusConsole,
      getDebugContext: () => contexts[Math.min(contextIndex++, contexts.length - 1)]!,
      isWorkspaceCurrent: options.isWorkspaceCurrent ?? (() => true),
      isWorkspaceTrusted: options.isWorkspaceTrusted ?? (() => true),
      submit,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    captureReader,
    focusConsole,
    hook: () => captured.value as DebugEvaluateInConsoleCommands,
    submit,
    unmount: () => act(() => root.unmount()),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("useDebugEvaluateInConsole", () => {
  it("prefers the trimmed live selection and submits exactly once before focusing", () => {
    const calls: string[] = [];
    const submit = vi.fn((expression: string) => {
      calls.push(`submit:${expression}`);
      return Promise.resolve();
    });
    const focusConsole = vi.fn(() => calls.push("focus"));
    const capture = { ...baseCapture, selectionText: "  dirtyBuffer.value  " };
    const ui = renderHook({ captures: [capture], focusConsole, submit });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith("dirtyBuffer.value");
    expect(focusConsole).toHaveBeenCalledOnce();
    expect(calls).toEqual(["submit:dirtyBuffer.value", "focus"]);
    ui.unmount();
  });

  it("falls back to the trimmed current dirty-model line for an empty selection", () => {
    const capture = {
      ...baseCapture,
      currentLineText: "  mutateDraft()  ",
      selection: {
        endColumn: 4,
        endLineNumber: 1,
        startColumn: 4,
        startLineNumber: 1,
      },
      selectionText: "",
    };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(ui.submit).toHaveBeenCalledWith("mutateDraft()");
    ui.unmount();
  });

  it("accepts the normalized range produced for a reversed single-line Monaco selection", () => {
    const capture = {
      ...baseCapture,
      selection: {
        endColumn: 14,
        endLineNumber: 1,
        startColumn: 5,
        startLineNumber: 1,
      },
      selectionText: "user.name",
    };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(ui.submit).toHaveBeenCalledWith("user.name");
    ui.unmount();
  });

  it.each(["firstPart +\nsecondPart", "firstPart +\r\nsecondPart"])(
    "fails closed for multiline selection %j without changing JavaScript semantics",
    (selectionText) => {
      const capture = {
        ...baseCapture,
        currentLineText: "secondPart",
        selection: {
          endColumn: 11,
          endLineNumber: 2,
          startColumn: 1,
          startLineNumber: 1,
        },
        selectionText,
      };
      const ui = renderHook({ captures: [capture] });

      expect(ui.hook().evaluateInConsole()).toBe(false);
      expect(ui.submit).not.toHaveBeenCalled();
      expect(ui.focusConsole).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it.each([
    ["whitespace", "   "],
    ["control", "safe\u0000unsafe"],
    ["over-4KiB UTF-8", "ž".repeat(MAX_DEBUG_EVALUATION_EXPRESSION_BYTES / 2 + 1)],
  ])("rejects %s without submit or focus", (_label, selectionText) => {
    const capture = { ...baseCapture, currentLineText: "  ", selectionText };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().canEvaluateInConsole()).toBe(false);
    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("does not replace a non-empty whitespace selection with the current line", () => {
    const capture = {
      ...baseCapture,
      currentLineText: "dangerousSideEffect()",
      selection: { ...baseCapture.selection, endColumn: baseCapture.selection.startColumn + 3 },
      selectionText: "   ",
    };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("accepts the exact 4 KiB UTF-8 boundary and allowed tabs", () => {
    const exact = "ž".repeat(MAX_DEBUG_EVALUATION_EXPRESSION_BYTES / 2);
    const capture = { ...baseCapture, selectionText: exact };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(ui.submit).toHaveBeenCalledWith(exact);
    ui.unmount();

    const tabbed = { ...baseCapture, selectionText: "value\tmember" };
    const tabbedUi = renderHook({ captures: [tabbed] });
    expect(tabbedUi.hook().evaluateInConsole()).toBe(true);
    expect(tabbedUi.submit).toHaveBeenCalledWith("value\tmember");
    tabbedUi.unmount();
  });

  it.each([
    ["content", { currentLineText: "replacement()" }],
    ["selection text", { selectionText: "replacement.value" }],
    ["document", { documentPath: "/workspace/src/other.ts" }],
    ["focus", { focused: false }],
    ["model", { modelIdentity: "group-b:model-2" }],
    ["version", { modelVersion: 8 }],
    ["range", { selection: { ...baseCapture.selection, endColumn: 32 } }],
    ["owner", { workspaceOwnerKey: "owner-b" }],
    ["root", { workspaceRoot: "/other" }],
  ])("rejects %s drift across the two synchronous captures", (_label, change) => {
    const ui = renderHook({ captures: [baseCapture, { ...baseCapture, ...change }] });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rejects A to B to A and same-root workspace owner replacement", () => {
    let currentOwner = "owner-a";
    const isWorkspaceCurrent = vi.fn((_root: string, owner: string) => {
      const accepted = owner === currentOwner;
      currentOwner = "owner-b";
      return accepted;
    });
    const ui = renderHook({ isWorkspaceCurrent });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(isWorkspaceCurrent).toHaveBeenCalledTimes(2);
    expect(ui.submit).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["unfocused editor", { focused: false }],
    ["unsupported document", { documentPath: "/workspace/src/app.php" }],
    ["workspace escape", { documentPath: "/outside/app.ts" }],
    ["missing model identity", { modelIdentity: "" }],
    ["oversized model identity", { modelIdentity: "m".repeat(1_025) }],
    ["invalid model version", { modelVersion: 0 }],
    [
      "selection text inconsistent with an empty range",
      {
        selection: {
          endColumn: 4,
          endLineNumber: 1,
          startColumn: 4,
          startLineNumber: 1,
        },
      },
    ],
    [
      "non-normalized selection range",
      {
        selection: {
          endColumn: 2,
          endLineNumber: 1,
          startColumn: 3,
          startLineNumber: 1,
        },
      },
    ],
  ])("rejects invalid live capture metadata: %s", (_label, change) => {
    const capture = { ...baseCapture, ...change };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["inactive", { stateKind: "inactive" as const }],
    ["running", { stateKind: "running" as const }],
    ["PHP", { adapterKind: "php" as const }],
    ["missing frame", { frameId: null }],
    ["missing pause", { pauseGeneration: null }],
    ["missing session", { sessionId: null }],
    ["different root", { rootPath: "/other" }],
  ])("requires the exact trusted paused owned Node context: %s", (_label, change) => {
    const ui = renderHook({ contexts: [{ ...stoppedNode, ...change }] });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed when trust is absent or its live reader throws", () => {
    for (const isWorkspaceTrusted of [
      () => false,
      () => {
        throw new Error("trust unavailable");
      },
    ]) {
      const ui = renderHook({ isWorkspaceTrusted });
      expect(ui.hook().evaluateInConsole()).toBe(false);
      expect(ui.submit).not.toHaveBeenCalled();
      expect(ui.focusConsole).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("fails closed when the synchronous editor capture port throws", () => {
    const ui = renderHook();
    vi.mocked(ui.captureReader.readDebugEvaluateInConsoleCapture).mockImplementation(() => {
      throw new Error("editor disposed");
    });

    expect(ui.hook().canEvaluateInConsole()).toBe(false);
    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rejects trust loss between the two live capture reads", () => {
    let trusted = true;
    const ui = renderHook({
      isWorkspaceTrusted: vi.fn(() => {
        const current = trusted;
        trusted = false;
        return current;
      }),
    });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["resume", { stateKind: "running" as const }],
    ["frame", { frameId: 12 }],
    ["pause", { pauseGeneration: 4 }],
    ["session", { sessionId: 8 }],
  ])("rejects %s drift between capture validation and dispatch", (_label, change) => {
    const ui = renderHook({ contexts: [stoppedNode, { ...stoppedNode, ...change }] });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).not.toHaveBeenCalled();
    expect(ui.focusConsole).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("single-flights command-originated side effects until submission settles", async () => {
    const submission = deferred();
    const ui = renderHook({ submit: vi.fn(() => submission.promise) });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(ui.hook().canEvaluateInConsole()).toBe(false);
    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.submit).toHaveBeenCalledOnce();
    expect(ui.focusConsole).toHaveBeenCalledOnce();

    await act(async () => {
      submission.resolve();
      await submission.promise;
    });
    expect(ui.hook().canEvaluateInConsole()).toBe(true);
    ui.unmount();
  });

  it("does not focus and releases admission after a synchronous submit failure", () => {
    const ui = renderHook({
      submit: vi.fn(() => {
        throw new Error("submit unavailable");
      }),
    });

    expect(ui.hook().evaluateInConsole()).toBe(false);
    expect(ui.focusConsole).not.toHaveBeenCalled();
    expect(ui.hook().canEvaluateInConsole()).toBe(true);
    ui.unmount();
  });

  it("isolates a synchronous focus failure after accepted submission without inviting a retry", async () => {
    const submission = deferred();
    const ui = renderHook({
      focusConsole: vi.fn(() => {
        throw new Error("panel unavailable");
      }),
      submit: vi.fn(() => submission.promise),
    });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    expect(ui.submit).toHaveBeenCalledOnce();
    expect(ui.hook().canEvaluateInConsole()).toBe(false);
    expect(ui.hook().evaluateInConsole()).toBe(false);

    await act(async () => {
      submission.resolve();
      await submission.promise;
    });
    expect(ui.hook().canEvaluateInConsole()).toBe(true);
    ui.unmount();
  });

  it("releases admission without an unhandled failure after submit rejects", async () => {
    const submission = deferred();
    const ui = renderHook({ submit: vi.fn(() => submission.promise) });

    expect(ui.hook().evaluateInConsole()).toBe(true);
    await act(async () => {
      submission.reject(new Error("evaluation failed"));
      await submission.promise.catch(() => undefined);
    });

    expect(ui.hook().canEvaluateInConsole()).toBe(true);
    expect(ui.submit).toHaveBeenCalledOnce();
    expect(ui.focusConsole).toHaveBeenCalledOnce();
    ui.unmount();
  });
});
