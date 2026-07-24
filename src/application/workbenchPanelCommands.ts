import type { BottomPanelView } from "../domain/bottomPanel";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchPanelCommandsOptions {
  canShowExpressRoutes?: boolean;
  canShowNette?: boolean;
  canShowSymfony?: boolean;
  openExpressRoutesPanel?: Command["run"];
  shortcut(commandId: KeymapCommandId): string;
  openCommandsPalette: Command["run"];
  showBottomPanelView(view: BottomPanelView): void;
  toggleBottomPanel: Command["run"];
  toggleTodoPanel: Command["run"];
  refreshWorkspaceTodos: () => void | Promise<void>;
}

export function workbenchPanelCommands({
  canShowExpressRoutes = false,
  canShowNette = false,
  canShowSymfony = false,
  openExpressRoutesPanel = () => undefined,
  shortcut,
  openCommandsPalette,
  showBottomPanelView,
  toggleBottomPanel,
  toggleTodoPanel,
  refreshWorkspaceTodos,
}: WorkbenchPanelCommandsOptions): Command[] {
  return [
    {
      id: "commands.show",
      title: "Show Commands",
      category: "Workbench",
      shortcut: shortcut("commands.show"),
      isEnabled: () => true,
      run: openCommandsPalette,
    },
    {
      id: "panel.showProblems",
      title: "Show Problems",
      category: "Workbench",
      isEnabled: () => true,
      run: () => showBottomPanelView("problems"),
    },
    {
      id: "panel.showIndex",
      title: "Show Index",
      category: "Index",
      isEnabled: () => true,
      run: () => showBottomPanelView("index"),
    },
    {
      id: "panel.showExpressRoutes",
      title: "Show Express Routes",
      category: "Workbench",
      isEnabled: (context) => context.hasWorkspace && canShowExpressRoutes,
      run: openExpressRoutesPanel,
    },
    {
      id: "panel.showNette",
      title: "Show Nette",
      category: "PHP",
      isEnabled: (context) => context.hasWorkspace && canShowNette,
      run: () => showBottomPanelView("nette"),
    },
    {
      id: "panel.showSymfony",
      title: "Show Symfony",
      category: "PHP",
      isEnabled: (context) => context.hasWorkspace && canShowSymfony,
      run: () => showBottomPanelView("symfony"),
    },
    {
      id: "panel.toggle",
      title: "Toggle Panel",
      category: "Workbench",
      shortcut: shortcut("panel.toggle"),
      isEnabled: () => true,
      run: toggleBottomPanel,
    },
    {
      id: "panel.toggleTodo",
      title: "Toggle TODO Panel",
      category: "Workbench",
      shortcut: shortcut("panel.toggleTodo"),
      isEnabled: (context) => context.hasWorkspace,
      run: toggleTodoPanel,
    },
    {
      id: "panel.refreshTodo",
      title: "Refresh TODO Comments",
      category: "Workbench",
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void refreshWorkspaceTodos();
      },
    },
    {
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: shortcut("terminal.show"),
      isEnabled: () => true,
      run: () => showBottomPanelView("terminal"),
    },
    {
      id: "runtime.show",
      title: "Show Runtime Panel",
      category: "Workbench",
      shortcut: shortcut("runtime.show"),
      isEnabled: () => true,
      run: () => showBottomPanelView("runtime"),
    },
  ];
}
