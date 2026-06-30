// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeObservabilityPanel } from "./RuntimeObservabilityPanel";
import type {
  RuntimeObservabilityGateway,
  RuntimeObservabilityReport,
} from "../domain/runtimeObservability";

function gatewayReturning(report: RuntimeObservabilityReport) {
  return {
    getObservability: vi.fn(async () => report),
    restart: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    openLog: vi.fn(async () => null),
    subscribeStatus: vi.fn(async () => () => undefined),
  } satisfies RuntimeObservabilityGateway as RuntimeObservabilityGateway & {
    getObservability: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
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
    },
    {
      kind: "tsserver",
      label: "TypeScript language server",
      lifecycle: "crashed",
      crashReason: "tsserver exited unexpectedly.",
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

  it("does not query the gateway without an active root", () => {
    const gateway = gatewayReturning(sampleReport);

    renderPanel(gateway, null);

    expect(gateway.getObservability).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "Open a project to inspect its language runtimes.",
    );
  });
});
