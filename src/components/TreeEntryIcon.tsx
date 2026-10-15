import { fileTypeGlyphKind } from "../domain/fileTypeGlyph";
import { FileTypeGlyph } from "./FileTypeGlyph";

interface TreeEntryIconProps {
  name: string;
}

export function TreeEntryIcon({ name }: TreeEntryIconProps) {
  return (
    <span className="tree-entry-icon tree-entry-icon-file">
      <FileTypeGlyph kind={fileTypeGlyphKind(name)} />
    </span>
  );
}
