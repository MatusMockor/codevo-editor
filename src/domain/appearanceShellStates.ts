import type { ResolvedColorScheme } from "./appearance";

export interface SchemeShellStates {
  readonly tint1: string;
  readonly tint2: string;
  readonly tint3: string;
  readonly divider: string;
}

export type ShellTintName = "tint1" | "tint2" | "tint3";

export const SHELL_TINT_NAMES: readonly ShellTintName[] = ["tint1", "tint2", "tint3"];

export const SCHEME_SHELL_STATES: Readonly<Record<ResolvedColorScheme, SchemeShellStates>> = {
  dark: {
    tint1: "rgba(255, 255, 255, 0.03)",
    tint2: "rgba(255, 255, 255, 0.05)",
    tint3: "rgba(255, 255, 255, 0.07)",
    divider: "rgba(255, 255, 255, 0.07)",
  },
  light: {
    tint1: "rgba(20, 24, 30, 0.035)",
    tint2: "rgba(20, 24, 30, 0.055)",
    tint3: "rgba(20, 24, 30, 0.09)",
    divider: "rgba(20, 24, 30, 0.12)",
  },
};

export const MAC_TRAFFIC_LIGHTS = {
  x: 20,
  y: 20,
  clusterWidth: 52,
  trailingGap: 12,
} as const;

export function macTrafficLightInset(): number {
  return MAC_TRAFFIC_LIGHTS.x + MAC_TRAFFIC_LIGHTS.clusterWidth + MAC_TRAFFIC_LIGHTS.trailingGap;
}

const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

export function compositeOver(overlay: string, backdrop: string): string {
  const trimmed = overlay.trim();
  if (HEX6.test(trimmed)) return trimmed;
  const match = RGBA.exec(trimmed);
  if (match === null) throw new TypeError(`Unsupported overlay colour: ${overlay}`);
  const alpha = Number(match[4]);
  const below = hexChannels(backdrop);
  const above = [match[1], match[2], match[3]].map((channel) => Number(channel));
  const mixed = above.map((channel, index) =>
    Math.round(channel * alpha + (below[index] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexChannels(value: string): readonly number[] {
  const match = HEX6.exec(value.trim());
  if (match === null) throw new TypeError(`Expected a six-digit hex backdrop, received ${value}`);
  return [match[1], match[2], match[3]].map((channel) => Number.parseInt(channel ?? "0", 16));
}
