export type BottomPanelView = "index" | "problems" | "history" | "terminal";

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

  return "Problems";
}
