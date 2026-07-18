export type BottomPanelView =
  | "index"
  | "problems"
  | "history"
  | "terminal"
  | "runtime"
  | "debug";

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

  return "Problems";
}
