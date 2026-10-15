import {
  ClipboardCopy,
  Code2,
  Ellipsis,
  Eye,
  FolderTree,
  Link2,
  RefreshCw,
  WrapText,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { AgentFileViewerMarkdownMode } from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import type { FileViewerToolbarMode } from "./fileViewerModel";

export interface FileViewerToolbarTreeToggle {
  readonly shown: boolean;
  onToggle(): void;
}

export interface FileViewerToolbarProps {
  readonly mode: FileViewerToolbarMode;
  readonly treeToggle: FileViewerToolbarTreeToggle | null;
  readonly markdownMode: AgentFileViewerMarkdownMode | null;
  readonly wrap: boolean;
  readonly canCopyContents: boolean;
  readonly onReload: (() => void) | null;
  onMarkdownModeChange(mode: AgentFileViewerMarkdownMode): void;
  onToggleWrap(): void;
  onCopyPath(): void;
  onCopyContents(): void;
}

export function FileViewerToolbar(props: FileViewerToolbarProps) {
  const { markdownMode, mode, onReload } = props;
  const inline = mode !== "minimal";
  const nextMarkdownMode = markdownMode === "rendered" ? "source" : "rendered";
  const markdownLabel =
    markdownMode === "rendered" ? "Show Markdown source" : "Show rendered Markdown";
  return (
    <div className="cv-rp-sub__tools cv-file-viewer__tools">
      {props.treeToggle !== null && (
        <IconButton
          icon={<FolderTree size={14} />}
          label={props.treeToggle.shown ? "Hide file tree" : "Show file tree"}
          onClick={props.treeToggle.onToggle}
          pressed={props.treeToggle.shown}
          size="xs"
        />
      )}
      {inline && markdownMode !== null && (
        <IconButton
          icon={markdownMode === "rendered" ? <Code2 size={14} /> : <Eye size={14} />}
          label={markdownLabel}
          onClick={() => props.onMarkdownModeChange(nextMarkdownMode)}
          size="xs"
        />
      )}
      {inline && (
        <IconButton
          icon={<WrapText size={14} />}
          label="Wrap lines"
          onClick={props.onToggleWrap}
          pressed={props.wrap}
          size="xs"
        />
      )}
      {mode === "full" && (
        <IconButton
          icon={<Link2 size={14} />}
          label="Copy path"
          onClick={props.onCopyPath}
          size="xs"
        />
      )}
      {inline && (
        <IconButton
          disabled={!props.canCopyContents}
          icon={<ClipboardCopy size={14} />}
          label="Copy contents"
          onClick={props.onCopyContents}
          size="xs"
        />
      )}
      {mode === "full" && onReload !== null && (
        <IconButton
          icon={<RefreshCw size={14} />}
          label="Reload file"
          onClick={onReload}
          size="xs"
        />
      )}
      {mode !== "full" && (
        <FileViewerMoreMenu>
          {!inline && markdownMode !== null && (
            <MenuItem
              icon={markdownMode === "rendered" ? <Code2 size={14} /> : <Eye size={14} />}
              onSelect={() => props.onMarkdownModeChange(nextMarkdownMode)}
            >
              {markdownLabel}
            </MenuItem>
          )}
          {!inline && (
            <MenuItem
              checked={props.wrap}
              icon={<WrapText size={14} />}
              onSelect={props.onToggleWrap}
            >
              Wrap lines
            </MenuItem>
          )}
          <MenuItem icon={<Link2 size={14} />} onSelect={props.onCopyPath}>
            Copy path
          </MenuItem>
          {!inline && (
            <MenuItem
              disabled={!props.canCopyContents}
              icon={<ClipboardCopy size={14} />}
              onSelect={props.onCopyContents}
            >
              Copy contents
            </MenuItem>
          )}
          {onReload !== null && (
            <MenuItem icon={<RefreshCw size={14} />} onSelect={onReload}>
              Reload file
            </MenuItem>
          )}
        </FileViewerMoreMenu>
      )}
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
        icon={<Ellipsis size={14} />}
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
