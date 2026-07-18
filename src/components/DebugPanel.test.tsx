// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Breakpoint, StackFrame } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { DebugPanel, type DebugPanelProps } from "./DebugPanel";

const FRAME_A: StackFrame = {
  frameId: 1,
  name: "main",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  column: 3,
};

const FRAME_B: StackFrame = {
  frameId: 2,
  name: "helper",
  filePath: null,
  lineNumber: 4,
  column: 1,
};

const BREAKPOINT: Breakpoint = {
  id: "bp-1",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  enabled: true,
};

function stoppedSnapshot(): DebuggerSessionSnapshot {
  return {
    state: {
      kind: "stopped",
      sessionId: 7,
      reason: "breakpoint",
      frames: [FRAME_A, FRAME_B],
      topFrame: FRAME_A,
    },
    lastSeq: 3,
  };
}

function defaultProps(): DebugPanelProps {
  return {
    breakpoints: [],
    evaluationHistory: [],
    lastStartError: null,
    onLoadVariables: vi.fn(),
    onEvaluate: vi.fn().mockResolvedValue(null),
    onNavigateToBreakpoint: vi.fn(),
    onNavigateToFrame: vi.fn(),
    onPause: vi.fn(),
    onRemoveBreakpoint: vi.fn(),
    onSelectFrame: vi.fn(),
    onSetBreakpointCondition: vi.fn(),
    onSetBreakpointEnabled: vi.fn(),
    onStep: vi.fn(),
    onStop: vi.fn(),
    output: [],
    rootPath: "/workspace",
    scopes: [],
    selectedFrameId: null,
    snapshot: { state: { kind: "inactive" }, lastSeq: 0 },
    variablesByReference: {},
    workspaceTrusted: true,
  };
}

