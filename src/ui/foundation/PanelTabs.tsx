import { X } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./classNames";
import { rovingIndex } from "./roving";
import "./panels.css";

export interface PanelTabItem {
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly panelId: string;
  readonly dirty?: boolean;
  readonly preview?: boolean;
  readonly live?: boolean;
  readonly closable?: boolean;
}

export interface PanelTabsProps {
  readonly label: string;
  readonly tabs: ReadonlyArray<PanelTabItem>;
  readonly selectedId: string | null;
  onSelect(id: string): void;
  onClose?(id: string): void;
}

export function PanelTabs({ label, onClose, onSelect, selectedId, tabs }: PanelTabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Delete") {
      const selected = tabs[selectedIndex];
      if (selected === undefined || onClose === undefined || selected.closable === false) return;
      event.preventDefault();
      onClose(selected.id);
      return;
    }
    const next = rovingIndex(event.key, selectedIndex, tabs.length, "horizontal");
    if (next === null) return;
    const tab = tabs[next];
    if (tab === undefined) return;
    event.preventDefault();
    onSelect(tab.id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      aria-label={label}
      className="cv-tabs"
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === selectedId;
        const tabbable = selected || (selectedIndex < 0 && index === 0);
        const closable = onClose !== undefined && tab.closable !== false;
        return (
          <div
            aria-controls={tab.panelId}
            aria-keyshortcuts={closable ? "Delete" : undefined}
            aria-selected={selected}
            className={cx(
              "cv-tab",
              tab.preview === true && "cv-tab--preview",
              closable && "cv-tab--closable",
            )}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            tabIndex={tabbable ? 0 : -1}
            title={tab.title}
          >
            <span className="cv-tab__icon">
              <span aria-hidden="true" className="cv-tab__glyph">
                {tab.icon}
              </span>
              {onClose === undefined || tab.closable === false ? null : (
                <span
                  aria-hidden="true"
                  className="cv-tab__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  title={`Close ${tab.title}`}
                >
                  <X size={12} />
                </span>
              )}
              {tab.dirty === true ? (
                <span aria-label="Unsaved changes" className="cv-tab__dirty" role="img" />
              ) : null}
              {tab.live === true ? (
                <span aria-label="Running" className="cv-tab__live" role="img" />
              ) : null}
            </span>
            <span className="cv-tab__title">{tab.title}</span>
          </div>
        );
      })}
    </div>
  );
}
