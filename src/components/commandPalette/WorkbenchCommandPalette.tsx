import { useMemo, useRef } from "react";
import { openPaletteFile } from "../../application/commandPalette/openPaletteFile";
import type { useWorkbenchController } from "../../application/useWorkbenchController";
import type { FileSearchGateway } from "../../domain/workspace";
import { CommandPaletteHost, type CommandPaletteHostProps } from "./CommandPaletteHost";
import { editorBranchSource, type EditorBranchListing } from "./editorPaletteSources";

type Workbench = ReturnType<typeof useWorkbenchController>;

function useCommandPaletteHostProps(
  workbench: Workbench,
  fileSearch: FileSearchGateway,
  gitGateway: EditorBranchListing,
): CommandPaletteHostProps {
  const latest = useRef(workbench);
  latest.current = workbench;
  const current = () => latest.current;
  const root = workbench.workspaceRoot;
  const branchSource = useMemo(
    () =>
      root === null
        ? null
        : editorBranchSource({
            root,
            listing: gitGateway,
            switchGitBranch: (name) => latest.current.switchGitBranch(name),
            checkoutRemoteBranch: (name) => latest.current.checkoutRemoteBranch(name),
          }),
    [gitGateway, root],
  );
  return {
    paletteOpen: workbench.paletteOpen,
    quickOpenOpen: workbench.quickOpenOpen,
    initialQuery: workbench.commandPaletteInitialQuery,
    setPaletteOpen: workbench.setPaletteOpen,
    setQuickOpenOpen: workbench.setQuickOpenOpen,
    commands: workbench.commands,
    commandContext: workbench.commandContext,
    reportCommandError: workbench.reportCommandError,
    keymap: workbench.appSettings.keymap,
    appearance: workbench.appSettings.appearance,
    saveAppearance: async (appearance) => {
      const current = latest.current;
      await current.saveWorkbenchSettings(
        { ...current.appSettings, appearance },
        current.workspaceSettings,
        current.workspaceTrust?.trusted ?? null,
      );
    },
    workspaceRoot: root,
    workspaceTabs: workbench.workspaceTabs,
    activateWorkspaceTab: workbench.activateWorkspaceTab,
    nodePackageScripts: workbench.nodePackageScripts.scripts,
    nodePackageScriptsTruncated: workbench.nodePackageScripts.truncated === true,
    branchSource,
    fileSearch,
    openSearchResult: (result) => openPaletteFile(current, result),
    agentModeActive: workbench.agentModeActive,
    quickOpen: {
      isLoading: workbench.quickOpenLoading,
      isTruncated: workbench.quickOpenTruncated,
      onChangeQuery: workbench.setQuickOpenQuery,
      onOpen: (result, location) => void openPaletteFile(current, result, location),
      onOpenCurrentFileLocation: workbench.openCurrentFileLocation,
      query: workbench.quickOpenQuery,
      request: workbench.quickOpenRequest,
      results: workbench.quickOpenResults,
    },
  };
}

export function WorkbenchCommandPalette({
  fileSearch,
  gitGateway,
  workbench,
}: {
  readonly workbench: Workbench;
  readonly fileSearch: FileSearchGateway;
  readonly gitGateway: EditorBranchListing;
}) {
  const props = useCommandPaletteHostProps(workbench, fileSearch, gitGateway);
  return <CommandPaletteHost {...props} />;
}
