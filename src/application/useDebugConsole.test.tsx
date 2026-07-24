// @vitest-environment jsdom

import { act, startTransition, Suspense } from "react";
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
  let suspendedRender: Promise<never> | null;
  let options: {
    evaluate(expression: string): Promise<DebugVariable | null>;
    output: readonly DebugOutputLine[];
    owner: DebugEvaluationOwner | null;
    resultOwner?: Omit<DebugConsoleResultOwner, "epoch"> | null;
    sessionId: number | null;
    workspaceRoot: string | null;
  };

  function Harness() {
    current = useDebugConsole(options);
    if (suspendedRender) throw suspendedRender;
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    host = document.createElement("div");
    root = createRoot(host);
    suspendedRender = null;
    options = {
      evaluate: vi.fn().mockResolvedValue(null),
      output: [],
      owner: { sessionId: 7, pauseGeneration: 1 },
      sessionId: 7,
      workspaceRoot: "/workspace/",
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

  it("does not duplicate retained output when a trimmed burst drops the previous cursor", () => {
    const retained = Array.from({ length: 5_000 }, (_, index) => ({
      stream: "stdout" as const,
      text: `retained-${index}`,
    }));
    options.output = retained;
    render();
    const sequenceAfterInitialOutput = current.state.nextSequence;

    const newLine = { stream: "stderr" as const, text: "new-after-trim" };
    options = {
      ...options,
      output: [...retained.slice(0, -1), newLine],
    };
    render();

    expect(current.state.nextSequence).toBe(sequenceAfterInitialOutput + 1);
    expect(current.state.entries[current.state.entries.length - 1]).toMatchObject({
      kind: "stderr",
      text: "new-after-trim",
    });
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

  it("carries the adapter evaluate name into the settled console result", async () => {
    options.evaluate = vi.fn().mockResolvedValue({
      name: "user",
      value: "User",
      type: "object",
      evaluateName: 'root["user"]',
      variablesReference: 9,
    });
    render();

    await act(async () => current.submit("user"));

    expect(current.state.entries.find((entry) => entry.kind === "result")).toMatchObject({
      kind: "result",
      evaluateName: 'root["user"]',
      value: "User",
      variablesReference: 9,
    });
  });

  it("keeps session output live after Continue removes the pause owner", () => {
    const beforeContinue = { stream: "stdout" as const, text: "before continue" };
    options.output = [beforeContinue];
    render();

    options = {
      ...options,
      owner: null,
      output: [
        beforeContinue,
        { stream: "stdout" as const, text: "server starting boot" },
        { stream: "stderr" as const, text: "watch notice" },
      ],
    };
    render();

    expect(current.state.owner).toEqual({ sessionId: 7, pauseGeneration: 0 });
    expect(current.state.entries.map((entry) => entry.kind)).toEqual([
      "stdout",
      "stdout",
      "stderr",
    ]);
    expect(current.state.entries.map((entry) => ("text" in entry ? entry.text : ""))).toEqual([
      "before continue",
      "server starting boot",
      "watch notice",
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

  it("persists history and reloads it for the same normalized workspace root", async () => {
    options.evaluate = vi.fn().mockResolvedValue({
      name: "count",
      value: "1",
      variablesReference: 0,
    });
    render();

    await act(async () => current.submit("count"));
    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace")).toBe('["count"]');

    act(() => root.unmount());
    root = createRoot(host);
    options = {
      ...options,
      owner: { sessionId: 8, pauseGeneration: 1 },
      sessionId: 8,
    };
    render();

    expect(current.state.history).toEqual(["count"]);
  });

  it("fails closed when persisted history is malformed", () => {
    window.localStorage.setItem("mockor.debug.consoleHistory./workspace", '{"history":"bad"}');

    render();

    expect(current.state.history).toEqual([]);
  });

  it("isolates persisted history across normalized workspace roots", async () => {
    options.workspaceRoot = "/workspace-a/";
    options.resultOwner = {
      frameId: 11,
      pauseGeneration: 1,
      rootKey: "/workspace-a/",
      sessionId: 7,
      workspaceOwnerKey: "workspace-owner-a",
    };
    options.evaluate = vi.fn().mockResolvedValue({
      name: "count",
      value: "1",
      variablesReference: 0,
    });
    render();
    await act(async () => current.submit("fromA"));

    options = {
      ...options,
      owner: { sessionId: 8, pauseGeneration: 1 },
      sessionId: 8,
      workspaceRoot: "/workspace-b/",
    };
    render();

    expect(current.state.history).toEqual([]);
    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace-a")).toBe(
      '["fromA"]',
    );
    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace-b")).toBeNull();
  });

  it("uses the current workspace root while a stale paused owner remains during a root switch", async () => {
    options.resultOwner = {
      frameId: 11,
      pauseGeneration: 1,
      rootKey: "/workspace",
      sessionId: 7,
      workspaceOwnerKey: "workspace-owner",
    };
    options.evaluate = vi.fn().mockResolvedValue({
      name: "value",
      value: "1",
      variablesReference: 0,
    });
    render();
    await act(async () => current.submit("fromA"));

    options = { ...options, workspaceRoot: "/workspace-b" };
    render();

    expect(current.state.history).toEqual([]);
    await act(async () => current.submit("duringBTransition"));

    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace")).toBe('["fromA"]');
    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace-b")).toBe(
      '["duringBTransition"]',
    );
  });

  it("does not persist under a root from an abandoned transition render", async () => {
    options.evaluate = vi.fn().mockResolvedValue({
      name: "value",
      value: "1",
      variablesReference: 0,
    });
    render();
    const submitFromCommittedRoot = current.submit;
    options = { ...options, workspaceRoot: "/workspace-b" };
    suspendedRender = new Promise<never>(() => undefined);

    act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={null}>
            <Harness />
          </Suspense>,
        );
      });
    });
    await act(async () => submitFromCommittedRoot("fromCommittedA"));

    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace")).toBe(
      '["fromCommittedA"]',
    );
    expect(window.localStorage.getItem("mockor.debug.consoleHistory./workspace-b")).toBeNull();
    suspendedRender = null;
  });

  it("loads workspace history without an active debug pause", () => {
    window.localStorage.setItem("mockor.debug.consoleHistory./workspace", '["fromPreviousAppRun"]');
    options = {
      ...options,
      owner: null,
      resultOwner: null,
      sessionId: null,
    };

    render();

    expect(current.state.history).toEqual(["fromPreviousAppRun"]);
  });

  it("keeps persisted history through a same-root session replacement", async () => {
    options.evaluate = vi.fn().mockResolvedValue({
      name: "count",
      value: "1",
      variablesReference: 0,
    });
    render();
    await act(async () => current.submit("count"));

    options = {
      ...options,
      owner: { sessionId: 8, pauseGeneration: 1 },
      sessionId: 8,
    };
    render();

    expect(current.state.history).toEqual(["count"]);
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
      sessionId: 8,
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

    options = { ...options, owner: null, output: [], sessionId: null };
    render();
    expect(current.state.entries).toEqual([]);

    options = {
      ...options,
      owner: { sessionId: 7, pauseGeneration: 2 },
      output: [line],
      sessionId: 7,
    };
    render();
    expect(current.state.entries).toHaveLength(1);
    expect(current.state.entries[0]).toMatchObject({ kind: "stdout", text: "session output" });
  });
});
