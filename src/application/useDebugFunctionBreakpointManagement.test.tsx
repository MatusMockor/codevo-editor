// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugGateway } from "../domain/debug";
import {
  useDebugFunctionBreakpointManagement,
  type DebugFunctionBreakpointManagement,
} from "./useDebugFunctionBreakpointManagement";

describe("useDebugFunctionBreakpointManagement", () => {
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

  it("keeps roots isolated and rechecks the exact owner after gateway awaits", async () => {
    let settle!: () => void;
    const setFunctionBreakpoints = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          settle = () => resolve([]);
        }),
    );
    const gateway = { setFunctionBreakpoints } as unknown as DebugGateway;
    let currentRoot = "/workspace/a";
    let currentWorkspaceId = "workspace-a";
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={gateway}
            getActiveSession={() => ({
              adapterKind: "node",
              rootPath: currentRoot,
              sessionId: 7,
              workspaceId: currentWorkspaceId,
            })}
            isWorkspaceCurrent={(rootPath, workspaceId) =>
              rootPath === currentRoot && workspaceId === currentWorkspaceId
            }
            onValue={(value) => {
              management = value;
            }}
            rootPath={currentRoot}
            workspaceId={currentWorkspaceId}
          />,
        );
      });
    render();

    let addition!: Promise<boolean>;
    act(() => {
      addition = management.add("app.render");
    });
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "app.render", enabled: true }),
    ]);
    currentRoot = "/workspace/b";
    currentWorkspaceId = "workspace-b";
    render();
    expect(management.functionBreakpoints).toEqual([]);

    await act(async () => settle());
    await expect(addition).resolves.toBe(false);
    expect(setFunctionBreakpoints).toHaveBeenCalledWith({
      rootPath: "/workspace/a",
      sessionId: 7,
      breakpoints: [expect.objectContaining({ functionName: "app.render" })],
    });
    currentRoot = "/workspace/a";
    currentWorkspaceId = "workspace-a";
    render();
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "app.render" }),
    ]);
  });

  it("persists closed models by normalized workspace root", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    let management!: DebugFunctionBreakpointManagement;
    const gateway = {
      setFunctionBreakpoints: vi.fn().mockResolvedValue([]),
    } as unknown as DebugGateway;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={gateway}
            getActiveSession={() => null}
            isWorkspaceCurrent={() => true}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={storage}
            workspaceId="workspace"
          />,
        );
      });
    render();
    await act(async () => {
      await management.add("controller.save");
    });
    expect([...values.values()].map((value) => JSON.parse(value))).toEqual([
      [expect.objectContaining({ functionName: "controller.save", enabled: true })],
    ]);
  });

  it("serializes rapid replacements so the newest list reaches the backend last", async () => {
    let settleFirst!: () => void;
    let settleSecond!: () => void;
    const setFunctionBreakpoints = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve) => {
            settleFirst = () => resolve([]);
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<[]>((resolve) => {
            settleSecond = () => resolve([]);
          }),
      );
    const gateway = { setFunctionBreakpoints } as unknown as DebugGateway;
    let management!: DebugFunctionBreakpointManagement;
    act(() => {
      root.render(
        <Harness
          gateway={gateway}
          getActiveSession={() => ({
            adapterKind: "node",
            rootPath: "/workspace",
            sessionId: 7,
            workspaceId: "workspace",
          })}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          workspaceId="workspace"
        />,
      );
    });

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = management.add("app.first");
      second = management.add("app.second");
    });

    expect(setFunctionBreakpoints).toHaveBeenCalledTimes(1);
    expect(setFunctionBreakpoints.mock.calls[0][0].breakpoints).toEqual([
      expect.objectContaining({ functionName: "app.first" }),
    ]);

    await act(async () => settleFirst());
    expect(setFunctionBreakpoints).toHaveBeenCalledTimes(2);
    expect(setFunctionBreakpoints.mock.calls[1][0].breakpoints).toEqual([
      expect.objectContaining({ functionName: "app.first" }),
      expect.objectContaining({ functionName: "app.second" }),
    ]);

    await act(async () => settleSecond());
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("applies function verification events only for the exact active session owner", async () => {
    let emit!: (event: import("../domain/debug").DebugEvent) => void;
    const gateway = {
      setFunctionBreakpoints: vi.fn(
        async (request: import("../domain/debug").DebugSetFunctionBreakpointsRequest) =>
          request.breakpoints.map(({ id }) => ({ id, verified: false })),
      ),
      subscribe: vi.fn((handler) => {
        emit = handler;
        return () => undefined;
      }),
    } as unknown as DebugGateway;
    const storage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    let management!: DebugFunctionBreakpointManagement;
    act(() => {
      root.render(
        <Harness
          gateway={gateway}
          getActiveSession={() => ({
            adapterKind: "node",
            rootPath: "/workspace",
            sessionId: 7,
            workspaceId: "workspace",
          })}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={storage}
          workspaceId="workspace"
        />,
      );
    });
    await act(async () => {
      await management.add("app.render");
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: false }));
    const id = management.functionBreakpoints[0]?.id ?? "";

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 8,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          breakpoints: [{ id, verified: true }],
        },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: false }));

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 2,
        payload: {
          kind: "functionBreakpointsVerified",
          breakpoints: [{ id, verified: true }],
        },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: true }));

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          breakpoints: [{ id, verified: false }],
        },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: true }));

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 3,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: false }));
  });

  it("does not resurrect a removed breakpoint from a late verification event", async () => {
    let emit!: (event: import("../domain/debug").DebugEvent) => void;
    const gateway = {
      setFunctionBreakpoints: vi.fn(
        async (request: import("../domain/debug").DebugSetFunctionBreakpointsRequest) =>
          request.breakpoints.map(({ id }) => ({ id, verified: false })),
      ),
      subscribe: vi.fn((handler) => {
        emit = handler;
        return () => undefined;
      }),
    } as unknown as DebugGateway;
    let management!: DebugFunctionBreakpointManagement;
    act(() => {
      root.render(
        <Harness
          gateway={gateway}
          getActiveSession={() => ({
            adapterKind: "node",
            rootPath: "/workspace",
            sessionId: 7,
            workspaceId: "workspace",
          })}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={{
            getItem: () => null,
            removeItem: () => undefined,
            setItem: () => undefined,
          }}
          workspaceId="workspace"
        />,
      );
    });
    await act(async () => {
      await management.add("app.render");
    });
    const id = management.functionBreakpoints[0]?.id ?? "";
    await act(async () => {
      await management.remove(id);
    });

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          breakpoints: [{ id, verified: true }],
        },
      });
    });

    expect(management.functionBreakpoints).toEqual([]);
  });
});

function Harness({
  onValue,
  ...options
}: Parameters<typeof useDebugFunctionBreakpointManagement>[0] & {
  readonly onValue: (value: DebugFunctionBreakpointManagement) => void;
}) {
  onValue(useDebugFunctionBreakpointManagement(options));
  return null;
}
