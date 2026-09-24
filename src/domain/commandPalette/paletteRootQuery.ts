export type PaletteRootQuery =
  | { readonly kind: "empty" }
  | { readonly kind: "files"; readonly text: string }
  | { readonly kind: "actions"; readonly text: string }
  | { readonly kind: "search"; readonly text: string };

export function parsePaletteRootQuery(raw: string): PaletteRootQuery {
  if (raw.startsWith("@")) return { kind: "files", text: raw.slice(1) };
  if (raw.startsWith(">")) return { kind: "actions", text: raw.slice(1) };
  if (raw.trim() === "") return { kind: "empty" };
  return { kind: "search", text: raw };
}
