// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  MAX_PHP_CLOVER_REPORT_BYTES,
  usePhpCloverCoverage,
  type PhpCloverCoveragePort,
  type PhpCloverCoveragePortResult,
  type PhpCloverCoverageState,
  type UsePhpCloverCoverageOptions,
} from "./usePhpCloverCoverage";

const OWNER_A = createWorkspaceRuntimeOwner("workspace-a", "/workspace-a");
const OWNER_B = createWorkspaceRuntimeOwner("workspace-b", "/workspace-b");
const REPORT = `<?xml version="1.0"?>
<coverage><project name="app"><file name="/workspace-a/src/A.php">
<line num="1" type="stmt" count="2"/><line num="2" type="method" count="0"/>
</file></project></coverage>`;

describe("usePhpCloverCoverage", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: PhpCloverCoverageState;
  let options: UsePhpCloverCoverageOptions;
  let port: PhpCloverCoveragePort;
  let currentOwner = OWNER_A;

  beforeEach(() => {
    currentOwner = OWNER_A;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    port = {
      runAndReadReport: vi.fn(async () => ({ status: "ok" as const, content: REPORT })),
    };
    options = {
      invalidationVersion: 1,
      isWorkspaceCurrent: (owner) => owner === currentOwner,
      port,
      workspaceOwner: OWNER_A,
      workspaceTrusted: true,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("runs the exact owner-bound port and strictly publishes parsed Clover coverage", async () => {
    render();
    expect(latest.canRun()).toBe(true);

    await act(async () => expect(await latest.run()).toBe(true));

    expect(port.runAndReadReport).toHaveBeenCalledExactlyOnceWith({
      invalidationVersion: 1,
      maxBytes: MAX_PHP_CLOVER_REPORT_BYTES,
      owner: OWNER_A,
    });
    expect(Object.isFrozen(vi.mocked(port.runAndReadReport).mock.calls[0]![0])).toBe(true);
    expect(latest.report).toEqual({
      files: [
        {
          firstUncoveredLine: 2,
          lines: [
            { hits: 2, lineNumber: 1 },
            { hits: 0, lineNumber: 2 },
          ],
          path: "src/A.php",
          summary: { covered: 1, percentage: 50, total: 2 },
        },
      ],
      summary: { covered: 1, percentage: 50, total: 2 },
    });
    expect(latest.error).toBeNull();
  });

  it.each([
    ["missing", { status: "missing" }],
    ["too large", { status: "tooLarge" }],
    ["unavailable", { status: "unavailable" }],
    ["dishonest oversized", { status: "ok", content: "x".repeat(MAX_PHP_CLOVER_REPORT_BYTES + 1) }],
    ["malformed", { status: "ok", content: "<coverage><project>" }],
  ] satisfies readonly (readonly [string, PhpCloverCoveragePortResult])[])(
    "fails closed for a %s report",
    async (_label, result) => {
      port = { runAndReadReport: vi.fn(async () => result) };
      options = { ...options, port };
      render();

      await act(async () => expect(await latest.run()).toBe(false));
      expect(latest.report).toBeNull();
      expect(latest.error ?? latest.unavailable).toBeTruthy();
    },
  );

  it.each([
    ["no owner", () => (options = { ...options, workspaceOwner: null })],
    ["untrusted", () => (options = { ...options, workspaceTrusted: false })],
    ["invalid revision", () => (options = { ...options, invalidationVersion: -1 })],
    [
      "relative root",
      () =>
        (options = {
          ...options,
          workspaceOwner: createWorkspaceRuntimeOwner("workspace", "relative/root"),
        }),
    ],
    ["stale owner", () => (currentOwner = OWNER_B)],
    [
      "throwing owner check",
      () =>
        (options = {
          ...options,
          isWorkspaceCurrent: () => {
            throw new Error("owner");
          },
        }),
    ],
  ])("rejects %s before calling the port", (_label, arrange) => {
    arrange();
    render();

    expect(latest.canRun()).toBe(false);
    expect(latest.run()).resolves.toBe(false);
    expect(port.runAndReadReport).not.toHaveBeenCalled();
  });

  it("enforces one flight and clear invalidates the active result", async () => {
    const pending = deferred<PhpCloverCoveragePortResult>();
    port = { runAndReadReport: vi.fn(() => pending.promise) };
    options = { ...options, port };
    render();
    let first!: Promise<boolean>;
    act(() => {
      first = latest.run();
    });

    await vi.waitFor(() => expect(port.runAndReadReport).toHaveBeenCalledOnce());
    expect(latest.canRun()).toBe(false);
    await expect(latest.run()).resolves.toBe(false);
    act(() => latest.clear());
    pending.resolve({ status: "ok", content: REPORT });
    await act(async () => expect(await first).toBe(false));
    expect(latest.report).toBeNull();
    expect(port.runAndReadReport).toHaveBeenCalledOnce();
  });

  it.each(["root", "id", "trust", "revision", "port"] as const)(
    "rejects stale %s A-B-A transitions while the port is pending",
    async (transition) => {
      const pending = deferred<PhpCloverCoveragePortResult>();
      const originalPort = { runAndReadReport: vi.fn(() => pending.promise) };
      options = { ...options, port: originalPort };
      render();
      let running!: Promise<boolean>;
      act(() => {
        running = latest.run();
      });

      if (transition === "root" || transition === "id") {
        const replacement =
          transition === "root"
            ? createWorkspaceRuntimeOwner("workspace-a", "/workspace-b")
            : createWorkspaceRuntimeOwner("workspace-b", "/workspace-a");
        currentOwner = replacement;
        options = { ...options, workspaceOwner: replacement };
        render();
        currentOwner = OWNER_A;
        options = { ...options, workspaceOwner: OWNER_A };
      } else if (transition === "trust") {
        options = { ...options, workspaceTrusted: false };
        render();
        options = { ...options, workspaceTrusted: true };
      } else if (transition === "revision") {
        options = { ...options, invalidationVersion: 2 };
        render();
        options = { ...options, invalidationVersion: 1 };
      } else {
        options = { ...options, port: { runAndReadReport: vi.fn(async () => resultOk()) } };
        render();
        options = { ...options, port: originalPort };
      }
      render();
      pending.resolve(resultOk());

      await act(async () => expect(await running).toBe(false));
      expect(latest.report).toBeNull();
      expect(latest.isRunning).toBe(false);
    },
  );

  it("rejects exact-owner A-B-A reads at admission", () => {
    const owners = [true, true, true, false, true];
    options = { ...options, isWorkspaceCurrent: () => owners.shift() ?? true };
    render();

    expect(latest.canRun()).toBe(false);
    expect(port.runAndReadReport).not.toHaveBeenCalled();
  });

  it("does not publish a report that settles after unmount", async () => {
    const pending = deferred<PhpCloverCoveragePortResult>();
    port = { runAndReadReport: vi.fn(() => pending.promise) };
    options = { ...options, port };
    render();
    const running = latest.run();

    act(() => root.unmount());
    pending.resolve(resultOk());
    await expect(running).resolves.toBe(false);
    root = createRoot(host);
  });

  it("clears a prior report while untrusted so it cannot reappear after trust A-B-A", async () => {
    render();
    await act(async () => expect(await latest.run()).toBe(true));
    expect(latest.report).not.toBeNull();

    options = { ...options, workspaceTrusted: false };
    render();
    act(() => latest.clear());
    options = { ...options, workspaceTrusted: true };
    render();

    expect(latest.report).toBeNull();
  });

  it("publishes unavailable separately from execution errors", async () => {
    port = { runAndReadReport: vi.fn(async () => ({ status: "unavailable" as const })) };
    options = { ...options, port };
    render();

    await act(async () => expect(await latest.run()).toBe(false));
    expect(latest.error).toBeNull();
    expect(latest.unavailable).toBe("PHP Clover coverage is unavailable.");
  });

  it("preserves a bounded port explanation for an unavailable runner", async () => {
    port = {
      runAndReadReport: vi.fn(async () => ({
        status: "unavailable" as const,
        message: "No supported PHP coverage driver is installed.",
      })),
    };
    options = { ...options, port };
    render();

    await act(async () => void (await latest.run()));

    expect(latest.error).toBeNull();
    expect(latest.unavailable).toBe("No supported PHP coverage driver is installed.");
  });

  it.each([
    [
      "synchronous",
      () => {
        throw new Error("sync");
      },
    ],
    ["asynchronous", async () => Promise.reject(new Error("async"))],
  ])("contains %s port failures", async (_label, runAndReadReport) => {
    port = { runAndReadReport };
    options = { ...options, port };
    render();

    await act(async () => expect(await latest.run()).toBe(false));
    expect(latest.error).toBe("PHP Clover coverage failed.");
  });

  function render(): void {
    act(() => {
      root.render(<Harness options={options} onReady={(state) => (latest = state)} />);
    });
  }
});

function Harness({
  onReady,
  options,
}: {
  readonly onReady: (state: PhpCloverCoverageState) => void;
  readonly options: UsePhpCloverCoverageOptions;
}) {
  onReady(usePhpCloverCoverage(options));
  return null;
}

function resultOk(): PhpCloverCoveragePortResult {
  return { status: "ok", content: REPORT };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
