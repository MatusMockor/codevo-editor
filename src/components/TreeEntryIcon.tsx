import { FileCode2, Folder, FolderOpen } from "lucide-react";
import type { FileEntry } from "../domain/workspace";

interface TreeEntryIconProps {
  expanded?: boolean;
  kind: FileEntry["kind"];
}

export function TreeEntryIcon({ expanded = false, kind }: TreeEntryIconProps) {
  if (kind === "directory") {
    return (
      <span className="tree-entry-icon tree-entry-icon-directory">
        {expanded ? (
          <FolderOpen aria-hidden="true" size={16} />
        ) : (
          <Folder aria-hidden="true" size={16} />
        )}
      </span>
    );
  }

  return (
    <span className="tree-entry-icon tree-entry-icon-file">
      <FileCode2 aria-hidden="true" size={16} />
    </span>
  );
}
