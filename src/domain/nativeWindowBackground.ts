import { surfaceColor } from "./appearancePalettes";
import type { DocumentAppearance } from "./startupTheme";

export function nativeWindowBackground(appearance: DocumentAppearance): string {
  return surfaceColor(appearance.palette, appearance.colorScheme, "side");
}
