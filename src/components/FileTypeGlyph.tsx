import { Braces, Container, File, GitBranch, Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { FileTypeGlyphKind } from "../domain/fileTypeGlyph";

const GLYPH_ICON_SIZE = 14;
const GLYPH_ICON_STROKE = 1.75;

interface FileTypeGlyphProps {
  kind: FileTypeGlyphKind;
}

export function FileTypeGlyph({ kind }: FileTypeGlyphProps) {
  return (
    <span aria-hidden="true" className={`file-glyph file-glyph--${kind}`}>
      {glyphContent(kind)}
    </span>
  );
}

function glyphContent(kind: FileTypeGlyphKind): ReactNode {
  switch (kind) {
    case "ts":
      return "TS";
    case "tsx":
      return "TX";
    case "js":
      return "JS";
    case "npm":
      return "n";
    case "md":
      return "M↓";
    case "css":
      return "#";
    case "sh":
      return "$_";
    case "env":
      return ".e";
    case "json":
      return <Braces aria-hidden="true" size={GLYPH_ICON_SIZE} strokeWidth={GLYPH_ICON_STROKE} />;
    case "docker":
      return (
        <Container aria-hidden="true" size={GLYPH_ICON_SIZE} strokeWidth={GLYPH_ICON_STROKE} />
      );
    case "git":
      return (
        <GitBranch aria-hidden="true" size={GLYPH_ICON_SIZE} strokeWidth={GLYPH_ICON_STROKE} />
      );
    case "lock":
      return <Lock aria-hidden="true" size={GLYPH_ICON_SIZE} strokeWidth={GLYPH_ICON_STROKE} />;
    case "file":
      return <File aria-hidden="true" size={GLYPH_ICON_SIZE} strokeWidth={GLYPH_ICON_STROKE} />;
    default:
      return exhaustiveGlyph(kind);
  }
}

function exhaustiveGlyph(kind: never): never {
  throw new Error(`Unsupported file glyph kind: ${String(kind)}`);
}
