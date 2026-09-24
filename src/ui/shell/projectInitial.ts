const MAX_INITIAL_SCAN = 8;

export function projectInitial(label: string): string {
  const first = Array.from(label.trim().slice(0, MAX_INITIAL_SCAN))[0];
  if (first === undefined) return "?";
  return first.toLocaleUpperCase();
}