describe("DebugPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(overrides: Partial<DebugPanelProps>) {
    const props = { ...defaultProps(), ...overrides };
    act(() => {
      root.render(<DebugPanel {...props} />);
    });

    return props;
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(element).not.toBeNull();

    return element as HTMLButtonElement;
  }

  it("disables all session controls while inactive and labels the state", () => {
    render({ snapshot: { state: { kind: "inactive" }, lastSeq: 0 } });

    for (const label of [
      "Continue",
      "Pause",
      "Step over",
      "Step into",
      "Step out",
      "Stop debugging",
    ]) {
      expect(button(label).disabled).toBe(true);
    }
    expect(
      host.querySelector('[data-testid="debug-status"]')?.textContent,
    ).toBe("Inactive");
  });

  it("enables pause and stop while running", () => {
    render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    expect(button("Pause").disabled).toBe(false);
    expect(button("Stop debugging").disabled).toBe(false);
    expect(button("Continue").disabled).toBe(true);
    expect(button("Step over").disabled).toBe(true);
    expect(
      host.querySelector('[data-testid="debug-status"]')?.textContent,
    ).toBe("Running");
  });

  it("enables stepping while stopped and reports the pause reason", () => {
    const props = render({ snapshot: stoppedSnapshot() });

    expect(button("Pause").disabled).toBe(true);
    expect(button("Stop debugging").disabled).toBe(false);

    for (const [label, kind] of [
      ["Continue", "continue"],
      ["Step over", "stepOver"],
      ["Step into", "stepInto"],
      ["Step out", "stepOut"],
    ] as const) {
      expect(button(label).disabled).toBe(false);
      act(() => button(label).click());
      expect(props.onStep).toHaveBeenCalledWith(kind);
    }

    act(() => button("Stop debugging").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector('[data-testid="debug-status"]')?.textContent,
    ).toBe("Paused (breakpoint)");
  });

  it("allows stopping while the session is starting", () => {
    const props = render({
      snapshot: { state: { kind: "starting", sessionId: 7 }, lastSeq: 0 },
    });

    expect(button("Stop debugging").disabled).toBe(false);
    expect(button("Continue").disabled).toBe(true);
    expect(button("Pause").disabled).toBe(true);
    expect(
      host.querySelector('[data-testid="debug-status"]')?.textContent,
    ).toBe("Starting");

    act(() => button("Stop debugging").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("pauses a running session", () => {
    const props = render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    act(() => button("Pause").click());

    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it("reports the exit code after termination and the last start error", () => {
    render({
      lastStartError: "node not found",
      snapshot: {
        state: { kind: "terminated", sessionId: 7, exitCode: 2 },
        lastSeq: 9,
      },
    });

    expect(
      host.querySelector('[data-testid="debug-status"]')?.textContent,
    ).toBe("Terminated (exit code 2)");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "node not found",
    );
  });

  it("lists stack frames, highlights the selection, and navigates on click", () => {
    const props = render({
      selectedFrameId: 2,
      snapshot: stoppedSnapshot(),
    });

    const frames = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="debug-frame"]',
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]?.textContent).toContain("main");
    expect(frames[0]?.textContent).toContain("src/index.ts:12");
    expect(frames[0]?.getAttribute("aria-current")).toBeNull();
    expect(frames[1]?.getAttribute("aria-current")).toBe("true");

    act(() => frames[0]?.click());

    expect(props.onSelectFrame).toHaveBeenCalledWith(1);
    expect(props.onNavigateToFrame).toHaveBeenCalledWith(
      "/workspace/src/index.ts",
      12,
    );
  });

  it("falls back to highlighting the top frame and skips navigation without a file", () => {
    const props = render({ snapshot: stoppedSnapshot() });

    const frames = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="debug-frame"]',
    );
    expect(frames[0]?.getAttribute("aria-current")).toBe("true");

    act(() => frames[1]?.click());

    expect(props.onSelectFrame).toHaveBeenCalledWith(2);
    expect(props.onNavigateToFrame).not.toHaveBeenCalled();
  });

  it("expands scopes lazily and renders loaded variables with their types", () => {
    const props = render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {},
    });

    const scope = host.querySelector<HTMLButtonElement>(
      '[data-testid="debug-scope"]',
    );
    expect(scope?.textContent).toContain("Local");

    act(() => scope?.click());
    expect(props.onLoadVariables).toHaveBeenCalledWith(10);

    render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [
          { name: "count", value: "3", type: "number", variablesReference: 0 },
          { name: "user", value: "Object", variablesReference: 11 },
        ],
      },
    });

    const variables = host.querySelectorAll('[data-testid="debug-variable"]');
    expect(variables[0]?.textContent).toContain("count");
    expect(variables[0]?.textContent).toContain("3");
    expect(variables[0]?.textContent).toContain("number");
  });

  it("expands nested variables lazily", () => {
    const props = render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [{ name: "user", value: "Object", variablesReference: 11 }],
      },
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')
        ?.click();
    });
    act(() => button("Expand user").click());

    expect(props.onLoadVariables).toHaveBeenCalledWith(11);
  });

  it("renders a cyclic variable reference without recursing", () => {
    render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [{ name: "self", value: "Object", variablesReference: 10 }],
      },
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')
        ?.click();
    });

    const variables = host.querySelectorAll('[data-testid="debug-variable"]');
    expect(variables).toHaveLength(1);
    expect(variables[0]?.textContent).toContain("self");
    expect(host.querySelector('button[aria-label="Expand self"]')).toBeNull();
  });

  it("stops offering expansion beyond the depth cap", () => {
    const variablesByReference: Record<
      number,
      { name: string; value: string; variablesReference: number }[]
    > = {};
    for (let level = 0; level < 15; level += 1) {
      variablesByReference[100 + level] = [
        {
          name: `v${level + 1}`,
          value: "Object",
          variablesReference: 101 + level,
        },
      ];
    }

    render({
      scopes: [{ name: "Local", variablesReference: 100, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference,
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')
        ?.click();
    });

    for (let level = 1; level < 10; level += 1) {
      act(() => button(`Expand v${level}`).click());
    }

    expect(host.querySelector('button[aria-label="Expand v10"]')).toBeNull();
  });

  it("manages breakpoints from the list", () => {
    const props = render({ breakpoints: [BREAKPOINT] });

    const row = host.querySelector('[data-testid="debug-breakpoint"]');
    expect(row?.textContent).toContain("src/index.ts:12");

    const checkbox = row?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox?.checked).toBe(true);
    act(() => checkbox?.click());
    expect(props.onSetBreakpointEnabled).toHaveBeenCalledWith("bp-1", false);

    act(() => {
      row
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="debug-breakpoint-location"]',
        )
        ?.click();
    });
    expect(props.onNavigateToBreakpoint).toHaveBeenCalledWith(BREAKPOINT);

    act(() => button("Remove breakpoint").click());
    expect(props.onRemoveBreakpoint).toHaveBeenCalledWith("bp-1");
  });

  it("commits breakpoint conditions on enter and clears blank ones on blur", () => {
    const props = render({ breakpoints: [BREAKPOINT] });

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Condition"]',
    );
    expect(input).not.toBeNull();

    act(() => {
      if (!input) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "count > 2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(props.onSetBreakpointCondition).toHaveBeenCalledWith(
      "bp-1",
      "count > 2",
    );

    const propsWithCondition = render({
      breakpoints: [{ ...BREAKPOINT, condition: "count > 2" }],
    });
    const conditionedInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="Condition"]',
    );
    expect(conditionedInput?.value).toBe("count > 2");

    act(() => {
      if (!conditionedInput) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(conditionedInput, "   ");
      conditionedInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      conditionedInput?.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true }),
      );
    });
    expect(propsWithCondition.onSetBreakpointCondition).toHaveBeenCalledWith(
      "bp-1",
      null,
    );
  });

  it("renders console output with stderr marked and an empty state", () => {
    render({
      output: [
        { stream: "stdout", text: "listening" },
        { stream: "stderr", text: "boom" },
      ],
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    const lines = host.querySelectorAll('[data-testid="debug-output-line"]');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.getAttribute("data-stream")).toBe("stdout");
    expect(lines[1]?.getAttribute("data-stream")).toBe("stderr");
    expect(lines[1]?.textContent).toBe("boom");

    render({ output: [] });
    expect(
      host.querySelector('[data-testid="debug-output-empty"]')?.textContent,
    ).toBe("No output");
  });

  it("evaluates expressions while paused and keeps history isolated by session", async () => {
    const onEvaluate = vi.fn().mockResolvedValue({
      name: "count + 1",
      value: "42",
      type: "number",
      variablesReference: 0,
    });
    render({ onEvaluate, snapshot: stoppedSnapshot() });
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Debug expression"]',
    );
    expect(input?.disabled).toBe(false);

    await act(async () => {
      setInputValue(input, "count + 1");
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(onEvaluate).toHaveBeenCalledWith("count + 1");
    expect(
      host.querySelector('[data-testid="debug-evaluation"]')?.textContent,
    ).toContain("42 (number)");

    render({
      evaluationHistory: ["count + 1"],
      onEvaluate,
      snapshot: stoppedSnapshot(),
    });
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
    });
    expect(input?.value).toBe("count + 1");

    render({
      evaluationHistory: [],
      onEvaluate,
      snapshot: {
        lastSeq: 4,
        state: {
          kind: "stopped",
          sessionId: 8,
          reason: "breakpoint",
          frames: [FRAME_A, FRAME_B],
          topFrame: FRAME_A,
        },
      },
    });
    expect(input?.value).toBe("");
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
    });
    expect(input?.value).toBe("");
  });

  it("disables expression evaluation unless paused in a trusted workspace", () => {
    render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Debug expression"]',
      )?.disabled,
    ).toBe(true);

    render({ snapshot: stoppedSnapshot(), workspaceTrusted: false });
    expect(
      host.querySelector<HTMLInputElement>(
        'input[aria-label="Debug expression"]',
      )?.disabled,
    ).toBe(true);
  });

  it("renders evaluation errors and Escape clears the pending expression", async () => {
    const onEvaluate = vi.fn().mockRejectedValue(new Error("Invalid expression"));
    render({ onEvaluate, snapshot: stoppedSnapshot() });
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Debug expression"]',
    );

    await act(async () => {
      setInputValue(input, "broken(");
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(onEvaluate).toHaveBeenCalledWith("broken(");
    expect(
      host.querySelector('[data-testid="debug-evaluation"]')?.textContent,
    ).toContain("Invalid expression");

    act(() => {
      setInputValue(input, "temporary");
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(input?.value).toBe("");
    expect(onEvaluate).toHaveBeenCalledTimes(1);
  });

  it("keeps the console pinned to the bottom while the reader stays there", () => {
    render({ output: [{ stream: "stdout", text: "one" }] });

    const body = host.querySelector<HTMLDivElement>(
      '[data-testid="debug-console-body"]',
    );
    expect(body).not.toBeNull();
    mockScrollMetrics(body as HTMLDivElement, {
      clientHeight: 50,
      scrollHeight: 100,
      scrollTop: 50,
    });
    act(() => {
      body?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    render({
      output: [
        { stream: "stdout", text: "one" },
        { stream: "stdout", text: "two" },
      ],
    });

    expect(body?.scrollTop).toBe(100);
  });

  it("does not hijack the scroll position after the reader scrolls up", () => {
    render({ output: [{ stream: "stdout", text: "one" }] });

    const body = host.querySelector<HTMLDivElement>(
      '[data-testid="debug-console-body"]',
    );
    expect(body).not.toBeNull();
    mockScrollMetrics(body as HTMLDivElement, {
      clientHeight: 50,
      scrollHeight: 200,
      scrollTop: 0,
    });
    act(() => {
      body?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    render({
      output: [
        { stream: "stdout", text: "one" },
        { stream: "stdout", text: "two" },
      ],
    });

    expect(body?.scrollTop).toBe(0);
  });
});

function mockScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  let top = metrics.scrollTop;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
