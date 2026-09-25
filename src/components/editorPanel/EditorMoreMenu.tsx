import {
  Bug,
  Columns2,
  PanelRightOpen,
  Play,
  Rows2,
  Settings2,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import type { RefObject } from "react";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import type { EditorChrome, EditorStatusRow } from "./EditorChromeContext";
import "./editorPanel.css";

export interface EditorMoreMenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly chrome: EditorChrome;
  onClose(): void;
}

export function EditorMoreMenu({ anchorRef, chrome, onClose, open }: EditorMoreMenuProps) {
  const { shortcuts } = chrome;
  return (
    <Menu
      anchorRef={anchorRef}
      label="More editor actions"
      onClose={onClose}
      open={open}
      placement="bottom-end"
    >
      <MenuItem
        icon={<Bug size={14} />}
        onSelect={() => chrome.runDebugEntry("start")}
        shortcut={optionalShortcut(shortcuts.debugStart)}
      >
        Start debugging
      </MenuItem>
      <MenuItem
        icon={<Play size={14} />}
        onSelect={() => chrome.runDebugEntry("runWithoutDebugging")}
        shortcut={optionalShortcut(shortcuts.runWithoutDebugging)}
      >
        Run without debugging
      </MenuItem>
      <MenuItem
        icon={<Settings2 size={14} />}
        onSelect={() => chrome.runDebugEntry("launchConfigurations")}
      >
        Launch configurations
      </MenuItem>
      <MenuItem icon={<Unplug size={14} />} onSelect={() => chrome.runDebugEntry("attach")}>
        Attach to Node process
      </MenuItem>
      <MenuItem
        icon={<PanelRightOpen size={14} />}
        onSelect={() => chrome.runDebugEntry("showViews")}
      >
        Show debug views
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Columns2 size={14} />}
        onSelect={chrome.splitRight}
        shortcut={optionalShortcut(shortcuts.split)}
      >
        Split right
      </MenuItem>
      <MenuItem icon={<Rows2 size={14} />} onSelect={chrome.splitDown}>
        Split down
      </MenuItem>
      <MenuItem checked={chrome.ideModeOn} onSelect={chrome.toggleIdeMode}>
        IDE mode
      </MenuItem>
      {chrome.trustNeeded ? (
        <MenuItem icon={<ShieldCheck size={14} />} onSelect={chrome.trustWorkspace}>
          Trust workspace…
        </MenuItem>
      ) : null}
      <EditorStatusSection onOpenBranches={chrome.openBranches} rows={chrome.statusRows} />
    </Menu>
  );
}

interface EditorStatusSectionProps {
  readonly rows: ReadonlyArray<EditorStatusRow>;
  onOpenBranches(): void;
}

function EditorStatusSection({ onOpenBranches, rows }: EditorStatusSectionProps) {
  if (rows.length === 0) return null;
  return (
    <>
      <MenuSeparator />
      <MenuLabel>Editor status</MenuLabel>
      {rows.map((row) =>
        row.id === "branch" ? (
          <MenuItem key={row.id} onSelect={onOpenBranches}>
            <EditorStatusRowContent row={row} />
          </MenuItem>
        ) : (
          <div className="cv-esub-status-row" key={row.id} role="presentation">
            <EditorStatusRowContent row={row} />
          </div>
        ),
      )}
    </>
  );
}

function EditorStatusRowContent({ row }: { readonly row: EditorStatusRow }) {
  return (
    <>
      <span className="cv-esub-status-row__label">{row.label}</span>
      <span className="cv-esub-status-row__value" title={row.value}>
        {row.value}
      </span>
    </>
  );
}

function optionalShortcut(shortcut: string): string | undefined {
  return shortcut === "" ? undefined : shortcut;
}
