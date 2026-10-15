export type DiffViewLayout = "unified" | "split";

export const DEFAULT_DIFF_VIEW_LAYOUT: DiffViewLayout = "unified";
export const DEFAULT_DIFF_VIEW_WRAP = false;

export function parseDiffViewLayout(raw: string | null): DiffViewLayout {
  if (raw === "unified" || raw === "split") return raw;
  return DEFAULT_DIFF_VIEW_LAYOUT;
}

export function parseDiffViewWrap(raw: string | null): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_DIFF_VIEW_WRAP;
}

export function encodeDiffViewWrap(wrap: boolean): string {
  return wrap ? "true" : "false";
}
