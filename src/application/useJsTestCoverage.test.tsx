// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsTestCoverageGateway, JsTestCoverageResponse } from "../domain/jsTestCoverage";
import { useJsTestCoverage } from "./useJsTestCoverage";

describe("useJsTestCoverage", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useJsTestCoverage>;

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

  it("runs explicitly and stores a report per workspace", async () => {
    const gateway = createGateway();
    let switchOwner!: () => void;
    await render(gateway, (owner) => {
      switchOwner = owner;
    });
    await act(async () => void (await latest.run()));
    expect(gateway.run).toHaveBeenCalledWith("/workspace-1", {
      packageRootRelativePath: "",
    });
    expect(latest.report?.summary.percentage).toBe(75);

    await act(async () => switchOwner());
    expect(latest.report).toBeNull();
    await act(async () => void (await latest.run()));
    expect(gateway.run).toHaveBeenLastCalledWith("/workspace-2", {
      packageRootRelativePath: "",
    });
    await act(async () => switchOwner());
    expect(latest.report?.summary.percentage).toBe(75);
  });

  it("trust-gates execution and clears the banner after trust is granted", async () => {
    const gateway = createGateway();
    let trust!: () => void;
    await render(
      gateway,
      undefined,
      (grant) => {
        trust = grant;
      },
      false,
    );
    let result!: boolean;
    await act(async () => {
      result = await latest.run();
    });
    expect(result).toBe(false);
    expect(gateway.run).not.toHaveBeenCalled();
    expect(latest.unavailable).toContain("Trust this workspace");
    await act(async () => trust());
    expect(latest.unavailable).toBeNull();
  });

  it("rejects duplicate runs while one is in flight", async () => {
    let release!: (value: ReturnType<typeof okResponse>) => void;
    const gateway: JsTestCoverageGateway = {
      run: vi.fn(
        () =>
          new Promise<JsTestCoverageResponse>((resolve) => {
            release = resolve;
          }),
      ),
    };
    await render(gateway);
    let first!: Promise<boolean>;
    await act(async () => {
      first = latest.run();
      await Promise.resolve();
    });
    expect(latest.isRunning).toBe(true);
    expect(await latest.run()).toBe(false);
    expect(gateway.run).toHaveBeenCalledOnce();
    await act(async () => release(okResponse()));
    expect(await first).toBe(true);
  });

  it("drops a result after leaving a workspace even when returning before it settles", async () => {
    let release!: (value: ReturnType<typeof okResponse>) => void;
    const gateway: JsTestCoverageGateway = {
      run: vi.fn(
        () =>
          new Promise<JsTestCoverageResponse>((resolve) => {
            release = resolve;
          }),
      ),
    };
    let switchOwner!: () => void;
    await render(gateway, (owner) => {
      switchOwner = owner;
    });
    act(() => {
      void latest.run();
    });
    await act(async () => switchOwner());
    await act(async () => switchOwner());
    expect(latest.isRunning).toBe(true);
    await act(async () => release(okResponse()));
    expect(latest.report).toBeNull();
    expect(latest.isRunning).toBe(false);
  });

  it("clear invalidates an in-flight result but stays busy until retry is possible", async () => {
    let release!: (value: ReturnType<typeof okResponse>) => void;
    const gateway: JsTestCoverageGateway = {
      run: vi
        .fn<JsTestCoverageGateway["run"]>()
        .mockImplementationOnce(
          () =>
            new Promise<JsTestCoverageResponse>((resolve) => {
              release = resolve;
            }),
        )
        .mockResolvedValue(okResponse()),
    };
    await render(gateway);
    let first!: Promise<boolean>;
    await act(async () => {
      first = latest.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => latest.clear());
    expect(latest.isRunning).toBe(true);
    expect(await latest.run()).toBe(false);
    expect(gateway.run).toHaveBeenCalledOnce();
    await act(async () => {
      release(okResponse());
      await first;
    });
    expect(latest.report).toBeNull();
    expect(latest.isRunning).toBe(false);
    await act(async () => void (await latest.run()));
    expect(gateway.run).toHaveBeenCalledTimes(2);
    expect(latest.report).not.toBeNull();
  });

  it("stays busy through a trust flip until the stale request settles", async () => {
    let release!: (value: ReturnType<typeof okResponse>) => void;
    const gateway: JsTestCoverageGateway = {
      run: vi
        .fn<JsTestCoverageGateway["run"]>()
        .mockImplementationOnce(
          () =>
            new Promise<JsTestCoverageResponse>((resolve) => {
              release = resolve;
            }),
        )
        .mockResolvedValue(okResponse()),
    };
    let setTrusted!: (trusted: boolean) => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          initialTrusted
          onReady={(model, _switchOwner, _grantTrust, updateTrust) => {
            latest = model;
            setTrusted = updateTrust;
          }}
        />,
      );
    });
    let first!: Promise<boolean>;
    act(() => {
      first = latest.run();
    });
    await act(async () => setTrusted(false));
    expect(latest.isRunning).toBe(true);
    expect(latest.unavailable).toContain("Trust this workspace");

    await act(async () => setTrusted(true));
    expect(latest.isRunning).toBe(true);
    expect(latest.unavailable).toBeNull();
    expect(await latest.run()).toBe(false);
    expect(gateway.run).toHaveBeenCalledOnce();

    await act(async () => {
      release(okResponse());
      await first;
    });
    expect(latest.report).toBeNull();
    expect(latest.isRunning).toBe(false);

    await act(async () => void (await latest.run()));
    expect(gateway.run).toHaveBeenCalledTimes(2);
    expect(latest.report).not.toBeNull();
  });

  it("clears a report on source invalidation and drops an in-flight stale response", async () => {
    let release!: (value: ReturnType<typeof okResponse>) => void;
    const gateway: JsTestCoverageGateway = {
      run: vi
        .fn<JsTestCoverageGateway["run"]>()
        .mockResolvedValueOnce(okResponse())
        .mockImplementationOnce(
          () =>
            new Promise<JsTestCoverageResponse>((resolve) => {
              release = resolve;
            }),
        )
        .mockResolvedValue(okResponse()),
    };
    let bumpInvalidationVersion!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          initialTrusted
          onReady={(model, _switchOwner, _grantTrust, _setTrusted, invalidate) => {
            latest = model;
            bumpInvalidationVersion = invalidate;
          }}
        />,
      );
    });
    await act(async () => void (await latest.run()));
    expect(latest.report).not.toBeNull();

    let staleRun!: Promise<boolean>;
    act(() => {
      staleRun = latest.run();
    });
    await act(async () => bumpInvalidationVersion());
    expect(latest.report).toBeNull();
    expect(latest.isRunning).toBe(true);
    await act(async () => {
      release(okResponse());
      await staleRun;
    });
    expect(latest.report).toBeNull();
    expect(latest.isRunning).toBe(false);

    await act(async () => void (await latest.run()));
    expect(latest.report).not.toBeNull();
    expect(gateway.run).toHaveBeenCalledTimes(3);
  });

  it.each([
    { response: { status: "unavailable" as const, message: "No runner" }, field: "unavailable" },
    { response: { status: "error" as const, message: "Coverage failed" }, field: "error" },
  ])(
    "surfaces tagged $field responses without discarding the last report",
    async ({ response, field }) => {
      const gateway = createGateway();
      await render(gateway);
      await act(async () => void (await latest.run()));
      vi.mocked(gateway.run).mockResolvedValueOnce(response);
      await act(async () => void (await latest.run()));
      expect(latest.report).not.toBeNull();
      expect(latest[field as "error" | "unavailable"]).toBe(response.message);
    },
  );

  async function render(
    gateway: JsTestCoverageGateway,
    ownerReady?: (switchOwner: () => void) => void,
    trustReady?: (grantTrust: () => void) => void,
    trusted = true,
  ) {
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          initialTrusted={trusted}
          onReady={(model, switchOwner, grantTrust) => {
            latest = model;
            ownerReady?.(switchOwner);
            trustReady?.(grantTrust);
          }}
        />,
      );
    });
  }
});

