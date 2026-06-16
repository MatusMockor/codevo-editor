export type BottomPanelView = "index" | "problems" | "terminal";

export function bottomPanelLabel(view: BottomPanelView): string {
  if (view === "index") {
    return "Index";
  }

  if (view === "terminal") {
    return "Terminal";
  }

  return "Problems";
}
