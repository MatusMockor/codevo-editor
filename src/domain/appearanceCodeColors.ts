import type { ResolvedColorScheme } from "./appearance";

export interface CodeExtraColors {
  readonly gitModified: string;
  readonly match: string;
  readonly matchCurrent: string;
}

export const CODE_EXTRA_COLORS: Readonly<Record<ResolvedColorScheme, CodeExtraColors>> = {
  dark: {
    gitModified: "#6aa8f7",
    match: "rgba(237, 187, 78, 0.16)",
    matchCurrent: "rgba(237, 187, 78, 0.38)",
  },
  light: {
    gitModified: "#2f6bd1",
    match: "rgba(180, 120, 0, 0.14)",
    matchCurrent: "rgba(180, 120, 0, 0.32)",
  },
};
