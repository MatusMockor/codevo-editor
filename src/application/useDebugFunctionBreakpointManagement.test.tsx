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
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.clear();
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
              workspaceEpoch: 0,
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
      generation: expect.any(Number),
      breakpoints: [expect.objectContaining({ functionName: "app.render" })],
    });
    currentRoot = "/workspace/a";
    currentWorkspaceId = "workspace-a";
    render();
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "app.render" }),
    ]);
  });

  it("persists closed models by exact workspace identity and normalized root", async () => {
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
    expect([...values.keys()][0]).toContain("workspace");
  });

  it("claims legacy data for the exact owner and upgrades it on the first mutation", async () => {
    const values = new Map<string, string>([
      [
        "mockor.debug.functionBreakpoints./workspace",
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
    ]);
    const storage = mapStorage(values);
    let management!: DebugFunctionBreakpointManagement;

    act(() => {
      root.render(
        <Harness
          gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
          getActiveSession={() => null}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace/"
          storage={storage}
          workspaceId="workspace-a"
        />,
      );
    });

    expect(management.functionBreakpoints).toEqual([
      { id: "legacy-id", functionName: "legacy.handler", enabled: true },
    ]);
    expect(values.has("mockor.debug.functionBreakpoints./workspace")).toBe(true);
    expect(values.has('mockor.debug.functionBreakpoints.["/workspace","workspace-a"]')).toBe(false);
    expect(values.get("mockor.debug.functionBreakpointsMigrationOwner./workspace")).toBe(
      '"workspace-a"',
    );

    await act(async () => {
      await management.setEnabled("legacy-id", false);
    });

    expect(values.has("mockor.debug.functionBreakpoints./workspace")).toBe(false);
    expect(
      JSON.parse(
        values.get('mockor.debug.functionBreakpoints.["/workspace","workspace-a"]') ?? "null",
      ),
    ).toEqual([{ id: "legacy-id", functionName: "legacy.handler", enabled: false }]);
    expect(
      [...values.keys()].some((key) =>
        key.startsWith("mockor.debug.functionBreakpointsMigrationOwner."),
      ),
    ).toBe(false);
  });

  it("prefers existing scoped persistence and retires stale legacy data", () => {
    const values = new Map<string, string>([
      [
        "mockor.debug.functionBreakpoints./workspace",
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
      [
        'mockor.debug.functionBreakpoints.["/workspace","workspace-a"]',
        JSON.stringify([{ id: "scoped-id", functionName: "scoped.handler", enabled: false }]),
      ],
    ]);
    let management!: DebugFunctionBreakpointManagement;

    act(() => {
      root.render(
        <Harness
          gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
          getActiveSession={() => null}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={mapStorage(values)}
          workspaceId="workspace-a"
        />,
      );
    });

    expect(management.functionBreakpoints).toEqual([
      { id: "scoped-id", functionName: "scoped.handler", enabled: false },
    ]);
    expect(values.has("mockor.debug.functionBreakpoints./workspace")).toBe(false);
  });

  it("treats even corrupt scoped persistence as newer than legacy data", () => {
    const legacyKey = "mockor.debug.functionBreakpoints./workspace";
    const scopedKey = 'mockor.debug.functionBreakpoints.["/workspace","workspace-a"]';
    const values = new Map<string, string>([
      [
        legacyKey,
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
      [scopedKey, "corrupt scoped data"],
    ]);
    let management!: DebugFunctionBreakpointManagement;

    act(() => {
      root.render(
        <Harness
          gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
          getActiveSession={() => null}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={mapStorage(values)}
          workspaceId="workspace-a"
        />,
      );
    });

    expect(management.functionBreakpoints).toEqual([]);
    expect(values.get(scopedKey)).toBe("corrupt scoped data");
    expect(values.has(legacyKey)).toBe(true);
    expect(values.get("mockor.debug.functionBreakpointsMigrationOwner./workspace")).toBe(
      '"workspace-a"',
    );
  });

  it("defers legacy migration until a non-null exact workspace identity arrives", () => {
    const legacyKey = "mockor.debug.functionBreakpoints./workspace";
    const values = new Map<string, string>([
      [
        legacyKey,
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
    ]);
    const storage = mapStorage(values);
    let workspaceId: string | null = null;
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
            getActiveSession={() => null}
            isWorkspaceCurrent={() => true}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={storage}
            workspaceId={workspaceId}
          />,
        );
      });

    render();
    expect(management.functionBreakpoints).toEqual([]);
    expect(values).toEqual(
      new Map([
        [
          legacyKey,
          JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
        ],
      ]),
    );

    workspaceId = "workspace-a";
    render();
    expect(management.functionBreakpoints).toEqual([
      { id: "legacy-id", functionName: "legacy.handler", enabled: true },
    ]);
    expect(values.get("mockor.debug.functionBreakpointsMigrationOwner./workspace")).toBe(
      '"workspace-a"',
    );
  });

  it("bounds corrupt scoped persistence without parsing or replacing it", () => {
    const legacyKey = "mockor.debug.functionBreakpoints./workspace";
    const scopedKey = 'mockor.debug.functionBreakpoints.["/workspace","workspace-a"]';
    const oversizedScoped = "x".repeat(131_073);
    const legacyRaw = JSON.stringify([
      { id: "legacy-id", functionName: "legacy.handler", enabled: true },
    ]);
    const values = new Map<string, string>([
      [legacyKey, legacyRaw],
      [scopedKey, oversizedScoped],
    ]);
    let management!: DebugFunctionBreakpointManagement;

    act(() => {
      root.render(
        <Harness
          gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
          getActiveSession={() => null}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={mapStorage(values)}
          workspaceId="workspace-a"
        />,
      );
    });

    expect(management.functionBreakpoints).toEqual([]);
    expect(values.get(scopedKey)).toBe(oversizedScoped);
    expect(values.get(legacyKey)).toBe(legacyRaw);
  });

  it("does not expose one legacy policy to a second same-root workspace", () => {
    const values = new Map<string, string>([
      [
        "mockor.debug.functionBreakpoints./workspace",
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
    ]);
    const storage = mapStorage(values);
    let workspaceId = "workspace-a";
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
            getActiveSession={() => null}
            isWorkspaceCurrent={() => true}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={storage}
            workspaceId={workspaceId}
          />,
        );
      });

    render();
    expect(management.functionBreakpoints).toHaveLength(1);
    workspaceId = "workspace-b";
    render();
    expect(management.functionBreakpoints).toEqual([]);
  });

  it("retains a migration claim when legacy cleanup fails so another workspace cannot import it", () => {
    const legacyKey = "mockor.debug.functionBreakpoints./workspace";
    const values = new Map<string, string>([
      [
        legacyKey,
        JSON.stringify([{ id: "legacy-id", functionName: "legacy.handler", enabled: true }]),
      ],
    ]);
    const storage = {
      ...mapStorage(values),
      removeItem: (key: string) => {
        if (key === legacyKey) throw new Error("storage cleanup denied");
        values.delete(key);
      },
    };
    let workspaceId = "workspace-a";
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
            getActiveSession={() => null}
            isWorkspaceCurrent={() => true}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={storage}
            workspaceId={workspaceId}
          />,
        );
      });

    render();
    expect(management.functionBreakpoints).toHaveLength(1);
    expect(values.get("mockor.debug.functionBreakpointsMigrationOwner./workspace")).toBe(
      '"workspace-a"',
    );

    workspaceId = "workspace-b";
    render();
    expect(management.functionBreakpoints).toEqual([]);
    expect(values.has(legacyKey)).toBe(true);
  });

  it.each(["not json", JSON.stringify({ id: "wrong-shape" }), JSON.stringify([null])])(
    "fails closed without rewriting corrupt legacy persistence: %s",
    (legacyRaw) => {
      const legacyKey = "mockor.debug.functionBreakpoints./workspace";
      const values = new Map<string, string>([[legacyKey, legacyRaw]]);
      let management!: DebugFunctionBreakpointManagement;

      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints: vi.fn() } as unknown as DebugGateway}
            getActiveSession={() => null}
            isWorkspaceCurrent={() => true}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={mapStorage(values)}
            workspaceId="workspace-a"
          />,
        );
      });

      expect(management.functionBreakpoints).toEqual([]);
      expect(values).toEqual(new Map([[legacyKey, legacyRaw]]));
    },
  );

  it("does not expose or synchronize policy from a replaced same-root workspace generation", async () => {
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
    const setFunctionBreakpoints = vi.fn(
      async (request: import("../domain/debug").DebugSetFunctionBreakpointsRequest) =>
        request.breakpoints.map(({ id }) => ({ id, verified: true })),
    );
    let currentWorkspaceId = "workspace-a";
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints } as unknown as DebugGateway}
            getActiveSession={() => ({
              adapterKind: "node",
              rootPath: "/workspace",
              sessionId: 7,
              workspaceEpoch: 0,
              workspaceId: currentWorkspaceId,
            })}
            isWorkspaceCurrent={(_, workspaceId) => workspaceId === currentWorkspaceId}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={storage}
            workspaceId={currentWorkspaceId}
          />,
        );
      });

    render();
    await act(async () => {
      await management.add("globalThis.fromGenerationA");
    });
    expect(management.functionBreakpoints).toHaveLength(1);
    setFunctionBreakpoints.mockClear();

    currentWorkspaceId = "workspace-b";
    render();
    expect(management.functionBreakpoints).toEqual([]);
    await act(async () => {
      await management.synchronizeSession("/workspace", "workspace-b", 0, 7, "node");
    });
    expect(setFunctionBreakpoints).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace",
      sessionId: 7,
      generation: expect.any(Number),
      breakpoints: [],
    });

    currentWorkspaceId = "workspace-a";
    render();
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.fromGenerationA" }),
    ]);
  });

  it("drops a pending ACK after a same-root A-B-A owner transition", async () => {
    let settle!: () => void;
    const setFunctionBreakpoints = vi.fn(
      (request: import("../domain/debug").DebugSetFunctionBreakpointsRequest) =>
        new Promise<readonly { readonly id: string; readonly verified: boolean }[]>((resolve) => {
          settle = () => resolve(request.breakpoints.map(({ id }) => ({ id, verified: true })));
        }),
    );
    let currentWorkspaceId = "workspace-a";
    let currentWorkspaceEpoch = 0;
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints } as unknown as DebugGateway}
            getActiveSession={() => ({
              adapterKind: "node",
              rootPath: "/workspace",
              sessionId: 7,
              workspaceEpoch: currentWorkspaceEpoch,
              workspaceId: currentWorkspaceId,
            })}
            isWorkspaceCurrent={(_, workspaceId) => workspaceId === currentWorkspaceId}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={{
              getItem: () => null,
              removeItem: () => undefined,
              setItem: () => undefined,
            }}
            workspaceEpoch={currentWorkspaceEpoch}
            workspaceId={currentWorkspaceId}
          />,
        );
      });

    render();
    let addition!: Promise<boolean>;
    act(() => {
      addition = management.add("globalThis.target");
    });
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.target", verified: false }),
    ]);

    currentWorkspaceId = "workspace-b";
    currentWorkspaceEpoch = 1;
    render();
    currentWorkspaceId = "workspace-a";
    currentWorkspaceEpoch = 2;
    render();
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.target", verified: false }),
    ]);

    await act(async () => settle());
    await expect(addition).resolves.toBe(false);
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.target" }),
    ]);
    expect(management.functionBreakpoints[0]?.verified).not.toBe(true);
  });

  it("drops a late verification event after a same-root A-B-A owner transition", async () => {
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
    let currentWorkspaceId = "workspace-a";
    let currentWorkspaceEpoch = 0;
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={gateway}
            getActiveSession={() => ({
              adapterKind: "node",
              rootPath: "/workspace",
              sessionId: 7,
              workspaceEpoch: currentWorkspaceEpoch,
              workspaceId: currentWorkspaceId,
            })}
            isWorkspaceCurrent={(_, workspaceId) => workspaceId === currentWorkspaceId}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            subscribe={gateway.subscribe}
            workspaceEpoch={currentWorkspaceEpoch}
            workspaceId={currentWorkspaceId}
          />,
        );
      });

    render();
    await act(async () => {
      await management.add("globalThis.target");
    });
    const id = management.functionBreakpoints[0]?.id ?? "";

    currentWorkspaceId = "workspace-b";
    currentWorkspaceEpoch = 1;
    render();
    currentWorkspaceId = "workspace-a";
    currentWorkspaceEpoch = 2;
    render();
    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 1,
          breakpoints: [{ id, verified: true }],
        },
      });
    });

    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.target" }),
    ]);
    expect(management.functionBreakpoints[0]?.verified).not.toBe(true);
  });

  it("does not synchronize a new mutation into a stale session after A-B-A", async () => {
    const setFunctionBreakpoints = vi.fn(
      async (request: import("../domain/debug").DebugSetFunctionBreakpointsRequest) =>
        request.breakpoints.map(({ id }) => ({ id, verified: false })),
    );
    let currentWorkspaceId = "workspace-a";
    let currentWorkspaceEpoch = 0;
    const sessionWorkspaceEpoch = 0;
    let management!: DebugFunctionBreakpointManagement;
    const render = () =>
      act(() => {
        root.render(
          <Harness
            gateway={{ setFunctionBreakpoints } as unknown as DebugGateway}
            getActiveSession={() => ({
              adapterKind: "node",
              rootPath: "/workspace",
              sessionId: 7,
              workspaceEpoch: sessionWorkspaceEpoch,
              workspaceId: "workspace-a",
            })}
            isWorkspaceCurrent={(_, workspaceId) => workspaceId === currentWorkspaceId}
            onValue={(value) => {
              management = value;
            }}
            rootPath="/workspace"
            storage={{
              getItem: () => null,
              removeItem: () => undefined,
              setItem: () => undefined,
            }}
            workspaceEpoch={currentWorkspaceEpoch}
            workspaceId={currentWorkspaceId}
          />,
        );
      });

    render();
    await act(async () => {
      await management.add("globalThis.original");
    });
    setFunctionBreakpoints.mockClear();

    currentWorkspaceId = "workspace-b";
    currentWorkspaceEpoch = 1;
    render();
    currentWorkspaceId = "workspace-a";
    currentWorkspaceEpoch = 2;
    render();

    let synchronized = true;
    await act(async () => {
      synchronized = await management.add("globalThis.afterReturn");
    });
    expect(synchronized).toBe(false);
    expect(setFunctionBreakpoints).not.toHaveBeenCalled();
    expect(management.functionBreakpoints).toEqual([
      expect.objectContaining({ functionName: "globalThis.original" }),
      expect.objectContaining({ functionName: "globalThis.afterReturn" }),
    ]);
  });

  it("fails closed before persistence and IPC when compound mutation is unavailable", async () => {
    const storage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    const setFunctionBreakpoints = vi.fn().mockResolvedValue([]);
    let management!: DebugFunctionBreakpointManagement;
    act(() => {
      root.render(
        <Harness
          canMutate={() => false}
          gateway={{ setFunctionBreakpoints } as unknown as DebugGateway}
          getActiveSession={() => ({
            adapterKind: "node",
            rootPath: "/workspace",
            sessionId: 7,
            workspaceEpoch: 0,
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

    await expect(management.add("globalThis.blocked")).resolves.toBe(false);
    await expect(
      management.synchronizeSession("/workspace", "workspace", 0, 7, "node"),
    ).resolves.toBe(false);
    expect(management.functionBreakpoints).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(setFunctionBreakpoints).not.toHaveBeenCalled();
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
            workspaceEpoch: 0,
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
            workspaceEpoch: 0,
            workspaceId: "workspace",
          })}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          storage={storage}
          subscribe={gateway.subscribe}
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
          generation: 1,
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
          generation: 1,
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
          generation: 1,
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
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 999,
          breakpoints: [{ id, verified: false }],
        },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: true }));

    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 4,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: false }));
  });

  it("does not let an older IPC response overwrite a newer same-generation event", async () => {
    let emit!: (event: import("../domain/debug").DebugEvent) => void;
    let resolveReplacement!: (
      value: readonly import("../domain/debug").FunctionBreakpointVerification[],
    ) => void;
    let request!: import("../domain/debug").DebugSetFunctionBreakpointsRequest;
    const gateway = {
      setFunctionBreakpoints: vi.fn(
        (next: import("../domain/debug").DebugSetFunctionBreakpointsRequest) => {
          request = next;
          return new Promise<readonly import("../domain/debug").FunctionBreakpointVerification[]>(
            (resolve) => {
              resolveReplacement = resolve;
            },
          );
        },
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
            workspaceEpoch: 0,
            workspaceId: "workspace",
          })}
          isWorkspaceCurrent={() => true}
          onValue={(value) => {
            management = value;
          }}
          rootPath="/workspace"
          subscribe={gateway.subscribe}
          workspaceId="workspace"
        />,
      );
    });

    let addition!: Promise<boolean>;
    act(() => {
      addition = management.add("globalThis.qaFunction");
    });
    const id = management.functionBreakpoints[0]?.id ?? "";
    act(() => {
      emit({
        rootPath: "/workspace",
        sessionId: 7,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: request.generation,
          breakpoints: [{ id, verified: true }],
        },
      });
    });
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: true }));

    await act(async () => {
      resolveReplacement([{ id, verified: false }]);
      await addition;
    });
    await expect(addition).resolves.toBe(true);
    expect(management.functionBreakpoints[0]).toEqual(expect.objectContaining({ verified: true }));
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
            workspaceEpoch: 0,
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
          subscribe={gateway.subscribe}
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
          generation: 1,
          breakpoints: [{ id, verified: true }],
        },
      });
    });

    expect(management.functionBreakpoints).toEqual([]);
  });
});

function Harness({
  onValue,
  workspaceEpoch = 0,
  ...options
}: Omit<Parameters<typeof useDebugFunctionBreakpointManagement>[0], "workspaceEpoch"> & {
  readonly onValue: (value: DebugFunctionBreakpointManagement) => void;
  readonly workspaceEpoch?: number;
}) {
  onValue(useDebugFunctionBreakpointManagement({ ...options, workspaceEpoch }));
  return null;
}

function mapStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
