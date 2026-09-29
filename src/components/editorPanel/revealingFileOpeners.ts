import type { FileEntry } from "../../domain/workspace";
import { openThenRevealFiles } from "../agentMode/openThenRevealFiles";

export interface EditorFileOpeners {
  openPinnedFile(entry: FileEntry): Promise<boolean>;
  previewFile(entry: FileEntry): Promise<boolean>;
}

export interface RevealingFileOpeners {
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): Promise<boolean>;
  revealEditor(): void;
}

export function revealingFileOpeners(
  openers: EditorFileOpeners,
  reveal: () => void,
): RevealingFileOpeners {
  return {
    onOpenFile: (entry) => void openThenRevealFiles(() => openers.openPinnedFile(entry), reveal),
    onPreviewFile: (entry) => openers.previewFile(entry),
    revealEditor: reveal,
  };
}