function Harness({
  gateway,
  initialTrusted,
  onReady,
}: {
  gateway: JsTestCoverageGateway;
  initialTrusted: boolean;
  onReady: (
    model: ReturnType<typeof useJsTestCoverage>,
    switchOwner: () => void,
    grantTrust: () => void,
    setTrusted: (trusted: boolean) => void,
    bumpInvalidationVersion: () => void,
  ) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [trusted, setTrusted] = useState(initialTrusted);
  const [invalidationVersion, setInvalidationVersion] = useState(0);
  const model = useJsTestCoverage({
    gateway,
    invalidationVersion,
    rootPath: `/workspace-${owner}`,
    workspaceId: `workspace-${owner}`,
    workspaceTrusted: trusted,
  });
  onReady(
    model,
    () => setOwner((value) => (value === 1 ? 2 : 1)),
    () => setTrusted(true),
    setTrusted,
    () => setInvalidationVersion((value) => value + 1),
  );
  return null;
}

function createGateway(): JsTestCoverageGateway {
  return { run: vi.fn(async () => okResponse()) };
}

function okResponse() {
  return {
    status: "ok" as const,
    report: {
      files: [
        {
          firstUncoveredLine: 8,
          lines: [{ hits: 0, lineNumber: 8 }],
          path: "src/a.ts",
          summary: { covered: 3, percentage: 75, total: 4 },
          branches: { covered: 0, percentage: null, total: 0 },
          functions: { covered: 0, percentage: null, total: 0 },
        },
      ],
      summary: { covered: 3, percentage: 75, total: 4 },
      branches: { covered: 0, percentage: null, total: 0 },
      functions: { covered: 0, percentage: null, total: 0 },
      truncated: false,
    },
  };
}
