// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeObservabilityPanel } from "./RuntimeObservabilityPanel";
import type {
  RuntimeObservabilityGateway,
  RuntimeObservabilityReport,
} from "../domain/runtimeObservability";
import { createLatencyTracker } from "../domain/latencyTracker";

function gatewayReturning(report: RuntimeObservabilityReport) {
  return {
    getObservability: vi.fn(async () => report),
    restart: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    openLog: vi.fn(async () => null),
    subscribeStatus: vi.fn(async () => () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
  } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
    getObservability: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    copyToClipboard: ReturnType<typeof vi.fn>;
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function deferredReport() {
  return deferred<RuntimeObservabilityReport>();
}

const sampleReport: RuntimeObservabilityReport = {
  rootPath: "/workspace",
  runtimes: [
    {
      kind: "phpactor",
      label: "PHPactor",
      lifecycle: "running",
      pid: 4242,
      stats: { memoryKb: 81920, cpuPercent: 3.5 },
      recentRequests: [
        { method: "textDocument/completion", latencyMs: 42, success: true },
        { method: "textDocument/hover", latencyMs: 5000, success: false },
      ],
    },
    {
      kind: "tsserver",
      label: "TypeScript language server",
      lifecycle: "crashed",
      crashReason: "tsserver exited unexpectedly.",
      stderrTail: ["tsserver: segfault", "Stack trace line"],
    },
  ],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RuntimeObservabilityPanel", () => {
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
    vi.clearAllMocks();
  });

  function renderPanel(
    gateway: RuntimeObservabilityGateway,
    rootPath: string | null,
  ) {
    act(() => {
      root.render(
        <RuntimeObservabilityPanel
          gateway={gateway}
          isActive
          rootPath={rootPath}
        />,
      );
    });
  }

  it("renders each runtime with PID, state indicator and metrics", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    expect(gateway.getObservability).toHaveBeenCalledWith("/workspace");
    expect(host.textContent).toContain("PHPactor");
    expect(host.textContent).toContain("4242");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("Crashed");
    expect(host.textContent).toContain("tsserver exited unexpectedly.");

    expect(
      host
        .querySelector('[data-testid="runtime-indicator-phpactor"]')
        ?.getAttribute("data-tone"),
    ).toBe("ok");
    expect(
      host
        .querySelector('[data-testid="runtime-indicator-tsserver"]')
        ?.getAttribute("data-tone"),
    ).toBe("error");
  });

  it("restarts and stops the runtime through the gateway", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    const restartButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Restart PHPactor"]',
    );
    const stopButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Stop PHPactor"]',
    );

    expect(restartButton).not.toBeNull();
    expect(stopButton).not.toBeNull();

    await act(async () => {
      restartButton?.click();
      await Promise.resolve();
    });
    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    expect(gateway.restart).toHaveBeenCalledWith("/workspace", "phpactor");
    expect(gateway.stop).toHaveBeenCalledWith("/workspace", "phpactor");
  });

  it("opens logs for PHPactor and TypeScript runtimes", async () => {
    const gateway = {
      ...gatewayReturning(sampleReport),
      openLog: vi.fn(async () => "/tmp/runtime.log"),
    } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
      openLog: ReturnType<typeof vi.fn>;
    };

    renderPanel(gateway, "/workspace");
    await flush();

    const phpLogButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Open PHPactor log"]',
    );
    const tsLogButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Open TypeScript language server log"]',
    );

    expect(phpLogButton).not.toBeNull();
    expect(tsLogButton).not.toBeNull();

    await act(async () => {
      phpLogButton?.click();
      tsLogButton?.click();
      await Promise.resolve();
    });

    expect(gateway.openLog).toHaveBeenCalledWith("/workspace", "phpactor");
    expect(gateway.openLog).toHaveBeenCalledWith("/workspace", "tsserver");
  });

  it("shows optimistic stopping and stopped states during a stop request", async () => {
    const stop = deferred<void>();
    const gateway = {
      ...gatewayReturning(sampleReport),
      stop: vi.fn(async () => stop.promise),
    } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
      stop: ReturnType<typeof vi.fn>;
    };

    renderPanel(gateway, "/workspace");
    await flush();

    const stopButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Stop PHPactor"]',
    );

    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Stopping");
    expect(host.textContent).toContain("4242");

    await act(async () => {
      stop.resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Stopped");
    expect(host.textContent).not.toContain("4242");
  });

  it("copies the optimistic stopped state after a stop request completes", async () => {
    const stop = deferred<void>();
    const gateway = {
      ...gatewayReturning(sampleReport),
      stop: vi.fn(async () => stop.promise),
    } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
      copyToClipboard: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    };

    renderPanel(gateway, "/workspace");
    await flush();

    const stopButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Stop PHPactor"]',
    );

    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      stop.resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Copy debug bundle"]',
    );

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(gateway.copyToClipboard).toHaveBeenCalledTimes(1);
    const bundle = gateway.copyToClipboard.mock.calls[0][0] as string;
    expect(bundle).toContain("### PHPactor (phpactor)");
    expect(bundle).toContain("- State: Stopped");
    expect(bundle).toContain("- PID: -");
    expect(bundle).not.toContain("- State: Running");
    expect(bundle).not.toContain("- PID: 4242");
  });

  it("does not query the gateway without an active root", () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, null);

    expect(gateway.getObservability).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "Open a project to inspect its language runtimes.",
    );
  });

  it("drops stale runtime reports after switching project roots", async () => {
    const first = deferredReport();
    const second = deferredReport();
    const gateway = {
      getObservability: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      restart: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      openLog: vi.fn(async () => null),
      subscribeStatus: vi.fn(async () => () => undefined),
      copyToClipboard: vi.fn(async () => undefined),
    } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
      getObservability: ReturnType<typeof vi.fn>;
    };

    renderPanel(gateway, "/workspace-a");
    renderPanel(gateway, "/workspace-b");

    second.resolve({
      rootPath: "/workspace-b",
      runtimes: [
        {
          kind: "phpactor",
          label: "PHPactor B",
          lifecycle: "running",
          pid: 200,
        },
      ],
    });
    await flush();

    expect(host.textContent).toContain("PHPactor B");
    expect(host.textContent).toContain("200");

    first.resolve({
      rootPath: "/workspace-a",
      runtimes: [
        {
          kind: "phpactor",
          label: "PHPactor A",
          lifecycle: "running",
          pid: 100,
        },
      ],
    });
    await flush();

    expect(host.textContent).toContain("PHPactor B");
    expect(host.textContent).not.toContain("PHPactor A");
    expect(host.textContent).not.toContain("100");
  });

  it("renders recent LSP requests with latencies newest first", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    expect(host.textContent).toContain("textDocument/completion");
    expect(host.textContent).toContain("42 ms");
    expect(host.textContent).toContain("textDocument/hover");
    expect(host.textContent).toContain("5.00 s");
  });

  it("renders the stderr tail inline for a crashed runtime", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    expect(host.textContent).toContain("tsserver: segfault");
    expect(host.textContent).toContain("Stack trace line");
  });

  it("copies a markdown debug bundle to the clipboard", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    const copyButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Copy debug bundle"]',
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(gateway.copyToClipboard).toHaveBeenCalledTimes(1);
    const bundle = gateway.copyToClipboard.mock.calls[0][0] as string;
    expect(bundle).toContain("# Runtime debug bundle");
    expect(bundle).toContain("- Project: /workspace");
    expect(bundle).toContain("textDocument/hover — 5.00 s (error)");
    expect(bundle).toContain("tsserver: segfault");
  });

  it("does not render a copy button without runtimes", async () => {
    const gateway = gatewayReturning({ rootPath: "/workspace", runtimes: [] });

    renderPanel(gateway, "/workspace");
    await flush();

    expect(
      host.querySelector('[aria-label="Copy debug bundle"]'),
    ).toBeNull();
  });

  it("renders recorded operation latencies from the snapshot accessor", async () => {
    const gateway = gatewayReturning(sampleReport);
    const tracker = createLatencyTracker();
    tracker.record("quickOpen", 12);
    tracker.record("quickOpen", 18);
    tracker.record("definition", 300);

    act(() => {
      root.render(
        <RuntimeObservabilityPanel
          gateway={gateway}
          getLatencySnapshot={() => tracker.snapshot()}
          isActive
          rootPath="/workspace"
        />,
      );
    });
    await flush();

    expect(host.textContent).toContain("Operation latency");
    expect(host.textContent).toContain("Quick Open");
    expect(host.textContent).toContain("Go to Definition");

    // Quick Open median (15ms) is within budget -> ok tone.
    expect(
      host
        .querySelector('[data-testid="latency-row-quickOpen"]')
        ?.getAttribute("data-tone"),
    ).toBe("ok");

    // Definition median (300ms) blows the 200ms error budget -> error tone.
    expect(
      host
        .querySelector('[data-testid="latency-row-definition"]')
        ?.getAttribute("data-tone"),
    ).toBe("error");
  });

  it("shows an empty-state hint when no operations have been measured", async () => {
    const gateway = gatewayReturning(sampleReport);
    const tracker = createLatencyTracker();

    act(() => {
      root.render(
        <RuntimeObservabilityPanel
          gateway={gateway}
          getLatencySnapshot={() => tracker.snapshot()}
          isActive
          rootPath="/workspace"
        />,
      );
    });
    await flush();

    expect(host.textContent).toContain("No operations measured yet");
  });

  it("omits the latency section when no snapshot accessor is wired", async () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, "/workspace");
    await flush();

    expect(host.textContent).not.toContain("Operation latency");
  });
});
