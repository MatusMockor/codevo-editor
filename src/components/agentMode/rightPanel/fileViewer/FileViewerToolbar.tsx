import {
  ClipboardCopy,
  Code2,
  Ellipsis,
  Eye,
  FolderTree,
  Link2,
  ListChevronsDownUp,
  RefreshCw,
  WrapText,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { AgentFileViewerMarkdownMode } from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";

export interface FileViewerToolbarTreeToggle {
  readonly shown: boolean;
  onToggle(): void;
}

export interface FileViewerToolbarCollapseFolders {
  readonly disabled: boolean;
  run(): void;
}

export interface FileViewerToolbarProps {
  readonly treeToggle: FileViewerToolbarTreeToggle | null;
  readonly collapseFolders: FileViewerToolbarCollapseFolders | null;
  readonly markdownMode: AgentFileViewerMarkdownMode | null;
  readonly wrap: boolean;
  readonly canCopyContents: boolean;
  readonly onReload: (() => void) | null;
  onMarkdownModeChange(mode: AgentFileViewerMarkdownMode): void;
  onToggleWrap(): void;
  onCopyPath(): void;
  onCopyContents(): void;
}

const ICON_SIZE = 14;

export function FileViewerToolbar(props: FileViewerToolbarProps) {
  const { collapseFolders, markdownMode, onReload, treeToggle } = props;
  return (
    <div className="cv-rp-sub__tools cv-file-viewer__tools">
      {markdownMode !== null && (
        <IconButton
          icon={markdownMode === "rendered" ? <Code2 size={ICON_SIZE} /> : <Eye size={ICON_SIZE} />}
          label={markdownMode === "rendered" ? "Show Markdown source" : "Show rendered Markdown"}
          onClick={() =>
            props.onMarkdownModeChange(markdownMode === "rendered" ? "source" : "rendered")
          }
          size="xs"
        />
      )}
      <IconButton
        icon={<WrapText size={ICON_SIZE} />}
        label="Wrap lines"
        onClick={props.onToggleWrap}
        pressed={props.wrap}
        size="xs"
      />
      {treeToggle !== null && (
        <IconButton
          icon={<FolderTree size={ICON_SIZE} />}
          label={treeToggle.shown ? "Hide file tree" : "Show file tree"}
          onClick={treeToggle.onToggle}
          pressed={treeToggle.shown}
          size="xs"
        />
      )}
      <FileViewerMoreMenu>
        <MenuItem icon={<Link2 size={ICON_SIZE} />} onSelect={props.onCopyPath}>
          Copy path
        </MenuItem>
        <MenuItem
          disabled={!props.canCopyContents}
          icon={<ClipboardCopy size={ICON_SIZE} />}
          onSelect={props.onCopyContents}
        >
          Copy contents
        </MenuItem>
        {onReload !== null && (
          <MenuItem icon={<RefreshCw size={ICON_SIZE} />} onSelect={onReload}>
            Reload file
          </MenuItem>
        )}
        {collapseFolders !== null && (
          <MenuItem
            disabled={collapseFolders.disabled}
            icon={<ListChevronsDownUp size={ICON_SIZE} />}
            onSelect={collapseFolders.run}
          >
            Collapse all folders
          </MenuItem>
        )}
      </FileViewerMoreMenu>
    </div>
  );
}

function FileViewerMoreMenu({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        icon={<Ellipsis size={ICON_SIZE} />}
        label="More file actions"
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        size="xs"
      />
      <Menu
        anchorRef={anchorRef}
        label="More file actions"
        onClose={() => setOpen(false)}
        open={open}
        placement="bottom-end"
      >
        {children}
      </Menu>
    </>
  );
}
