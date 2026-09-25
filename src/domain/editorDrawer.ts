import type { WorkbenchBottomPanelView } from "./artisanRoutes";

export type EditorDrawerView = Exclude<WorkbenchBottomPanelView, "terminal">;

export interface WorkbenchPanelPlacement {
  readonly terminal: boolean;
  readonly drawer: EditorDrawerView | null;
}

export interface EditorDrawerAvailability {
  readonly artisan: boolean;
  readonly expressRoutes: boolean;
  readonly javaScriptWorkspace: boolean;
  readonly nette: boolean;
  readonly symfony: boolean;
  readonly phpWorkspace: boolean;
}

export interface EditorDrawerTab {
  readonly view: EditorDrawerView;
  readonly label: string;
  readonly transient: boolean;
}

const HIDDEN: WorkbenchPanelPlacement = Object.freeze({ terminal: false, drawer: null });
const TERMINAL: WorkbenchPanelPlacement = Object.freeze({ terminal: true, drawer: null });
const PRIMARY_VIEWS: ReadonlyArray<EditorDrawerView> = ["problems", "debug"];
const SECONDARY_VIEWS: ReadonlyArray<EditorDrawerView> = [
  "search",
  "testResults",
  "index",
  "runtime",
  "history",
  "routes",
  "expressRoutes",
  "packages",
  "nette",
  "symfony",
  "phpTree",
];

export function workbenchPanelPlacement(
  view: WorkbenchBottomPanelView,
  visible: boolean,
): WorkbenchPanelPlacement {
  if (!visible) return HIDDEN;
  if (view === "terminal") return TERMINAL;
  return { terminal: false, drawer: view };
}

export function editorDrawerViewLabel(view: EditorDrawerView): string {
  switch (view) {
    case "problems":
      return "Problems";
    case "debug":
      return "Debug console";
    case "search":
      return "Search";
    case "testResults":
      return "Tests";
    case "index":
      return "Index";
    case "runtime":
      return "Runtime";
    case "history":
      return "History";
    case "routes":
      return "Routes";
    case "expressRoutes":
      return "Express routes";
    case "packages":
      return "Packages";
    case "nette":
      return "Nette";
    case "symfony":
      return "Symfony";
    case "phpTree":
      return "PHP structure";
    default:
      return unsupportedDrawerView(view);
  }
}

export function editorDrawerViewAvailable(
  view: EditorDrawerView,
  availability: EditorDrawerAvailability,
): boolean {
  switch (view) {
    case "problems":
    case "debug":
    case "search":
    case "index":
    case "runtime":
    case "history":
      return true;
    case "testResults":
      return availability.artisan || availability.phpWorkspace || availability.javaScriptWorkspace;
    case "routes":
      return availability.artisan;
    case "expressRoutes":
      return availability.expressRoutes;
    case "packages":
      return availability.javaScriptWorkspace;
    case "nette":
      return availability.nette;
    case "symfony":
      return availability.symfony;
    case "phpTree":
      return availability.phpWorkspace;
    default:
      return unsupportedDrawerView(view);
  }
}

export function editorDrawerTabs(
  active: EditorDrawerView,
  availability: EditorDrawerAvailability,
): ReadonlyArray<EditorDrawerTab> {
  const primary = PRIMARY_VIEWS.map((view) => drawerTab(view, false));
  if (PRIMARY_VIEWS.includes(active)) return primary;
  if (!editorDrawerViewAvailable(active, availability)) return primary;
  return [...primary, drawerTab(active, true)];
}

export function editorDrawerMoreViews(
  availability: EditorDrawerAvailability,
): ReadonlyArray<EditorDrawerTab> {
  return SECONDARY_VIEWS.filter((view) => editorDrawerViewAvailable(view, availability)).map(
    (view) => drawerTab(view, false),
  );
}

function drawerTab(view: EditorDrawerView, transient: boolean): EditorDrawerTab {
  return { view, label: editorDrawerViewLabel(view), transient };
}

function unsupportedDrawerView(view: never): never {
  throw new TypeError(`Unsupported editor drawer view: ${String(view)}.`);
}
