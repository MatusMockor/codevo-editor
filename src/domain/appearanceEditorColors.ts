import type { ResolvedColorScheme } from "./appearance";

export interface EditorExtraColors {
  readonly gitModified: string;
  readonly breakpoint: string;
  readonly match: string;
  readonly matchCurrent: string;
}

export const EDITOR_EXTRA_COLORS: Readonly<Record<ResolvedColorScheme, EditorExtraColors>> = {
  dark: {
    gitModified: "#6aa8f7",
    breakpoint: "#e5534b",
    match: "rgba(237, 187, 78, 0.16)",
    matchCurrent: "rgba(237, 187, 78, 0.38)",
  },
  light: {
    gitModified: "#2f6bd1",
    breakpoint: "#d1242f",
    match: "rgba(180, 120, 0, 0.14)",
    matchCurrent: "rgba(180, 120, 0, 0.32)",
  },
};
