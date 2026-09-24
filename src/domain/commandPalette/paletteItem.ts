import type { ColorSchemePreference, PaletteId } from "../appearance";
import type { FileSearchResult } from "../workspace";
import { tokenHighlightRanges, type HighlightRange } from "./paletteMatch";
import type { PalettePageId } from "./palettePages";

export type PaletteGlyph =
  | "newThread"
  | "folder"
  | "folderPlus"
  | "fileSearch"
  | "file"
  | "play"
  | "branch"
  | "diff"
  | "terminal"
  | "panelRight"
  | "maximize"
  | "cpu"
  | "palette"
  | "monitor"
  | "sun"
  | "moon"
  | "keyboard"
  | "gear"
  | "message"
  | "command";

export type PaletteIcon =
  | { readonly kind: "glyph"; readonly glyph: PaletteGlyph }
  | { readonly kind: "monogram"; readonly letter: string }
  | { readonly kind: "swatch"; readonly color: string };

export type PaletteTextStyle = "token" | "fuzzy";

export interface PaletteText {
  readonly text: string;
  readonly ranges: readonly HighlightRange[];
  readonly style: PaletteTextStyle;
}

export type PaletteIntent =
  | { readonly kind: "page"; readonly page: PalettePageId }
  | { readonly kind: "command"; readonly commandId: string }
  | { readonly kind: "openThread"; readonly threadId: string }
  | { readonly kind: "newThreadIn"; readonly projectKey: string }
  | { readonly kind: "switchProject"; readonly projectKey: string }
  | { readonly kind: "openFile"; readonly result: FileSearchResult }
  | { readonly kind: "runScript"; readonly scriptKey: string }
  | { readonly kind: "switchBranch"; readonly name: string; readonly remote: boolean }
  | { readonly kind: "selectModel"; readonly modelKey: string }
  | { readonly kind: "setPalette"; readonly palette: PaletteId }
  | { readonly kind: "setColorScheme"; readonly scheme: ColorSchemePreference }
  | { readonly kind: "none" };

export interface PaletteItem {
  readonly key: string;
  readonly intent: PaletteIntent;
  readonly icon: PaletteIcon | null;
  readonly title: PaletteText;
  readonly description: PaletteText | null;
  readonly timestamp: string | null;
  readonly shortcut: string | null;
  readonly current: boolean;
  readonly disabled: boolean;
}

export interface PaletteGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

export function plainText(text: string): PaletteText {
  return { text, ranges: [], style: "token" };
}

export function tokenText(text: string, tokens: readonly string[]): PaletteText {
  return { text, ranges: tokenHighlightRanges(text, tokens), style: "token" };
}

export function paletteGroup(
  key: string,
  label: string,
  items: readonly PaletteItem[],
): PaletteGroup {
  return { key, label, items };
}
