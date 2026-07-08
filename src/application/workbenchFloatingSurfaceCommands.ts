import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchFloatingSurfaceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  canSearchWorkspaceSymbols: boolean;
  openQuickOpenFile: Command["run"];
  openRecentFilesSwitcher: Command["run"];
  openRecentLocationsPanel: Command["run"];
  openClassOpen: Command["run"];
  openWorkspaceSymbols: Command["run"];
  openSearchEverywhere: Command["run"];
  openTextSearch: Command["run"];
}

export function workbenchFloatingSurfaceCommands({
  shortcut,
  canSearchWorkspaceSymbols,
  openQuickOpenFile,
  openRecentFilesSwitcher,
  openRecentLocationsPanel,
  openClassOpen,
  openWorkspaceSymbols,
  openSearchEverywhere,
  openTextSearch,
}: WorkbenchFloatingSurfaceCommandsOptions): Command[] {
  return [
    {
      id: "file.quickOpen",
      title: "Quick Open File",
      category: "File",
      shortcut: shortcut("file.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: openQuickOpenFile,
    },
    {
      id: "editor.recentFiles",
      title: "Recent Files",
      category: "File",
      shortcut: shortcut("editor.recentFiles"),
      isEnabled: () => true,
      run: openRecentFilesSwitcher,
    },
    {
      id: "editor.recentLocations",
      title: "Recent Locations",
      category: "File",
      shortcut: shortcut("editor.recentLocations"),
      isEnabled: () => true,
      run: openRecentLocationsPanel,
    },
    {
      id: "class.quickOpen",
      title: "Open Class",
      category: "PHP",
      shortcut: shortcut("class.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: openClassOpen,
    },
    {
      id: "editor.goToSymbol",
      title: "Go to Symbol in Workspace",
      category: "Editor",
      shortcut: shortcut("editor.goToSymbol"),
      isEnabled: (context) =>
        context.hasWorkspace && canSearchWorkspaceSymbols,
      run: openWorkspaceSymbols,
    },
    {
      id: "workbench.searchEverywhere",
      title: "Search Everywhere",
      category: "Workbench",
      shortcut: shortcut("workbench.searchEverywhere"),
      isEnabled: () => true,
      run: openSearchEverywhere,
    },
    {
      id: "search.text",
      title: "Search Text",
      category: "Search",
      shortcut: shortcut("search.text"),
      isEnabled: (context) => context.hasWorkspace,
      run: openTextSearch,
    },
  ];
}
