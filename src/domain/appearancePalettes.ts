import type { PaletteId, ResolvedColorScheme } from "./appearance";
import { PALETTE_VALUES } from "./appearancePaletteValues";

export interface PaletteTokens {
  readonly bgPage: string;
  readonly s0: string;
  readonly s1: string;
  readonly s2: string;
  readonly s3: string;
  readonly s4: string;
  readonly popBg: string;
  readonly hair: string;
  readonly hairStrong: string;
  readonly fgStrong: string;
  readonly fg: string;
  readonly fgMuted: string;
  readonly fgSubtle: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentFill: string;
  readonly onAccent: string;
  readonly accentSoft: string;
  readonly focus: string;
  readonly selection: string;
  readonly ok: string;
  readonly danger: string;
  readonly warn: string;
  readonly warnSoft: string;
  readonly addBg: string;
  readonly addGutter: string;
  readonly delBg: string;
  readonly delGutter: string;
  readonly synKw: string;
  readonly synStr: string;
  readonly synNum: string;
  readonly synCom: string;
}

export interface PaletteDefinition {
  readonly dark: PaletteTokens;
  readonly light: PaletteTokens;
}

export type PaletteTokenName = keyof PaletteTokens;

export const PALETTE_TOKEN_NAMES: readonly PaletteTokenName[] = [
  "bgPage",
  "s0",
  "s1",
  "s2",
  "s3",
  "s4",
  "popBg",
  "hair",
  "hairStrong",
  "fgStrong",
  "fg",
  "fgMuted",
  "fgSubtle",
  "accent",
  "accentStrong",
  "accentFill",
  "onAccent",
  "accentSoft",
  "focus",
  "selection",
  "ok",
  "danger",
  "warn",
  "warnSoft",
  "addBg",
  "addGutter",
  "delBg",
  "delGutter",
  "synKw",
  "synStr",
  "synNum",
  "synCom",
];

export type SurfaceStep = "s0" | "s1" | "s2" | "s3" | "s4" | "popBg";
export type SurfaceRole = "canvas" | "side" | "raised" | "popover";

export const SCHEME_SURFACE_ROLES: Readonly<
  Record<ResolvedColorScheme, Readonly<Record<SurfaceRole, SurfaceStep>>>
> = {
  dark: { canvas: "s0", side: "s1", raised: "s2", popover: "popBg" },
  light: { canvas: "s1", side: "s0", raised: "s2", popover: "popBg" },
};

export function paletteTokens(palette: PaletteId, scheme: ResolvedColorScheme): PaletteTokens {
  return PALETTE_VALUES[palette][scheme];
}

export function surfaceColor(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  role: SurfaceRole,
): string {
  return paletteTokens(palette, scheme)[SCHEME_SURFACE_ROLES[scheme][role]];
}

export function cssTokenName(name: PaletteTokenName): string {
  return `--cv-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
