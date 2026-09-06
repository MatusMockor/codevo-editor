import { Folder, FolderOpen } from "lucide-react";
import { fileTypeGlyphKind } from "../domain/fileTypeGlyph";
import type { FileEntry } from "../domain/workspace";
import { FileTypeGlyph } from "./FileTypeGlyph";

const FOLDER_ICON_SIZE = 16;
const FOLDER_ICON_STROKE = 1.75;

interface TreeEntryIconProps {
  expanded?: boolean;
  kind: FileEntry["kind"];
  name: string;
}

export function TreeEntryIcon({ expanded = false, kind, name }: TreeEntryIconProps) {
  if (kind === "directory") {
    return (
      <span className="tree-entry-icon tree-entry-icon-directory">
        {expanded ? (
          <FolderOpen aria-hidden="true" size={FOLDER_ICON_SIZE} strokeWidth={FOLDER_ICON_STROKE} />
        ) : (
          <Folder aria-hidden="true" size={FOLDER_ICON_SIZE} strokeWidth={FOLDER_ICON_STROKE} />
        )}
      </span>
    );
  }

  return (
    <span className="tree-entry-icon tree-entry-icon-file">
      <FileTypeGlyph kind={fileTypeGlyphKind(name)} />
    </span>
  );
}
