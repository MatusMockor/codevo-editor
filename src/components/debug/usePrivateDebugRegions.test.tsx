// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugCopyValuePanelSurfaces, DebugPanelProps } from "../DebugPanel";
import type { DebugAddToWatchVariableSurface } from "../debugAddToWatchSurface";
import type { DebugSetVariableSurface } from "../debugSetVariableSurface";
import { DebugViewsRevealContext } from "./DebugViewsRevealContext";
import { usePrivateDebugRegions, type PrivateDebugRegions } from "./usePrivateDebugRegions";

function probe(region: string) {
  return (props: DebugPanelProps & { readonly onShowDebugViews?: (() => void) | null }) => (
    <div
      data-add-to-watch={String(Boolean(props.debugAddToWatch))}
      data-owner={props.debugCopyValue?.variables.workspaceOwnerKey}
      data-region={region}
      data-set-variable={String(Boolean(props.debugSetVariable))}
      data-show-views={
        props.onShowDebugViews === undefined ? "absent" : String(Boolean(props.onShowDebugViews))
      }
    />
  );
}

vi.mock("./DebugToolbarRegion", () => ({ DebugToolbarRegion: probe("toolbar") }));
vi.mock("./DebugSectionsRegion", () => ({ DebugSectionsRegion: probe("sections") }));
vi.mock("./DebugConsoleRegion", () => ({
  DebugConsoleRegion: probe("console"),
  DebugConsoleHeader: probe("consoleHeader"),
}));

describe("usePrivateDebugRegions", () => {
  it("keeps every region boundary stable, injects private surfaces through refs and reads Show debug views from context", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let owner = "owner-a";
    let showViews: (() => void) | null = () => undefined;
    let regions: PrivateDebugRegions | null = null;
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
      regions = usePrivateDebugRegions(
        {} as never,
        surfaces(),
        setVariableSurface,
        addToWatchSurface,
      );
      return (
        <DebugViewsRevealContext.Provider value={showViews}>
          {regions.toolbar}
          {regions.sections}
          {regions.console}
          {regions.consoleHeader}
        </DebugViewsRevealContext.Provider>
      );
    }
    const region = (name: string) =>
      host.querySelector<HTMLElement>(`[data-region="${name}"]`)?.dataset;

    act(() => root.render(<Harness />));
    const first = regions as PrivateDebugRegions | null;
    const types = [first?.toolbar.type, first?.sections.type, first?.console.type];
    for (const element of [first?.toolbar, first?.sections, first?.console, first?.consoleHeader]) {
      expect(Object.keys((element as ReactElement).props as object)).not.toContain(
        "debugCopyValue",
      );
    }
    expect(region("sections")?.owner).toBe("owner-a");
    expect(region("sections")?.addToWatch).toBe("true");
    expect(region("sections")?.setVariable).toBe("true");
    expect(region("consoleHeader")?.showViews).toBe("true");

    owner = "owner-b";
    showViews = null;
    act(() => root.render(<Harness />));
    const second = regions as PrivateDebugRegions | null;
    expect([second?.toolbar.type, second?.sections.type, second?.console.type]).toEqual(types);
    expect(region("sections")?.owner).toBe("owner-b");
    expect(region("console")?.owner).toBe("owner-b");
    expect(region("consoleHeader")?.showViews).toBe("false");
    act(() => root.unmount());
  });
});
