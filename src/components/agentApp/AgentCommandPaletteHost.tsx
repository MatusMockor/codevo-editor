import { useCallback, useMemo, useRef, type ComponentProps } from "react";
import type { useAgentPaletteFiles } from "../../application/agentApp/useAgentPaletteFiles";
import type { PaletteBranchSource } from "../../application/commandPalette/commandPaletteProvider";
import type { Command, CommandContext } from "../../application/commandRegistry";
import type { AppearanceSettings } from "../../domain/appearance";
import type { KeymapSettings } from "../../domain/keymap";
import type { NodePackageScript } from "../../domain/nodePackageScripts";
import type { QuickOpenLocation } from "../../domain/quickOpenQuery";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";
import { DeferredSurfaceHost } from "../DeferredSurfaceHost";
import { retryableLazy } from "../retryableLazy";

const LazyCommandPaletteHost = retryableLazy<
  ComponentProps<typeof import("../commandPalette/CommandPaletteHost").CommandPaletteHost>
>(
  () =>
    import("../commandPalette/CommandPaletteHost").then((module) => ({
      default: module.CommandPaletteHost,
    })),
  "command palette",
);

export type AgentPaletteFilesModel = ReturnType<typeof useAgentPaletteFiles>;

export interface AgentCommandPaletteHostProps {
  readonly activateWorkspaceTab: (path: string) => Promise<void>;
  readonly appearance: AppearanceSettings;
  readonly branchSource: PaletteBranchSource | null;
  readonly commandContext: CommandContext;
  readonly commands: readonly Command[];
  readonly files: AgentPaletteFilesModel;
  readonly fileSearch: FileSearchGateway;
  readonly keymap: KeymapSettings;
  readonly nodePackageScripts: readonly NodePackageScript[];
  readonly nodePackageScriptsTruncated: boolean;
  readonly onRevealFile: (path: string, line: number | null) => void;
  readonly open: boolean;
  readonly quickOpenOpen: boolean;
  readonly reportCommandError: (error: unknown) => void;
  readonly saveAppearance: (appearance: AppearanceSettings) => Promise<void>;
  readonly setOpen: (open: boolean) => void;
  readonly setQuickOpenOpen: (open: boolean) => void;
  readonly workspaceRoot: string | null;
  readonly workspaceTabs: readonly string[];
}

export function AgentCommandPaletteHost({
  activateWorkspaceTab,
  appearance,
  branchSource,
  commandContext,
  commands,
  files,
  fileSearch,
  keymap,
  nodePackageScripts,
  nodePackageScriptsTruncated,
  onRevealFile,
  open,
  quickOpenOpen,
  reportCommandError,
  saveAppearance,
  setOpen,
  setQuickOpenOpen,
  workspaceRoot,
  workspaceTabs,
}: AgentCommandPaletteHostProps) {
  const requestedRootRef = useRef(workspaceRoot);
  requestedRootRef.current = workspaceRoot;
  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      if (requestedRootRef.current === null) return;
      onRevealFile(result.path, null);
    },
    [onRevealFile],
  );
  const paletteFiles = useMemo(
    () => ({
      ...files,
      onOpen: (result: FileSearchResult, location?: QuickOpenLocation) => {
        if (requestedRootRef.current === null) return;
        onRevealFile(result.path, location?.line ?? null);
        setOpen(false);
        setQuickOpenOpen(false);
      },
    }),
    [files, onRevealFile, setOpen, setQuickOpenOpen],
  );
  return (
    <DeferredSurfaceHost active={open || quickOpenOpen} fallback={null}>
      <LazyCommandPaletteHost
        activateWorkspaceTab={activateWorkspaceTab}
        appearance={appearance}
        branchSource={branchSource}
        commandContext={commandContext}
        commands={commands}
        files={paletteFiles}
        fileSearch={fileSearch}
        initialQuery=""
        keymap={keymap}
        nodePackageScripts={nodePackageScripts}
        nodePackageScriptsTruncated={nodePackageScriptsTruncated}
        openSearchResult={openSearchResult}
        paletteOpen={open}
        quickOpenOpen={quickOpenOpen}
        reportCommandError={reportCommandError}
        saveAppearance={saveAppearance}
        setPaletteOpen={setOpen}
        setQuickOpenOpen={setQuickOpenOpen}
        workspaceRoot={workspaceRoot}
        workspaceTabs={workspaceTabs}
      />
    </DeferredSurfaceHost>
  );
}
