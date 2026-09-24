import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { availablePaletteActions } from "../../application/commandPalette/commandPaletteActions";
import { workbenchCommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import {
  workbenchAgentPaletteProvider,
  workbenchComposerPaletteModels,
  type PaletteBranchSource,
} from "../../application/commandPalette/commandPaletteProvider";
import { editorPaletteIntentPorts } from "../../application/commandPalette/editorPaletteIntentPorts";
import { executePaletteIntent } from "../../application/commandPalette/executePaletteIntent";
import { usePaletteBranches } from "../../application/commandPalette/usePaletteBranches";
import { usePaletteRootFiles } from "../../application/commandPalette/usePaletteRootFiles";
import type { Command, CommandContext } from "../../application/commandRegistry";
import { usePrefersLightTheme } from "../../application/usePrefersLightTheme";
import {
  resolveColorScheme,
  type AppearanceSettings,
  type ColorSchemePreference,
  type PaletteId,
} from "../../domain/appearance";
import type { PaletteItem } from "../../domain/commandPalette/paletteItem";
import { palettePageCopy, type PalettePageId } from "../../domain/commandPalette/palettePages";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import {
  detectKeymapPlatform,
  isKeymapCommandId,
  matchesShortcut,
  shortcutForCommand,
  type KeymapSettings,
} from "../../domain/keymap";
import type { NodePackageScript } from "../../domain/nodePackageScripts";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";
import { CommandSurface } from "../../ui/foundation/CommandList";
import { QuickOpen } from "../QuickOpen";
import { buildPaletteGroups } from "./commandPalettePresenter";
import { CommandPalettePage } from "./CommandPalettePage";
import { editorPaletteProjects, editorPaletteScripts } from "./editorPaletteSources";
import { formatShortcutLabel, paletteShortcutGroups } from "./paletteShortcuts";
import { useCommandPaletteSession } from "./useCommandPaletteSession";
import type { ComponentProps } from "react";

const UNAVAILABLE_BRANCHES = "Branch switching for this project is not available here.";
const LOCAL_PALETTE_PAGES: ReadonlyMap<string, PalettePageId> = new Map([
  ["palette.open", "root"],
  ["palette.shortcuts", "shortcuts"],
]);

export type QuickOpenPageProps = Omit<
  ComponentProps<typeof QuickOpen>,
  "canGoBack" | "onBack" | "groupLabel" | "onLocalShortcut" | "isOpen" | "onClose"
>;

export interface CommandPaletteHostProps {
  readonly paletteOpen: boolean;
  readonly quickOpenOpen: boolean;
  readonly initialQuery: string;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  readonly commands: readonly Command[];
  readonly commandContext: CommandContext;
  reportCommandError(error: unknown): void;
  readonly keymap: KeymapSettings;
  readonly appearance: AppearanceSettings;
  saveAppearance(next: AppearanceSettings): Promise<void>;
  readonly workspaceRoot: string | null;
  readonly workspaceTabs: readonly string[];
  activateWorkspaceTab(path: string): Promise<void>;
  readonly nodePackageScripts: readonly NodePackageScript[];
  readonly nodePackageScriptsTruncated: boolean;
  readonly branchSource: PaletteBranchSource | null;
  readonly fileSearch: FileSearchGateway;
  openSearchResult(result: FileSearchResult): Promise<void>;
  readonly agentModeActive: boolean;
  readonly quickOpen: QuickOpenPageProps | null;
}

export function CommandPaletteHost(props: CommandPaletteHostProps) {
  const session = useCommandPaletteSession({
    paletteOpen: props.paletteOpen,
    quickOpenOpen: props.quickOpenOpen,
    initialQuery: props.initialQuery,
    launch: workbenchCommandPaletteLaunch,
    setPaletteOpen: props.setPaletteOpen,
    setQuickOpenOpen: props.setQuickOpenOpen,
  });
  const openedRoot = useRef(props.workspaceRoot);
  const { close } = session;

  useEffect(() => {
    if (!session.visible) {
      openedRoot.current = props.workspaceRoot;
      return;
    }
    if (openedRoot.current === props.workspaceRoot) return;
    openedRoot.current = props.workspaceRoot;
    close();
  }, [close, props.workspaceRoot, session.visible]);

  if (!session.visible) return null;
  return (
    <CommandSurface label="Command palette" onClose={close}>
      <CommandPaletteBody {...props} session={session} />
    </CommandSurface>
  );
}

function CommandPaletteBody(
  props: CommandPaletteHostProps & {
    readonly session: ReturnType<typeof useCommandPaletteSession>;
  },
) {
  const { session } = props;
  const platform = detectKeymapPlatform();
  const agentPublished = useSyncExternalStore(
    workbenchAgentPaletteProvider.subscribe,
    workbenchAgentPaletteProvider.current,
  );
  const modelsPublished = useSyncExternalStore(
    workbenchComposerPaletteModels.subscribe,
    workbenchComposerPaletteModels.current,
  );
  const agent = props.agentModeActive ? agentPublished : null;
  const models = props.agentModeActive ? modelsPublished : null;
  const prefersLight = usePrefersLightTheme();
  const pending = useRef<object | null>(null);
  useEffect(() => {
    const slot = pending;
    return () => {
      slot.current = null;
    };
  }, []);
  const [nowMs] = useState(() => Date.now());
  const commandsById = useMemo(
    () => new Map(props.commands.map((command) => [command.id, command])),
    [props.commands],
  );
  const commandEnabled = useCallback(
    (command: Command) => {
      try {
        return command.isEnabled(props.commandContext);
      } catch {
        return false;
      }
    },
    [props.commandContext],
  );
  const commandState = useCallback(
    (id: string) => {
      const command = commandsById.get(id);
      if (command === undefined) return "missing" as const;
      return commandEnabled(command) ? ("enabled" as const) : ("disabled" as const);
    },
    [commandEnabled, commandsById],
  );
  const branchSource = useMemo(() => {
    if (props.branchSource === null) return null;
    if (agent === null) return props.branchSource;
    const active = agent.projects.find((project) => project.key === agent.activeProjectKey);
    if (active === undefined || active.path !== props.workspaceRoot) return null;
    return props.branchSource;
  }, [agent, props.branchSource, props.workspaceRoot]);
  const rootSearch =
    session.page === "root" && parsePaletteRootQuery(session.query).kind === "search";
  const rootFiles = usePaletteRootFiles({
    gateway: props.fileSearch,
    root: props.workspaceRoot,
    query: session.query,
    enabled: rootSearch,
  });
  const branches = usePaletteBranches({
    source: branchSource,
    enabled: session.page === "switchBranch" || rootSearch,
    unavailableReason: UNAVAILABLE_BRANCHES,
  });
  const actions = useMemo(
    () =>
      availablePaletteActions({
        commandState,
        agentProvider: agent !== null,
        composerModels: models !== null,
      }),
    [agent, commandState, models],
  );
  const shortcutGroups = useMemo(
    () => paletteShortcutGroups(props.keymap, platform),
    [platform, props.keymap],
  );
  const groups = useMemo(
    () =>
      buildPaletteGroups({
        page: session.page,
        query: session.query,
        actions,
        commands: props.commands,
        commandEnabled,
        agent,
        editorProjects: editorPaletteProjects(props.workspaceTabs, props.workspaceRoot),
        editorScripts: editorPaletteScripts(
          props.nodePackageScripts,
          (id) => commandState(id) === "enabled",
        ),
        editorScriptsTruncated: props.nodePackageScriptsTruncated,
        rootFiles,
        branches,
        models,
        appearance: props.appearance,
        resolvedScheme: resolveColorScheme(props.appearance.colorScheme, prefersLight),
        shortcutGroups,
        nowMs,
        canAddProject: commandState("project.add") === "enabled",
        shortcutLabel: (id) =>
          formatShortcutLabel(
            isKeymapCommandId(id) ? shortcutForCommand(props.keymap, id, platform) : "",
            platform,
          ),
        rawShortcutLabel: (shortcut) => formatShortcutLabel(shortcut, platform),
      }),
    [
      actions,
      agent,
      branches,
      commandEnabled,
      commandState,
      models,
      nowMs,
      platform,
      prefersLight,
      props.appearance,
      props.commands,
      props.keymap,
      props.nodePackageScripts,
      props.nodePackageScriptsTruncated,
      props.workspaceRoot,
      props.workspaceTabs,
      rootFiles,
      session.page,
      session.query,
      shortcutGroups,
    ],
  );

  const onLocalShortcut = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    const native = event.nativeEvent;
    if (
      matchesShortcut(native, shortcutForCommand(props.keymap, "palette.open", platform), platform)
    ) {
      event.preventDefault();
      event.stopPropagation();
      session.close();
      return true;
    }
    if (
      matchesShortcut(
        native,
        shortcutForCommand(props.keymap, "file.quickOpen", platform),
        platform,
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (session.page === "files") {
        session.close();
        return true;
      }
      session.push("files");
      return true;
    }
    if (
      !matchesShortcut(
        native,
        shortcutForCommand(props.keymap, "palette.shortcuts", platform),
        platform,
      )
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    session.push("shortcuts");
    return true;
  };

  const execute = (item: PaletteItem): void => {
    if (item.intent.kind === "page") {
      session.push(item.intent.page);
      return;
    }
    if (item.intent.kind === "command" && openLocalPalettePage(item.intent.commandId)) return;
    if (pending.current !== null) return;
    const token = {};
    pending.current = token;
    const commands = { get: (id: string) => commandsById.get(id) };
    void executePaletteIntent(item.intent, {
      commands,
      context: props.commandContext,
      agent,
      models,
      openFile: props.openSearchResult,
      ...editorPaletteIntentPorts({
        commands,
        context: props.commandContext,
        workspaceTabs: props.workspaceTabs,
        branchSource,
        activateWorkspaceTab: props.activateWorkspaceTab,
      }),
      setPalette: (palette: PaletteId) => props.saveAppearance({ ...props.appearance, palette }),
      setColorScheme: (colorScheme: ColorSchemePreference) =>
        props.saveAppearance({ ...props.appearance, colorScheme }),
    })
      .then((outcome) => {
        if (pending.current !== token) return;
        if (outcome === "close") session.close();
        if (outcome === "failed")
          props.reportCommandError(new Error(`"${item.title.text}" is no longer available.`));
      })
      .catch((error: unknown) => {
        props.reportCommandError(error);
      })
      .finally(() => {
        if (pending.current === token) pending.current = null;
      });
  };

  const openLocalPalettePage = (commandId: string): boolean => {
    const target = LOCAL_PALETTE_PAGES.get(commandId);
    if (target === undefined) return false;
    session.open(target, "");
    return true;
  };

  const setRootQuery = (query: string): void => {
    const parsed = parsePaletteRootQuery(query);
    if (session.page === "root" && parsed.kind === "files") {
      session.push("files");
      props.quickOpen?.onChangeQuery(parsed.text);
      return;
    }
    session.setQuery(query);
  };

  if (session.page === "files") {
    if (props.quickOpen === null) return null;
    return (
      <QuickOpen
        {...props.quickOpen}
        canGoBack={session.canGoBack}
        groupLabel={props.workspaceRoot === null ? "Files" : folderLabel(props.workspaceRoot)}
        isOpen
        onBack={session.pop}
        onClose={session.close}
        onLocalShortcut={onLocalShortcut}
      />
    );
  }
  return (
    <CommandPalettePage
      canGoBack={session.canGoBack}
      copy={palettePageCopy(session.page, session.query.startsWith(">"))}
      generation={session.generation}
      groups={groups}
      onBack={session.pop}
      onExecute={execute}
      onLocalShortcut={onLocalShortcut}
      onQueryChange={setRootQuery}
      page={session.page}
      query={session.query}
    />
  );
}

function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}
