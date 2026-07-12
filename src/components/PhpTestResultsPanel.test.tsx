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

  it("re-runs Pest-style failed cases from their row without opening them", async () => {
    const onOpenCase = vi.fn();
    const onRunCase = vi.fn();
    const testResult = result();
    testResult.suites[0].cases[0].name = "it does something useful";
    await render({ onOpenCase, onRunCase, result: testResult });
    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="Run it does something useful"]',
    );

    await act(async () => button?.click());

    expect(onRunCase).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "it does something useful",
        status: "failed",
      }),
    );
    expect(onOpenCase).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Run testPasses"]')).toBeNull();
  });

  it("shows filtered state with a run-all affordance", async () => {
    const onRun = vi.fn();
    const filter = "it renders a very long Pest description with punctuation!";
    await render({ filter, onRun });

    const badge = host.querySelector('[data-testid="php-test-filter"]');
    expect(badge?.textContent).toBe(`Filtered: ${filter}`);
    expect(badge?.getAttribute("title")).toBe(filter);
    expect((badge as HTMLElement | null)?.style.textOverflow).toBe("ellipsis");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Run all PHP tests"]')
        ?.click(),
    );
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("does not show filtered state for a full run", async () => {
    await render({ filter: null });

    expect(host.textContent).not.toContain("Filtered:");
    expect(
      host.querySelector('[aria-label="Run all PHP tests"]'),
    ).toBeNull();
  });

  it("sorts suites and cases failed first without mutating the result", async () => {
    const testResult = resultWithStatuses();
    const suiteOrder = testResult.suites.map((suite) => suite.name);
    const caseOrders = testResult.suites.map((suite) =>
      suite.cases.map((testCase) => testCase.name),
    );

    await render({ result: testResult });

    expect(renderedCaseNames()).toEqual([
      "error case",
      "failed case",
      "skipped in failed suite",
      "passed in failed suite",
      "skipped case",
      "passed case",
    ]);
    expect(renderedSuiteNames()).toEqual([
      "Failed suite",
      "Skipped suite",
      "Passed suite",
    ]);
    expect(testResult.suites.map((suite) => suite.name)).toEqual(suiteOrder);
    expect(
      testResult.suites.map((suite) =>
        suite.cases.map((testCase) => testCase.name),
      ),
    ).toEqual(caseOrders);
  });

  it("filters cases and empty suites while leaving the totals unchanged", async () => {
    await render({ result: resultWithStatuses() });

    await clickStatusChip("Failed");

    expect(renderedCaseNames()).toEqual(["error case", "failed case"]);
    expect(renderedSuiteNames()).toEqual(["Failed suite"]);
    expect(host.textContent).toContain("6 tests · 2 failed · 2 skipped");
  });

  it("resets the status filter when the result identity changes", async () => {
    const firstResult = resultWithStatuses();
    await render({ result: firstResult });
    await clickStatusChip("Skipped");
    expect(renderedCaseNames()).toEqual([
      "skipped in failed suite",
      "skipped case",
    ]);

    await render({ result: { ...firstResult } });

    expect(renderedCaseNames()).toHaveLength(6);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Show all tests"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it.each([
    ["Failed", "No failed tests"],
    ["Skipped", "No skipped tests"],
    ["Passed", "No passed tests"],
  ])("shows an empty filtered state for %s", async (chip, message) => {
    const testResult = result();
    testResult.suites[0].cases = [];
    await render({ result: testResult });

    await clickStatusChip(chip);

    expect(host.textContent).toContain(message);
    expect(renderedSuiteNames()).toEqual([]);
  });

  it("disables case reruns for invalid names and while running", async () => {
    const testResult = result();
    testResult.suites[0].cases[0].name = "has\ncontrol character";
    await render({ result: testResult });

    expect(findButton("Run has\ncontrol character")?.disabled).toBe(true);

    testResult.suites[0].cases[0].name = "testItWorks";
    await render({ isRunning: true, result: testResult });
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Run testItWorks"]')
        ?.disabled,
    ).toBe(true);
  });

  async function render(
    overrides: Partial<Parameters<typeof PhpTestResultsPanel>[0]> = {},
  ) {
    await act(async () => {
      root.render(
        <PhpTestResultsPanel
          error={overrides.error ?? null}
          filter={overrides.filter ?? null}
          isRunning={overrides.isRunning ?? false}
          onOpenCase={overrides.onOpenCase ?? vi.fn()}
          onRun={overrides.onRun ?? vi.fn()}
          onRunCase={overrides.onRunCase ?? vi.fn()}
          result={overrides.result === undefined ? result() : overrides.result}
          rootPath={overrides.rootPath ?? "/workspace"}
          unavailable={overrides.unavailable ?? null}
        />,
      );
      await Promise.resolve();
    });
  }

  async function clickStatusChip(label: string) {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          `[aria-label="Show ${label.toLowerCase()} tests"]`,
        )
        ?.click(),
    );
  }

  function renderedCaseNames() {
    return Array.from(
      host.querySelectorAll<HTMLElement>("[data-testid='php-test-case-name']"),
      (element) => element.textContent,
    );
  }

  function renderedSuiteNames() {
    return Array.from(
      host.querySelectorAll<HTMLElement>("[data-testid='php-test-suite-name']"),
      (element) => element.textContent,
    );
  }

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.getAttribute("aria-label") === label,
    );
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

function resultWithStatuses(): PhpTestRunOk {
  return {
    status: "ok",
    suites: [
      suite("Passed suite", [testCase("passed", "passed case")]),
      suite("Skipped suite", [testCase("skipped", "skipped case")]),
      suite("Failed suite", [
        testCase("passed", "passed in failed suite"),
        testCase("error", "error case"),
        testCase("skipped", "skipped in failed suite"),
        testCase("failed", "failed case"),
      ]),
    ],
    totals: { errors: 1, failures: 1, skipped: 2, tests: 6, time: 1 },
  };
}

function suite(
  name: string,
  cases: PhpTestRunOk["suites"][number]["cases"],
): PhpTestRunOk["suites"][number] {
  return {
    cases,
    errors: cases.filter((testCase) => testCase.status === "error").length,
    failures: cases.filter((testCase) => testCase.status === "failed").length,
    name,
    skipped: cases.filter((testCase) => testCase.status === "skipped").length,
    tests: cases.length,
    time: 1,
  };
}

function testCase(
  status: PhpTestRunOk["suites"][number]["cases"][number]["status"],
  name: string,
): PhpTestRunOk["suites"][number]["cases"][number] {
  return {
    classname: "Tests\\Unit\\StatusTest",
    file: "tests/Unit/StatusTest.php",
    line: 1,
    message: null,
    name,
    status,
    time: 0.01,
  };
}
