// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import { waitForReact } from "../test/reactTestLifecycle";
import type { ExpressRoutesPanelProps } from "./ExpressRoutesPanel";
import {
  useWorkspaceExpressRoutesPanelController,
  type UseWorkspaceExpressRoutesPanelControllerOptions,
} from "./useWorkspaceExpressRoutesPanelController";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";

describe("useWorkspaceExpressRoutesPanelController", () => {
  it("discovers only when opened and wires refresh and full-route navigation", async () => {
    const discoveryGateway = gateway();
    const onOpenRoute = vi.fn();
    const harness = renderController({ discoveryGateway, isOpen: false, onOpenRoute });

    expect(discoveryGateway.enumerateJavaScriptSourceFiles).not.toHaveBeenCalled();
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.props().routes).toHaveLength(1));

    expect(harness.props().loading).toBe(false);
    expect(harness.props().error).toBeNull();
    expect(harness.props().truncated).toBe(false);
    await act(async () => harness.props().onOpenRoute(harness.props().routes[0]!));
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(harness.props().routes[0]);

    act(() => harness.props().onRefresh());
    await waitForReact(() =>
      expect(discoveryGateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(2),
    );
    harness.unmount();
  });

  it("passes all dirty snapshots through as exact-file overlays", async () => {
    const harness = renderController({ discoveryGateway: gateway(), isOpen: true });
    await waitForReact(() => expect(harness.props().routes[0]?.path).toBe("/disk"));

    harness.set({
      dirtySnapshots: [
        { relativeFilePath: "src/routes.ts", source: "router.patch('/dirty', handler);" },
        { relativeFilePath: "src/inactive.ts", source: "router.put('/inactive', handler);" },
      ],
    });

    await waitForReact(() =>
      expect(harness.props().routes.map(({ method, path }) => ({ method, path }))).toEqual([
        { method: "PUT", path: "/inactive" },
        { method: "PATCH", path: "/dirty" },
      ]),
    );
    harness.unmount();
  });

  it("persists controlled queries across close and isolates them per workspace", async () => {
    const harness = renderController({ discoveryGateway: gateway(), isOpen: true });
    await waitForReact(() => expect(harness.props().routes).toHaveLength(1));

    act(() => harness.props().onQueryChange("users"));
    expect(harness.props().query).toBe("users");
    harness.set({ isOpen: false });
    expect(harness.props().query).toBe("users");
    harness.set({ isOpen: true });
    expect(harness.props().query).toBe("users");

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    expect(harness.props().query).toBe("");
    act(() => harness.props().onQueryChange("admin"));
    expect(harness.props().query).toBe("admin");

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    expect(harness.props().query).toBe("users");
    harness.unmount();
  });
});

interface Harness {
  props(): ExpressRoutesPanelProps;
  set(options: Partial<UseWorkspaceExpressRoutesPanelControllerOptions>): void;
  unmount(): void;
}

function renderController(
  overrides: Partial<UseWorkspaceExpressRoutesPanelControllerOptions> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: ExpressRoutesPanelProps | null } = { current: null };
  let options: UseWorkspaceExpressRoutesPanelControllerOptions = {
    dirtySnapshots: [],
    discoveryGateway: gateway(),
    discoveryVersion: 0,
    isOpen: false,
    onOpenRoute: vi.fn(),
    rootPath: ROOT_A,
    workspaceId: "workspace-a",
    ...overrides,
  };

  function Component() {
    captured.current = useWorkspaceExpressRoutesPanelController(options);
    return null;
  }

  const render = () => act(() => root.render(<Component />));
  render();
  return {
    props: () => {
      if (!captured.current) throw new Error("Controller is not mounted");
      return captured.current;
    },
    set: (next) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function gateway(
  overrides: Partial<WorkspaceSourceDiscoveryGateway> = {},
): MockWorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(
      overrides.enumerateJavaScriptSourceFiles ??
        (async () => ({ files: ["src/routes.ts"], truncated: false, visited: 2 })),
    ),
    readSourceTextBounded: vi.fn(
      overrides.readSourceTextBounded ??
        (async (): Promise<BoundedWorkspaceSourceRead> => ({
          content: "app.get('/disk', handler);",
          status: "ok",
        })),
    ),
  };
}

interface MockWorkspaceSourceDiscoveryGateway extends WorkspaceSourceDiscoveryGateway {
  enumerateJavaScriptSourceFiles: ReturnType<
    typeof vi.fn<WorkspaceSourceDiscoveryGateway["enumerateJavaScriptSourceFiles"]>
  >;
  readSourceTextBounded: ReturnType<
    typeof vi.fn<WorkspaceSourceDiscoveryGateway["readSourceTextBounded"]>
  >;
}
