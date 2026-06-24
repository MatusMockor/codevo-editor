import type { SystemFontGateway } from "../domain/systemFonts";

interface LocalFontData {
  family: string;
}

type LocalFontQueryGlobal = typeof globalThis & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

type TextWidthMeasurer = (fontFamily: string, text: string) => number;

let cachedMeasureContext: CanvasRenderingContext2D | null | undefined;

const defaultTextWidthMeasurer: TextWidthMeasurer = (fontFamily, text) => {
  if (cachedMeasureContext === undefined) {
    cachedMeasureContext = document.createElement("canvas").getContext("2d");
  }

  if (!cachedMeasureContext) {
    return 0;
  }

  cachedMeasureContext.font = `16px ${cssFontFamily(fontFamily)}, monospace`;
  return cachedMeasureContext.measureText(text).width;
};

export class BrowserSystemFontGateway implements SystemFontGateway {
  constructor(
    private readonly queryLocalFonts = (globalThis as LocalFontQueryGlobal)
      .queryLocalFonts,
    private readonly measureTextWidth: TextWidthMeasurer =
      defaultTextWidthMeasurer,
  ) {}

  async listMonospaceFontFamilies(): Promise<string[]> {
    if (typeof this.queryLocalFonts !== "function" || typeof document === "undefined") {
      return [];
    }

    const localFonts = await this.queryLocalFonts();
    const fontFamilies = localFonts
      .map((font) => font.family.trim())
      .filter(Boolean)
      .filter((fontFamily) =>
        isMonospaceFontFamily(fontFamily, this.measureTextWidth),
      );

    return uniqueSortedStrings(fontFamilies);
  }
}

function isMonospaceFontFamily(
  fontFamily: string,
  measureTextWidth: TextWidthMeasurer,
): boolean {
  const narrowWidth = measureTextWidth(fontFamily, "iiiiiiiiii");
  const wideWidth = measureTextWidth(fontFamily, "WWWWWWWWWW");

  return Math.abs(narrowWidth - wideWidth) < 0.01;
}

function cssFontFamily(fontFamily: string): string {
  return JSON.stringify(fontFamily);
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}
