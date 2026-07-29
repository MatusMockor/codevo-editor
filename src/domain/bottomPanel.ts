export type BottomPanelView =
  | "index"
  | "problems"
  | "history"
  | "terminal"
  | "runtime"
  | "debug"
  | "search"
  | "expressRoutes"
  | "packages"
  | "nette"
  | "symfony";

export function bottomPanelLabel(view: BottomPanelView): string {
  if (view === "index") {
    return "Index";
  }

  if (view === "history") {
    return "History";
  }

  if (view === "terminal") {
    return "Terminal";
  }

  if (view === "runtime") {
    return "Runtime";
  }

  if (view === "debug") {
    return "Debug";
  }

  if (view === "search") {
    return "Search";
  }

  if (view === "expressRoutes") {
    return "Express Routes";
  }

  if (view === "packages") {
    return "Packages";
  }

  if (view === "nette") {
    return "Nette";
  }

  if (view === "symfony") {
    return "Symfony";
  }

  return "Problems";
}
