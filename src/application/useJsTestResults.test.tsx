// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TestGateway, TestRunResponse } from "../domain/testResults";
import { useJsTestResults, type JsTestResultsState } from "./useJsTestResults";

function ok(name: string): TestRunResponse {
  return {
    status: "ok",
    suites: [
      {
        cases: [],
        errors: 0,
        failures: 0,
        name,
        skipped: 0,
        tests: 1,
        time: 0.1,
      },
    ],
    totals: { errors: 0, failures: 0, skipped: 0, tests: 1, time: 0.1 },
  };
}

function renderHook(gateway: TestGateway) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: JsTestResultsState | null } = { value: null };
  let props = {
    isOpen: false,
    rootPath: "/one" as string | null,
    runRequestVersion: 0,
    workspaceTrusted: true,
  };

  function Harness() {
    captured.value = useJsTestResults({ gateway, ...props });
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();

  return {
    hook: () => {
      if (!captured.value) {
        throw new Error("hook not mounted");
      }
      return captured.value;
    },
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useJsTestResults", () => {
  it("runs the JS test gateway on first open", async () => {
    const run = vi.fn<TestGateway["run"]>().mockResolvedValue(ok("sum"));
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledWith("/one", undefined);
    expect(harness.hook().suites[0].name).toBe("sum");
    harness.unmount();
  });

  it("reports the JavaScript trust message for an untrusted workspace", async () => {
    const run = vi.fn<TestGateway["run"]>();
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true, workspaceTrusted: false });
      await Promise.resolve();
    });

    expect(run).not.toHaveBeenCalled();
    expect(harness.hook().unavailable).toBe(
      "Trust this workspace to run JavaScript tests.",
    );
    harness.unmount();
  });

  it("keeps results isolated per workspace root", async () => {
    const run = vi
      .fn<TestGateway["run"]>()
      .mockImplementation(async (rootPath) => ok(rootPath));
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      harness.set({ rootPath: "/two" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.hook().suites[0].name).toBe("/two");

    await act(async () => {
      harness.set({ rootPath: "/one" });
      await Promise.resolve();
    });

    expect(harness.hook().suites[0].name).toBe("/one");
    expect(run).toHaveBeenCalledTimes(2);
    harness.unmount();
  });
});
