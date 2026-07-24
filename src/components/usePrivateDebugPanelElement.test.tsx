// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugCopyValuePanelSurfaces } from "./DebugPanel";
import type { DebugSetVariableSurface } from "./debugSetVariableSurface";
import type { DebugAddToWatchVariableSurface } from "./debugAddToWatchSurface";
import { usePrivateDebugPanelElement } from "./usePrivateDebugPanelElement";
import type { PublicDebugPanelProps } from "./useDebugPanelProps";

vi.mock("./DebugPanel", () => ({
  DebugPanel: ({
    debugCopyValue,
    debugAddToWatch,
    debugSetVariable,
  }: {
    debugCopyValue: DebugCopyValuePanelSurfaces;
    debugAddToWatch?: DebugAddToWatchVariableSurface;
    debugSetVariable?: DebugSetVariableSurface;
  }) => (
    <div
      data-owner={debugCopyValue.variables.workspaceOwnerKey}
      data-add-to-watch={String(Boolean(debugAddToWatch))}
      data-set-variable={String(Boolean(debugSetVariable))}
    />
  ),
}));

describe("private debug panel element", () => {
  it("keeps nested Watch mutation authorities outside the public panel graph", () => {
    const exposesAddToWatch: "debugAddToWatch" extends keyof PublicDebugPanelProps ? true : false =
      false;
    const exposesSetVariableSurface: "setVariableSurface" extends keyof PublicDebugPanelProps["watches"]
      ? true
      : false = false;
    const exposesMutationRows: "variableMutationRows" extends keyof PublicDebugPanelProps["watches"]
      ? true
      : false = false;

    expect(exposesAddToWatch).toBe(false);
    expect(exposesSetVariableSurface).toBe(false);
    expect(exposesMutationRows).toBe(false);
  });

  it("keeps the outer boundary stable and refreshes private surfaces through its ref", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let owner = "owner-a";
    let element: ReactElement | null = null;
    const surfaces = () =>
      ({
        variables: { workspaceOwnerKey: owner },
        watch: { workspaceOwnerKey: owner },
      }) as DebugCopyValuePanelSurfaces;
    const setVariableSurface: DebugSetVariableSurface = {
      setFocusedCapability: () => () => undefined,
    };
    const addToWatchSurface: DebugAddToWatchVariableSurface = {
      setFocusedCandidate: () => () => undefined,
      canAddToWatch: () => false,
      addToWatch: () => false,
    };
    function Harness() {
      element = usePrivateDebugPanelElement(
        {} as never,
        surfaces(),
        setVariableSurface,
        addToWatchSurface,
      );
      return element;
    }

    act(() => root.render(<Harness />));
    const boundary = element!.type;
    expect(Object.keys(element!.props as object)).not.toContain("debugCopyValue");
    expect(Object.keys(element!.props as object)).not.toContain("debugAddToWatch");
    expect(Object.keys(element!.props as object)).not.toContain("debugSetVariable");
    expect(host.querySelector("div")?.dataset.owner).toBe("owner-a");
    expect(host.querySelector("div")?.dataset.addToWatch).toBe("true");
    expect(host.querySelector("div")?.dataset.setVariable).toBe("true");

    owner = "owner-b";
    act(() => root.render(<Harness />));
    expect(element!.type).toBe(boundary);
    expect(host.querySelector("div")?.dataset.owner).toBe("owner-b");
    act(() => root.unmount());
  });
});
