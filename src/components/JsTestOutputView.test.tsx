// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsTestTaskOutput } from "../domain/jsTestTask";
import { JsTestOutputView } from "./JsTestOutputView";

describe("JsTestOutputView", () => {
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

  it("renders separate plain-text streams, focuses the non-live log, and reports truncation", () => {
    render({
      stderr: { text: "<script>window.__testOutputExecuted = true</script>\n", truncated: true },
      stdout: { text: "\u001b[32mraw output\u001b[0m\n", truncated: true },
    });

    const log = host.querySelector<HTMLElement>('[role="log"]');
    expect(log?.getAttribute("aria-live")).toBeNull();
    expect(log?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(log);
    expect(host.querySelector('[data-testid="js-test-output-stdout"]')?.textContent).toContain(
      "\u001b[32mraw output\u001b[0m",
    );
    expect(host.querySelector('[data-testid="js-test-output-stderr"]')?.textContent).toContain(
      "<script>window.__testOutputExecuted = true</script>",
    );
    expect(host.textContent).toContain("Standard output was truncated.");
    expect(host.textContent).toContain("Standard error was truncated.");
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("reports truncation even when a truncated stream contains no retained text", () => {
    render({
      stderr: { text: "", truncated: false },
      stdout: { text: "", truncated: true },
    });

    expect(host.textContent).toContain("Standard output was truncated.");
    expect(host.textContent).not.toContain("The test runner produced no output.");
  });

  it("shows the empty-run message and keeps Copy governed by capability", () => {
    render(emptyOutput(), { canCopyOutput: false });

    expect(host.textContent).toContain("The test runner produced no output.");
    expect(button("Copy JavaScript test output").disabled).toBe(true);
  });

  it.each([
    ["resolved failure", async () => false],
    ["rejection", async () => Promise.reject(new Error("clipboard unavailable"))],
  ])("announces copy %s without moving focus", async (_label, onCopyOutput) => {
    render(output(), { onCopyOutput });
    const copy = button("Copy JavaScript test output");
    copy.focus();

    await click(copy);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not copy JavaScript test output.",
    );
    expect(document.activeElement).toBe(copy);
  });

  it("announces successful copy politely", async () => {
    const onCopyOutput = vi.fn(async () => true);
    render(output(), { onCopyOutput });

    await click(button("Copy JavaScript test output"));

    expect(onCopyOutput).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "JavaScript test output copied.",
    );
  });

  it("closes on Escape and through the explicit button", async () => {
    const onClose = vi.fn();
    render(output(), { onClose });

    await act(async () => {
      host
        .querySelector<HTMLElement>('[role="log"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    await click(button("Close JavaScript test output"));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  function render(
    value: JsTestTaskOutput,
    overrides: Partial<{
      canCopyOutput: boolean;
      onClose: () => void;
      onCopyOutput: () => boolean | Promise<boolean>;
    }> = {},
  ) {
    act(() => {
      root.render(
        <JsTestOutputView
          canCopyOutput={overrides.canCopyOutput ?? true}
          id="test-output"
          onClose={overrides.onClose ?? vi.fn()}
          onCopyOutput={overrides.onCopyOutput ?? vi.fn(async () => true)}
          output={value}
        />,
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!element) throw new Error(`Button is missing: ${label}`);
    return element;
  }
});

function output(): JsTestTaskOutput {
  return {
    stderr: { text: "failure\n", truncated: false },
    stdout: { text: "ready\n", truncated: false },
  };
}

function emptyOutput(): JsTestTaskOutput {
  return {
    stderr: { text: "", truncated: false },
    stdout: { text: "", truncated: false },
  };
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
