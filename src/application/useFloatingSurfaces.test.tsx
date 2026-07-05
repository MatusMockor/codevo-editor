// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useFloatingSurfaces,
  type FloatingSurfaces,
  type FloatingSurfacesDependencies,
} from "./useFloatingSurfaces";
import type { GitChangedFile } from "../domain/git";

function createDependencies(
  overrides: Partial<FloatingSurfacesDependencies> = {},
): FloatingSurfacesDependencies {
  return {
    paletteOpen: false,
    setPaletteOpen: vi.fn(),
    quickOpenOpen: false,
    setQuickOpenOpen: vi.fn(),
    classOpenOpen: false,
    setClassOpenOpen: vi.fn(),
    workspaceSymbolsOpen: false,
    setWorkspaceSymbolsOpen: vi.fn(),
    searchEverywhereOpen: false,
    setSearchEverywhereOpen: vi.fn(),
    resetSearchEverywhere: vi.fn(),
    textSearchOpen: false,
    setTextSearchOpen: vi.fn(),
    languageServerSetupOpen: false,
    setLanguageServerSetupOpen: vi.fn(),
    fileStructureOpen: false,
    setFileStructureOpen: vi.fn(),
    recentFilesSwitcherOpen: false,
    setRecentFilesSwitcherOpen: vi.fn(),
    recentLocationsPanelOpen: false,
    setRecentLocationsPanelOpen: vi.fn(),
    callHierarchyView: null,
    setCallHierarchyView: vi.fn(),
    typeHierarchyView: null,
    setTypeHierarchyView: vi.fn(),
    referencesView: null,
    setReferencesView: vi.fn(),
    implementationChooser: null,
    setImplementationChooser: vi.fn(),
    selectedGitChange: null,
    gitDiffLoading: false,
    closeGitDiffPreview: vi.fn(),
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    setSettingsInitialSection: vi.fn(),
    ...overrides,
  };
}

function changedFile(path: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path,
    status: "modified",
  };
}

interface Harness {
  surfaces: () => FloatingSurfaces;
  rerender: (deps: FloatingSurfacesDependencies) => void;
  unmount: () => void;
}

