export type RovingOrientation = "vertical" | "horizontal" | "both";

const NEXT_KEYS: Readonly<Record<RovingOrientation, readonly string[]>> = {
  vertical: ["ArrowDown"],
  horizontal: ["ArrowRight"],
  both: ["ArrowDown", "ArrowRight"],
};

const PREVIOUS_KEYS: Readonly<Record<RovingOrientation, readonly string[]>> = {
  vertical: ["ArrowUp"],
  horizontal: ["ArrowLeft"],
  both: ["ArrowUp", "ArrowLeft"],
};

export function rovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: RovingOrientation,
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (NEXT_KEYS[orientation].includes(key)) return (Math.max(current, -1) + 1) % count;
  if (!PREVIOUS_KEYS[orientation].includes(key)) return null;
  if (current <= 0) return count - 1;
  return current - 1;
}
