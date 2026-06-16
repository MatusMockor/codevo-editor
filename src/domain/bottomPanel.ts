export type BottomPanelView = "problems" | "terminal";

export function bottomPanelLabel(view: BottomPanelView): string {
  if (view === "terminal") {
    return "Terminal";
  }

  return "Problems";
}
