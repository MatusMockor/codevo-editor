import type { PaletteText } from "../../domain/commandPalette/paletteItem";

export function PaletteHighlight({ text }: { readonly text: PaletteText }) {
  if (text.ranges.length === 0) return <>{text.text}</>;
  const parts = [];
  let cursor = 0;
  for (const range of text.ranges) {
    if (range.start > cursor) parts.push(text.text.slice(cursor, range.start));
    const hit = text.text.slice(range.start, range.end);
    parts.push(
      text.style === "fuzzy" ? (
        <b key={range.start}>{hit}</b>
      ) : (
        <mark key={range.start}>{hit}</mark>
      ),
    );
    cursor = range.end;
  }
  if (cursor < text.text.length) parts.push(text.text.slice(cursor));
  return <span className={text.style === "fuzzy" ? "cv-palette-fuzzy" : undefined}>{parts}</span>;
}
