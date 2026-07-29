import type { OpenEditorMruEntry } from "../application/useOpenEditorsMru";
import { MruEntriesOverlay } from "./RecentFilesSwitcher";

interface OpenEditorsSwitcherProps {
  readonly activeIndex: number;
  readonly entries: readonly OpenEditorMruEntry[];
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onSelect: (path: string) => void;
}

export function OpenEditorsSwitcher({
  activeIndex,
  entries,
  isOpen,
  onCancel,
  onSelect,
}: OpenEditorsSwitcherProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <MruEntriesOverlay
      activeIndex={activeIndex}
      ariaLabel="Open editors"
      emptyLabel="No open editors"
      entries={entries}
      heading="Open Editors"
      footer={
        <div aria-hidden="true" className="palette-footer">
          <span>
            <kbd>ctrl</kbd>
            <kbd>tab</kbd>
            cycle
          </span>
          <span>release ctrl to open</span>
          <span>
            <kbd>esc</kbd>
            cancel
          </span>
        </div>
      }
      onBackdrop={onCancel}
      onEntry={(entry) => onSelect(entry.path)}
    />
  );
}
