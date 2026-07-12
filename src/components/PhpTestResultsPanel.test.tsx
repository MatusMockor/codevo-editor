// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhpTestRunOk } from "../domain/phpTestResults";
import { PhpTestResultsPanel } from "./PhpTestResultsPanel";

describe("PhpTestResultsPanel", () => {
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

  it.each([
    [{ isRunning: true }, "Running PHP tests"],
    [
      { unavailable: "Trust this workspace to run PHP tests." },
      "Trust this workspace",
    ],
    [{ error: "phpunit failed" }, "phpunit failed"],
    [{ result: null }, "Run PHP tests to see results"],
  ])("renders truthful state %#", async (overrides, message) => {
    await render(overrides);
    expect(host.textContent).toContain(message);
  });

  it("renders totals, suite badges, cases, and full failure message metadata", async () => {
    await render();

    expect(host.textContent).toContain("6,000 tests · 2 failed · 1 skipped");
    expect(host.textContent).toContain("failed");
    expect(host.textContent).toContain("testItWorks");
    expect(
      host
        .querySelector('[data-testid="php-test-message"]')
        ?.getAttribute("title"),
    ).toBe("Expected true to be false\nStack trace");
  });

  it("only navigates failed or error cases with files", async () => {
    const onOpenCase = vi.fn();
    await render({ onOpenCase });
    const rows = Array.from(host.querySelectorAll("[data-testid='php-test-case']"));

    await act(async () => {
      rows.forEach((row) =>
        row.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
    });

    expect(onOpenCase).toHaveBeenCalledTimes(1);
    expect(onOpenCase).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "tests/Unit/FooTest.php",
        status: "failed",
      }),
    );
    expect(rows[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("disables re-run while running", async () => {
    const onRun = vi.fn();
    await render({ isRunning: true, onRun });
    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="Run PHP tests"]',
    );

    button?.click();

    expect(button?.disabled).toBe(true);
    expect(onRun).not.toHaveBeenCalled();
  });

  async function render(
    overrides: Partial<Parameters<typeof PhpTestResultsPanel>[0]> = {},
  ) {
    await act(async () => {
      root.render(
        <PhpTestResultsPanel
          error={overrides.error ?? null}
          isRunning={overrides.isRunning ?? false}
          onOpenCase={overrides.onOpenCase ?? vi.fn()}
          onRun={overrides.onRun ?? vi.fn()}
          result={overrides.result === undefined ? result() : overrides.result}
          rootPath={overrides.rootPath ?? "/workspace"}
          unavailable={overrides.unavailable ?? null}
        />,
      );
      await Promise.resolve();
    });
  }
});

function result(): PhpTestRunOk {
  return {
    status: "ok",
    suites: [
      {
        cases: [
          {
            classname: "Tests\\Unit\\FooTest",
            file: "tests/Unit/FooTest.php",
            line: 12,
            message: "Expected true to be false\nStack trace",
            name: "testItWorks",
            status: "failed",
            time: 0.02,
          },
          {
            classname: "Tests\\Unit\\FooTest",
            file: "tests/Unit/FooTest.php",
            line: 20,
            message: null,
            name: "testPasses",
            status: "passed",
            time: 0.01,
          },
        ],
        errors: 0,
        failures: 2,
        name: "Unit",
        skipped: 1,
        tests: 6000,
        time: 2.5,
      },
    ],
    totals: { errors: 0, failures: 2, skipped: 1, tests: 6000, time: 2.5 },
  };
}
