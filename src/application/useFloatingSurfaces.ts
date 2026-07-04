import { useCallback } from "react";
import type { CallHierarchyView } from "../domain/callHierarchy";
import type { GitChangedFile } from "../domain/git";
import type { ImplementationTarget } from "../domain/implementationTargets";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import type { ReferencesView } from "../domain/referencesView";
import type { SettingsSection } from "../domain/settings";
import type { TypeHierarchyView } from "../domain/typeHierarchy";
import type { FileSearchResult } from "../domain/workspace";

export interface ImplementationChooserState {
  targets: ImplementationTarget[];
  title: string;
}

/**
 * Every other floating surface (palette/dialog/panel) the shell owns is a
 * dependency here, never state: the Settings panel and the two search
 * palettes (Go to Symbol, Search Everywhere) are mutually exclusive with the
 * whole rest of the workbench's overlays (Quick Open, Go to Class, Find in
 * Path, the recent files/locations switchers, the call/type hierarchy and
 * references views, the implementation chooser, the language server setup
 * dialog and the git diff preview). None of that foreign state is owned by
 * this hook - each open/close boolean (or view) is read/written from many
 * unrelated controller regions (workspace switch/reset flows, other
 * palettes' own search effects, etc.), so it is injected here exactly like
 * `relativeWorkspacePath` is injected into `useWorkspaceTodos`. Only the
 * Settings panel's own state (`settingsOpen`/its initial section) and the
 * open/close boolean for the two search palettes stay conceptually "owned"
 * by the region - even those raw booleans still live in the shell because
 * they too are read from effects that populate their search results.
 */
export interface FloatingSurfacesDependencies {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  quickOpenOpen: boolean;
  setQuickOpenOpen: (open: boolean) => void;
  classOpenOpen: boolean;
  setClassOpenOpen: (open: boolean) => void;
  workspaceSymbolsOpen: boolean;
  setWorkspaceSymbolsOpen: (open: boolean) => void;
  searchEverywhereOpen: boolean;
  setSearchEverywhereOpen: (open: boolean) => void;
  setSearchEverywhereQuery: (query: string) => void;
  setSearchEverywhereFiles: (files: FileSearchResult[]) => void;
  setSearchEverywhereSymbols: (symbols: ProjectSymbolSearchResult[]) => void;
  textSearchOpen: boolean;
  setTextSearchOpen: (open: boolean) => void;
  languageServerSetupOpen: boolean;
  setLanguageServerSetupOpen: (open: boolean) => void;
  fileStructureOpen: boolean;
  setFileStructureOpen: (open: boolean) => void;
  recentFilesSwitcherOpen: boolean;
  setRecentFilesSwitcherOpen: (open: boolean) => void;
  recentLocationsPanelOpen: boolean;
  setRecentLocationsPanelOpen: (open: boolean) => void;
  callHierarchyView: CallHierarchyView | null;
  setCallHierarchyView: (view: CallHierarchyView | null) => void;
  typeHierarchyView: TypeHierarchyView | null;
  setTypeHierarchyView: (view: TypeHierarchyView | null) => void;
  referencesView: ReferencesView | null;
  setReferencesView: (view: ReferencesView | null) => void;
  implementationChooser: ImplementationChooserState | null;
  setImplementationChooser: (chooser: ImplementationChooserState | null) => void;
  selectedGitChange: GitChangedFile | null;
  gitDiffLoading: boolean;
  closeGitDiffPreview: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setSettingsInitialSection: (section: SettingsSection) => void;
}

export interface FloatingSurfaces {
  openSettingsPanel: () => void;
  openAppearanceSettingsPanel: () => void;
  openWorkspaceSymbols: () => void;
  openSearchEverywhere: () => void;
  closeFloatingSurface: () => boolean;
}

/**
 * Settings panel + the workbench's floating-surface mutual exclusion. Every
 * "open X" here closes every other floating surface first (only one is ever
 * visible), and `closeFloatingSurface` is the single Escape-key/keyboard
 * shortcut entry point that closes whichever surface currently has priority,
 * falling all the way through to the git diff preview as the last resort.
 */
