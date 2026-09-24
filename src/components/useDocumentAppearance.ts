import { useLayoutEffect } from "react";
import {
  COLOR_SCHEME_ATTRIBUTE,
  PALETTE_ATTRIBUTE,
  type PaletteId,
  type ResolvedColorScheme,
} from "../domain/appearance";

export function useDocumentAppearance(palette: PaletteId, colorScheme: ResolvedColorScheme): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    stampChangedAttribute(root, PALETTE_ATTRIBUTE, palette);
    stampChangedAttribute(root, COLOR_SCHEME_ATTRIBUTE, colorScheme);
  }, [colorScheme, palette]);
}

function stampChangedAttribute(root: HTMLElement, name: string, value: string): void {
  if (root.getAttribute(name) === value) return;
  root.setAttribute(name, value);
}