function renderFloatingSurfaces(
  deps: FloatingSurfacesDependencies,
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { surfaces: FloatingSurfaces | null } = { surfaces: null };

  function Harness({ deps }: { deps: FloatingSurfacesDependencies }) {
    captured.surfaces = useFloatingSurfaces(deps);
    return null;
  }

  act(() => {
    root.render(<Harness deps={deps} />);
  });

  return {
    surfaces: () => {
      if (!captured.surfaces) {
        throw new Error("hook not mounted");
      }
      return captured.surfaces;
    },
    rerender: (nextDeps) => {
      act(() => {
        root.render(<Harness deps={nextDeps} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useFloatingSurfaces", () => {
  it("openSettingsPanel closes every other floating surface and opens Settings on General", () => {
    const deps = createDependencies();
    const harness = renderFloatingSurfaces(deps);

    act(() => {
      harness.surfaces().openSettingsPanel();
    });

    expect(deps.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(deps.setQuickOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setClassOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setWorkspaceSymbolsOpen).toHaveBeenCalledWith(false);
    expect(deps.setTextSearchOpen).toHaveBeenCalledWith(false);
    expect(deps.setLanguageServerSetupOpen).toHaveBeenCalledWith(false);
    expect(deps.setFileStructureOpen).toHaveBeenCalledWith(false);
    expect(deps.setCallHierarchyView).toHaveBeenCalledWith(null);
    expect(deps.setTypeHierarchyView).toHaveBeenCalledWith(null);
    expect(deps.setReferencesView).toHaveBeenCalledWith(null);
    expect(deps.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(deps.setSettingsInitialSection).toHaveBeenCalledWith("general");

    harness.unmount();
  });

  it("openAppearanceSettingsPanel opens Settings directly on the Appearance section", () => {
    const deps = createDependencies();
    const harness = renderFloatingSurfaces(deps);

    act(() => {
      harness.surfaces().openAppearanceSettingsPanel();
    });

    expect(deps.setSettingsInitialSection).toHaveBeenCalledWith("appearance");
    expect(deps.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(deps.setPaletteOpen).toHaveBeenCalledWith(false);

    harness.unmount();
  });

  it("openWorkspaceSymbols closes the file/class palettes and the recent switchers, then opens itself", () => {
    const deps = createDependencies();
    const harness = renderFloatingSurfaces(deps);

    act(() => {
      harness.surfaces().openWorkspaceSymbols();
    });

    expect(deps.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(deps.setQuickOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setClassOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setRecentFilesSwitcherOpen).toHaveBeenCalledWith(false);
    expect(deps.setRecentLocationsPanelOpen).toHaveBeenCalledWith(false);
    expect(deps.setTextSearchOpen).toHaveBeenCalledWith(false);
    expect(deps.setWorkspaceSymbolsOpen).toHaveBeenCalledWith(true);
    // Settings/search-everywhere are untouched by this opener.
    expect(deps.setSettingsOpen).not.toHaveBeenCalled();
    expect(deps.setSearchEverywhereOpen).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("openSearchEverywhere closes the other palettes, resets its own search model, then opens itself", () => {
    const deps = createDependencies();
    const harness = renderFloatingSurfaces(deps);

    act(() => {
      harness.surfaces().openSearchEverywhere();
    });

    expect(deps.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(deps.setQuickOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setClassOpenOpen).toHaveBeenCalledWith(false);
    expect(deps.setWorkspaceSymbolsOpen).toHaveBeenCalledWith(false);
    expect(deps.setRecentFilesSwitcherOpen).toHaveBeenCalledWith(false);
    expect(deps.setRecentLocationsPanelOpen).toHaveBeenCalledWith(false);
    expect(deps.setTextSearchOpen).toHaveBeenCalledWith(false);
    expect(deps.resetSearchEverywhere).toHaveBeenCalledTimes(1);
    expect(deps.setSearchEverywhereOpen).toHaveBeenCalledWith(true);

    harness.unmount();
  });

  it("closeFloatingSurface prioritizes Search Everywhere over every other open surface", () => {
    const deps = createDependencies({
      searchEverywhereOpen: true,
      settingsOpen: true,
      workspaceSymbolsOpen: true,
      paletteOpen: true,
    });
    const harness = renderFloatingSurfaces(deps);

    let closed = false;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(true);
    expect(deps.setSearchEverywhereOpen).toHaveBeenCalledWith(false);
    expect(deps.setSettingsOpen).not.toHaveBeenCalled();
    expect(deps.setWorkspaceSymbolsOpen).not.toHaveBeenCalled();
    expect(deps.setPaletteOpen).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("closeFloatingSurface falls through to the Settings panel when nothing higher-priority is open", () => {
    const deps = createDependencies({
      settingsOpen: true,
      workspaceSymbolsOpen: true,
      paletteOpen: true,
    });
    const harness = renderFloatingSurfaces(deps);

    let closed = false;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(true);
    expect(deps.setSettingsOpen).toHaveBeenCalledWith(false);
    expect(deps.setWorkspaceSymbolsOpen).not.toHaveBeenCalled();
    expect(deps.setPaletteOpen).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("closeFloatingSurface falls all the way through to the git diff preview as the last resort", () => {
    const deps = createDependencies({
      selectedGitChange: changedFile("/workspace/a.ts"),
    });
    const harness = renderFloatingSurfaces(deps);

    let closed = false;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(true);
    expect(deps.closeGitDiffPreview).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("closeFloatingSurface also closes a loading git diff preview with no selection yet", () => {
    const deps = createDependencies({ gitDiffLoading: true });
    const harness = renderFloatingSurfaces(deps);

    let closed = false;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(true);
    expect(deps.closeGitDiffPreview).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("closeFloatingSurface returns false when nothing is open", () => {
    const deps = createDependencies();
    const harness = renderFloatingSurfaces(deps);

    let closed = true;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(false);
    expect(deps.closeGitDiffPreview).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("closeFloatingSurface re-evaluates priority after a rerender reflects the latest surface state", () => {
    const deps = createDependencies({ recentFilesSwitcherOpen: true });
    const harness = renderFloatingSurfaces(deps);

    act(() => {
      harness.surfaces().closeFloatingSurface();
    });

    expect(deps.setRecentFilesSwitcherOpen).toHaveBeenCalledWith(false);

    const nextDeps = createDependencies({ recentLocationsPanelOpen: true });
    harness.rerender(nextDeps);

    let closed = false;
    act(() => {
      closed = harness.surfaces().closeFloatingSurface();
    });

    expect(closed).toBe(true);
    expect(nextDeps.setRecentLocationsPanelOpen).toHaveBeenCalledWith(false);

    harness.unmount();
  });
});