export function useFloatingSurfaces(
  dependencies: FloatingSurfacesDependencies,
): FloatingSurfaces {
  const {
    paletteOpen,
    setPaletteOpen,
    quickOpenOpen,
    setQuickOpenOpen,
    classOpenOpen,
    setClassOpenOpen,
    workspaceSymbolsOpen,
    setWorkspaceSymbolsOpen,
    searchEverywhereOpen,
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    setSearchEverywhereFiles,
    setSearchEverywhereSymbols,
    textSearchOpen,
    setTextSearchOpen,
    languageServerSetupOpen,
    setLanguageServerSetupOpen,
    fileStructureOpen,
    setFileStructureOpen,
    recentFilesSwitcherOpen,
    setRecentFilesSwitcherOpen,
    recentLocationsPanelOpen,
    setRecentLocationsPanelOpen,
    callHierarchyView,
    setCallHierarchyView,
    typeHierarchyView,
    setTypeHierarchyView,
    referencesView,
    setReferencesView,
    implementationChooser,
    setImplementationChooser,
    selectedGitChange,
    gitDiffLoading,
    closeGitDiffPreview,
    settingsOpen,
    setSettingsOpen,
    setSettingsInitialSection,
  } = dependencies;

  const openSettingsSection = useCallback(
    (section: SettingsSection) => {
      setSettingsInitialSection(section);
      setPaletteOpen(false);
      setQuickOpenOpen(false);
      setClassOpenOpen(false);
      setWorkspaceSymbolsOpen(false);
      setTextSearchOpen(false);
      setLanguageServerSetupOpen(false);
      setFileStructureOpen(false);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setSettingsOpen(true);
    },
    [
      setCallHierarchyView,
      setClassOpenOpen,
      setFileStructureOpen,
      setLanguageServerSetupOpen,
      setPaletteOpen,
      setQuickOpenOpen,
      setReferencesView,
      setSettingsInitialSection,
      setSettingsOpen,
      setTextSearchOpen,
      setTypeHierarchyView,
      setWorkspaceSymbolsOpen,
    ],
  );

  const openSettingsPanel = useCallback(() => {
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setLanguageServerSetupOpen(false);
    setFileStructureOpen(false);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);
    setSettingsOpen(true);
    openSettingsSection("general");
  }, [
    openSettingsSection,
    setCallHierarchyView,
    setClassOpenOpen,
    setFileStructureOpen,
    setLanguageServerSetupOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setReferencesView,
    setSettingsOpen,
    setTextSearchOpen,
    setTypeHierarchyView,
    setWorkspaceSymbolsOpen,
  ]);

  const openAppearanceSettingsPanel = useCallback(() => {
    openSettingsSection("appearance");
  }, [openSettingsSection]);

  const closeFloatingSurface = useCallback((): boolean => {
    if (searchEverywhereOpen) {
      setSearchEverywhereOpen(false);
      return true;
    }

    if (referencesView) {
      setReferencesView(null);
      return true;
    }

    if (typeHierarchyView) {
      setTypeHierarchyView(null);
      return true;
    }

    if (callHierarchyView) {
      setCallHierarchyView(null);
      return true;
    }

    if (implementationChooser) {
      setImplementationChooser(null);
      return true;
    }

    if (languageServerSetupOpen) {
      setLanguageServerSetupOpen(false);
      return true;
    }

    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }

    if (fileStructureOpen) {
      setFileStructureOpen(false);
      return true;
    }

    if (textSearchOpen) {
      setTextSearchOpen(false);
      return true;
    }

    if (workspaceSymbolsOpen) {
      setWorkspaceSymbolsOpen(false);
      return true;
    }

    if (classOpenOpen) {
      setClassOpenOpen(false);
      return true;
    }

    if (quickOpenOpen) {
      setQuickOpenOpen(false);
      return true;
    }

    if (recentFilesSwitcherOpen) {
      setRecentFilesSwitcherOpen(false);
      return true;
    }

    if (recentLocationsPanelOpen) {
      setRecentLocationsPanelOpen(false);
      return true;
    }

    if (paletteOpen) {
      setPaletteOpen(false);
      return true;
    }

    if (selectedGitChange || gitDiffLoading) {
      closeGitDiffPreview();
      return true;
    }

    return false;
  }, [
    callHierarchyView,
    classOpenOpen,
    closeGitDiffPreview,
    fileStructureOpen,
    gitDiffLoading,
    implementationChooser,
    languageServerSetupOpen,
    paletteOpen,
    quickOpenOpen,
    searchEverywhereOpen,
    recentFilesSwitcherOpen,
    recentLocationsPanelOpen,
    referencesView,
    selectedGitChange,
    setCallHierarchyView,
    setClassOpenOpen,
    setFileStructureOpen,
    setImplementationChooser,
    setLanguageServerSetupOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setReferencesView,
    setRecentFilesSwitcherOpen,
    setRecentLocationsPanelOpen,
    setSearchEverywhereOpen,
    setSettingsOpen,
    setTextSearchOpen,
    setTypeHierarchyView,
    setWorkspaceSymbolsOpen,
    settingsOpen,
    textSearchOpen,
    typeHierarchyView,
    workspaceSymbolsOpen,
  ]);

  const openWorkspaceSymbols = useCallback(() => {
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setRecentFilesSwitcherOpen(false);
    setRecentLocationsPanelOpen(false);
    setTextSearchOpen(false);
    setWorkspaceSymbolsOpen(true);
  }, [
    setClassOpenOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setRecentLocationsPanelOpen,
    setTextSearchOpen,
    setWorkspaceSymbolsOpen,
  ]);

  // Search Everywhere is additive: opening it closes the four separate dialogs
  // it aggregates so only one search surface is ever visible, exactly like the
  // other openers above. It works without a workspace too (commands/actions are
  // always searchable); file/symbol sources simply stay empty until a root is
  // open.
  const openSearchEverywhere = useCallback(() => {
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setRecentFilesSwitcherOpen(false);
    setRecentLocationsPanelOpen(false);
    setTextSearchOpen(false);
    setSearchEverywhereQuery("");
    setSearchEverywhereFiles([]);
    setSearchEverywhereSymbols([]);
    setSearchEverywhereOpen(true);
  }, [
    setClassOpenOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setRecentLocationsPanelOpen,
    setSearchEverywhereFiles,
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    setSearchEverywhereSymbols,
    setTextSearchOpen,
    setWorkspaceSymbolsOpen,
  ]);

  return {
    openSettingsPanel,
    openAppearanceSettingsPanel,
    openWorkspaceSymbols,
    openSearchEverywhere,
    closeFloatingSurface,
  };
}
