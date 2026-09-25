import { ChevronDown, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  editorDrawerMoreViews,
  editorDrawerTabs,
  editorDrawerViewLabel,
  type EditorDrawerAvailability,
  type EditorDrawerView,
} from "../../domain/editorDrawer";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { ResizeHandle } from "../../ui/foundation/ResizeHandle";
import { rovingIndex } from "../../ui/foundation/roving";
import { activeEditorFocusRestorer, isDrawerEscape } from "./editorDrawerEscape";
import { EditorDrawerExtrasContext } from "./EditorDrawerExtrasContext";
import { MAX_EDITOR_DRAWER_HEIGHT, MIN_EDITOR_DRAWER_HEIGHT } from "./editorDrawerSize";
import "./editorDrawer.css";

export interface EditorDrawerProps {
  readonly view: EditorDrawerView;
  readonly availability: EditorDrawerAvailability;
  readonly problemCount: number;
  readonly headerExtras: ReactNode;
  readonly height: number;
  readonly children: ReactNode;
  onSelectView(view: EditorDrawerView): void;
  onClose(): void;
  onResize(height: number): void;
}

export function EditorDrawer(props: EditorDrawerProps) {
  const { children, headerExtras, height, onClose, onResize, view } = props;
  const [extrasHost, setExtrasHost] = useState<HTMLDivElement | null>(null);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!isDrawerEscape(event)) return;
    event.preventDefault();
    const restoreEditorFocus = activeEditorFocusRestorer(event.currentTarget);
    onClose();
    restoreEditorFocus();
  };
  return (
    <section
      aria-label="Panel views"
      className="cv-edrawer"
      data-view={view}
      onKeyDown={handleKeyDown}
      style={{ height: `${height}px` }}
    >
      <ResizeHandle
        axis="y"
        edge="start"
        label="Resize panel views"
        max={MAX_EDITOR_DRAWER_HEIGHT}
        min={MIN_EDITOR_DRAWER_HEIGHT}
        onChange={onResize}
        value={height}
      />
      <div className="cv-edrawer__head">
        <EditorDrawerTabList {...props} />
        <EditorDrawerMoreViews {...props} />
        <div className="cv-edrawer__end">
          <div className="cv-edrawer__extras" ref={setExtrasHost} />
          {headerExtras}
          <IconButton
            icon={<X size={14} />}
            label="Close panel views"
            onClick={onClose}
            size="xs"
            title="Close"
          />
        </div>
      </div>
      <div aria-label={editorDrawerViewLabel(view)} className="cv-edrawer__body" role="tabpanel">
        <EditorDrawerExtrasContext.Provider value={extrasHost}>
          {children}
        </EditorDrawerExtrasContext.Provider>
      </div>
    </section>
  );
}

function EditorDrawerTabList({
  availability,
  onSelectView,
  problemCount,
  view,
}: EditorDrawerProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabs = editorDrawerTabs(view, availability);
  const selectedIndex = tabs.findIndex((tab) => tab.view === view);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingIndex(event.key, selectedIndex, tabs.length, "horizontal");
    if (next === null) return;
    const tab = tabs[next];
    if (tab === undefined) return;
    event.preventDefault();
    onSelectView(tab.view);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div
      aria-label="Panel views"
      className="cv-edrawer__tabs"
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          aria-selected={tab.view === view}
          className="cv-edrawer__tab"
          data-transient={tab.transient ? "true" : undefined}
          key={tab.view}
          onClick={() => onSelectView(tab.view)}
          role="tab"
          tabIndex={tab.view === view ? 0 : -1}
          type="button"
        >
          {tab.label}
          {tab.view === "problems" && problemCount > 0 ? (
            <span className="cv-edrawer__count">{problemCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function EditorDrawerMoreViews({ availability, onSelectView }: EditorDrawerProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const views = editorDrawerMoreViews(availability);
  return (
    <span className="cv-edrawer__more" ref={anchorRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        icon={<ChevronDown size={14} />}
        label="More views"
        onClick={() => setOpen((current) => !current)}
        size="xs"
      />
      <Menu anchorRef={anchorRef} label="More views" onClose={() => setOpen(false)} open={open}>
        {views.map((item) => (
          <MenuItem key={item.view} onSelect={() => onSelectView(item.view)}>
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}
