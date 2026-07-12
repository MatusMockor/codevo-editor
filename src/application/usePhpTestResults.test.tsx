// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  PhpTestGateway,
  PhpTestRunResponse,
} from "../domain/phpTestResults";
import { usePhpTestResults, type PhpTestResultsState } from "./usePhpTestResults";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function ok(name: string): PhpTestRunResponse {
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

function renderHook(gateway: PhpTestGateway) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: PhpTestResultsState | null } = { value: null };
  let props = {
    isOpen: false,
    rootPath: "/one" as string | null,
    runRequestVersion: 0,
    workspaceTrusted: true,
  };

  function Harness() {
    captured.value = usePhpTestResults({ gateway, ...props });
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

describe("usePhpTestResults", () => {
  it("runs on first open and re-runs manually", async () => {
    const run = vi
      .fn<PhpTestGateway["run"]>()
      .mockResolvedValueOnce(ok("first"))
      .mockResolvedValueOnce(ok("second"));
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => harness.hook().run());

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, "/one", undefined);
    expect(run).toHaveBeenNthCalledWith(2, "/one", undefined);
    expect(harness.hook().result?.status).toBe("ok");
    expect(harness.hook().suites[0].name).toBe("second");
    harness.unmount();
  });

  it("re-runs one valid failed case and replaces the root result", async () => {
    const run = vi
      .fn<PhpTestGateway["run"]>()
      .mockResolvedValueOnce(ok("suite"))
      .mockResolvedValueOnce(ok("single"))
      .mockResolvedValueOnce(ok("all"));
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () =>
      harness.hook().runCase({
        classname: "Tests\\Unit\\FooTest",
        file: "tests/Unit/FooTest.php",
        line: 12,
        message: "failed",
        name: "testItWorks",
        status: "failed",
        time: 0.1,
      }),
    );

    expect(run).toHaveBeenLastCalledWith("/one", "testItWorks");
    expect(harness.hook().suites[0].name).toBe("single");
    expect(harness.hook().filter).toBe("testItWorks");

    await act(async () => harness.hook().run());

    expect(run).toHaveBeenLastCalledWith("/one", undefined);
    expect(harness.hook().filter).toBeNull();
    harness.unmount();
  });

  it("rejects invalid or non-failing cases without invoking the gateway", async () => {
    const run = vi.fn<PhpTestGateway["run"]>();
    const harness = renderHook({ run });

    await act(async () =>
      harness.hook().runCase({
        classname: null,
        file: null,
        line: null,
        message: null,
        name: "broken\u0000name",
        status: "failed",
        time: null,
      }),
    );

    expect(run).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not subscribe to a global test-case event", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const harness = renderHook({ run: vi.fn() });

    expect(addEventListener).not.toHaveBeenCalledWith(
      "mockor:run-php-test-case",
      expect.any(Function),
    );
    harness.unmount();
    addEventListener.mockRestore();
  });

  it("re-runs cached results when the palette requests a run", async () => {
    const run = vi
      .fn<PhpTestGateway["run"]>()
      .mockResolvedValueOnce(ok("cached"))
      .mockResolvedValueOnce(ok("palette"));
    const harness = renderHook({ run });

    await act(async () => {
      harness.set({ isOpen: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      harness.set({ runRequestVersion: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(harness.hook().suites[0].name).toBe("palette");
    harness.unmount();
  });

  it("guards concurrent runs per root", async () => {
    const pending = deferred<PhpTestRunResponse>();
    const run = vi.fn<PhpTestGateway["run"]>(() => pending.promise);
    const harness = renderHook({ run });

    let second!: Promise<void>;
    act(() => {
      const first = harness.hook().run();
      second = harness.hook().run();
      void first;
    });

    expect(run).toHaveBeenCalledOnce();
    await expect(second).resolves.toBeUndefined();
    await act(async () => pending.resolve(ok("done")));
    harness.unmount();
  });

  it("keeps running and landed results isolated by requested root", async () => {
    const first = deferred<PhpTestRunResponse>();
    const second = deferred<PhpTestRunResponse>();
    const run = vi
      .fn<PhpTestGateway["run"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = renderHook({ run });

    act(() => harness.set({ isOpen: true }));
    expect(harness.hook().isRunning).toBe(true);
    act(() => harness.set({ rootPath: "/two" }));
    expect(harness.hook().isRunning).toBe(true);
    await act(async () => second.resolve(ok("two")));
    expect(harness.hook().isRunning).toBe(false);
    await act(async () => first.resolve(ok("one")));
    act(() => harness.set({ rootPath: "/one" }));

    expect(harness.hook().isRunning).toBe(false);
    expect(harness.hook().suites[0].name).toBe("one");
    harness.unmount();
  });

  it("shows the trust response without invoking the backend", async () => {
    const run = vi.fn<PhpTestGateway["run"]>();
    const harness = renderHook({ run });

    await act(async () => harness.set({ isOpen: true, workspaceTrusted: false }));

    expect(run).not.toHaveBeenCalled();
    expect(harness.hook().unavailable).toBe(
      "Trust this workspace to run PHP tests.",
    );
    harness.unmount();
  });
});
