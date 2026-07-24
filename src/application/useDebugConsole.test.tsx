// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugEvaluationOwner } from "../domain/debugEvaluationPolicy";
import type { DebugConsoleResultOwner } from "../domain/debugConsoleState";
import type { DebugOutputLine } from "./debugSessionContracts";
import { useDebugConsole, type UseDebugConsoleResult } from "./useDebugConsole";

describe("useDebugConsole", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: UseDebugConsoleResult;
  let options: {
    evaluate(expression: string): Promise<DebugVariable | null>;
    output: readonly DebugOutputLine[];
    owner: DebugEvaluationOwner | null;
    resultOwner?: Omit<DebugConsoleResultOwner, "epoch"> | null;
  };

  function Harness() {
    current = useDebugConsole(options);
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    options = {
      evaluate: vi.fn().mockResolvedValue(null),
      output: [],
      owner: { sessionId: 7, pauseGeneration: 1 },
    };
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("appends only new output across ordinary growth and source-buffer trimming", () => {
    const one = { stream: "stdout" as const, text: "one" };
    const two = { stream: "stderr" as const, text: "two" };
    const three = { stream: "stdout" as const, text: "three" };
    options.output = [one, two];
    render();
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["stdout", "stderr"]);

    options = { ...options, output: [one, two, three] };
    render();
    expect(current.state.entries.map((entry) => entry.kind)).toEqual([
      "stdout",
      "stderr",
      "stdout",
    ]);

    options = { ...options, output: [two, three] };
    render();
    expect(current.state.entries).toHaveLength(3);
  });

  it("records pending and settled entries chronologically around process output", async () => {
    let resolve!: (value: DebugVariable) => void;
    options.evaluate = vi.fn(
      () =>
        new Promise<DebugVariable>((settle) => {
          resolve = settle;
        }),
    );
    render();
    let submission!: Promise<void>;
    act(() => {
      submission = current.submit("count");
    });
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["pending"]);

    const line = { stream: "stdout" as const, text: "during evaluation" };
    options = { ...options, output: [line] };
    render();
    await act(async () => {
      resolve({ name: "count", value: "3", type: "number", variablesReference: 0 });
      await submission;
    });
    expect(current.state.entries.map((entry) => entry.kind)).toEqual([
      "pending",
      "stdout",
      "result",
    ]);
  });

  it("binds a result to the exact frame and workspace owner captured at submission", async () => {
    let resolve!: (value: DebugVariable) => void;
    const submittedOwner = {
      frameId: 11,
      pauseGeneration: 1,
      rootKey: "/workspace",
      sessionId: 7,
      workspaceOwnerKey: "workspace-owner",
    };
    options.resultOwner = submittedOwner;
    options.evaluate = () =>
      new Promise<DebugVariable>((settle) => {
        resolve = settle;
      });
    render();
    let submission!: Promise<void>;
    act(() => {
      submission = current.submit("value");
    });

    options = { ...options, resultOwner: { ...submittedOwner, frameId: 12 } };
    render();
    await act(async () => {
      resolve({ name: "value", value: "captured", variablesReference: 0 });
      await submission;
    });

    expect(current.state.entries.find((entry) => entry.kind === "result")?.resultOwner).toEqual({
      ...submittedOwner,
      epoch: 1,
    });
  });

  it("keeps manual REPL submission side-effect capable and invokes its evaluator exactly once", async () => {
    options.evaluate = vi.fn().mockResolvedValue({
      name: "mutate()",
      value: "done",
      variablesReference: 0,
    });
    render();

    await act(async () => current.submit("mutate()"));

    expect(options.evaluate).toHaveBeenCalledOnce();
    expect(options.evaluate).toHaveBeenCalledWith("mutate()");
    expect(current.state.history).toEqual(["mutate()"]);
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["pending", "result"]);
  });

  it("cancels only the pending row when an upstream stale evaluation returns null", async () => {
    let resolve!: (value: DebugVariable | null) => void;
    options.output = [{ stream: "stdout", text: "before" }];
    options.evaluate = () =>
      new Promise<DebugVariable | null>((settle) => {
        resolve = settle;
      });
    render();
    let submission!: Promise<void>;
    act(() => {
      submission = current.submit("selectedFrameValue");
    });
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["stdout", "pending"]);
    expect(current.state.pendingRequestIds).toEqual(["repl-1"]);

    await act(async () => {
      resolve(null);
      await submission;
    });

    expect(current.state.entries).toHaveLength(1);
    expect(current.state.entries[0]).toMatchObject({ kind: "stdout", text: "before" });
    expect(current.state.pendingRequestIds).toEqual([]);
  });

  it("does not let a late evaluation repopulate entries cleared while it was pending", async () => {
    let resolve!: (value: DebugVariable) => void;
    options.evaluate = () =>
      new Promise<DebugVariable>((settle) => {
        resolve = settle;
      });
    render();
    let submission!: Promise<void>;
    act(() => {
      submission = current.submit("slow()");
    });
    expect(current.state.pendingRequestIds).toEqual(["repl-1"]);

    act(() => current.clear());
    expect(current.state.entries).toEqual([]);
    expect(current.state.pendingRequestIds).toEqual([]);

    await act(async () => {
      resolve({ name: "slow()", value: "late", variablesReference: 0 });
      await submission;
    });
    expect(current.state.entries).toEqual([]);
  });

  it("preserves expression history and admits future process output after clear", async () => {
    const first = { stream: "stdout" as const, text: "before clear" };
    options.output = [first];
    options.evaluate = vi.fn().mockResolvedValue({
      name: "count",
      value: "1",
      variablesReference: 0,
    });
    render();
    await act(async () => current.submit("count"));
    expect(current.state.history).toEqual(["count"]);

    act(() => current.clear());
    expect(current.state.entries).toEqual([]);
    expect(current.state.history).toEqual(["count"]);

    options = {
      ...options,
      output: [first, { stream: "stdout", text: "after clear" }],
    };
    render();
    expect(current.state.entries).toHaveLength(1);
    expect(current.state.entries[0]).toMatchObject({ kind: "stdout", text: "after clear" });
    expect(current.state.history).toEqual(["count"]);
  });

  it("preserves the last session snapshot while dropping late pause-generation results", async () => {
    let resolve!: (value: DebugVariable) => void;
    options.evaluate = () =>
      new Promise<DebugVariable>((settle) => {
        resolve = settle;
      });
    options.output = [{ stream: "stdout", text: "ready" }];
    render();
    let submission!: Promise<void>;
    act(() => {
      submission = current.submit("slow()");
    });

    options = { ...options, owner: { sessionId: 7, pauseGeneration: 2 } };
    render();
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["stdout", "pending"]);
    expect(current.state.pendingRequestIds).toEqual([]);

    await act(async () => {
      resolve({ name: "slow()", value: "stale", variablesReference: 0 });
      await submission;
    });
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["stdout", "pending"]);
  });

  it("cleans the old snapshot and consumes the full output of a replacement session", () => {
    const oldLine = { stream: "stdout" as const, text: "old" };
    options.output = [oldLine];
    render();

    options = {
      ...options,
      owner: { sessionId: 8, pauseGeneration: 1 },
      output: [
        { stream: "stdout", text: "new one" },
        { stream: "stderr", text: "new two" },
      ],
    };
    render();
    expect(current.state.entries.map((entry) => entry.kind)).toEqual(["stdout", "stderr"]);
    expect(current.state.entries.map((entry) => ("text" in entry ? entry.text : ""))).toEqual([
      "new one",
      "new two",
    ]);
  });

  it("bounds root cleanup to one snapshot and rehydrates output after returning", () => {
    const line = { stream: "stdout" as const, text: "session output" };
    options.output = [line];
    render();
    expect(current.state.entries).toHaveLength(1);

    options = { ...options, owner: null, output: [] };
    render();
    expect(current.state.entries).toEqual([]);

    options = {
      ...options,
      owner: { sessionId: 7, pauseGeneration: 2 },
      output: [line],
    };
    render();
    expect(current.state.entries).toHaveLength(1);
    expect(current.state.entries[0]).toMatchObject({ kind: "stdout", text: "session output" });
  });
});
