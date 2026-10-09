import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { memo, type CSSProperties } from "react";
import { fileTypeGlyphKind } from "../../../domain/fileTypeGlyph";
import { FileTypeGlyph } from "../../FileTypeGlyph";
import type { AgentTurnChangeRow } from "./agentTurnChangesProjection";

const ROW_INSET_PX = 8;
const ROW_INDENT_PX = 14;
const MAX_ROW_INDENT_DEPTH = 8;
const ROW_ICON_SIZE = 14;
const ROW_ICON_STROKE = 1.75;

type FileRowModel = Extract<AgentTurnChangeRow, { kind: "file" }>;
type FolderRowModel = Extract<AgentTurnChangeRow, { kind: "directory" }>;

export interface AgentTurnChangesTreeProps {
  readonly id: string;
  readonly rows: ReadonlyArray<AgentTurnChangeRow>;
  readonly hasFolders: boolean;
  readonly moreLabel: string | null;
  onOpenFile(relativePath: string): void;
  onToggleFolder(path: string): void;
}

export const AgentTurnChangesTree = memo(function AgentTurnChangesTree({
  hasFolders,
  id,
  moreLabel,
  onOpenFile,
  onToggleFolder,
  rows,
}: AgentTurnChangesTreeProps) {
  return (
    <ul aria-label="Changed files" className="cv-changes__tree" id={id}>
      {rows.map((row) => (
        <li aria-level={row.depth + 1} key={`${row.kind}:${row.node.path}`}>
          <ChangeRow
            aligned={hasFolders}
            onOpenFile={onOpenFile}
            onToggleFolder={onToggleFolder}
            row={row}
          />
        </li>
      ))}
      {moreLabel !== null && <li className="cv-changes__more">{moreLabel}</li>}
    </ul>
  );
});

export function AgentTurnChangesStat({
  added,
  deleted,
}: {
  readonly added: number | null;
  readonly deleted: number | null;
}) {
  if (added === null && deleted === null) return null;
  return (
    <span className="cv-changes__stat">
      {added !== null && <span className="cv-changes__added">+{added}</span>}
      {deleted !== null && <span className="cv-changes__deleted">−{deleted}</span>}
    </span>
  );
}

function ChangeRow({
  aligned,
  onOpenFile,
  onToggleFolder,
  row,
}: {
  readonly row: AgentTurnChangeRow;
  readonly aligned: boolean;
  onOpenFile(relativePath: string): void;
  onToggleFolder(path: string): void;
}) {
  switch (row.kind) {
    case "directory":
      return <FolderRow onToggleFolder={onToggleFolder} row={row} />;
    case "file":
      return <FileRow aligned={aligned} onOpenFile={onOpenFile} row={row} />;
    default:
      return unsupportedRow(row);
  }
}

function FolderRow({
  onToggleFolder,
  row,
}: {
  readonly row: FolderRowModel;
  onToggleFolder(path: string): void;
}) {
  const { depth, expanded, node } = row;
  const FolderIcon = expanded ? FolderOpen : Folder;
  return (
    <button
      aria-expanded={expanded}
      className="cv-changes__row"
      onClick={() => onToggleFolder(node.path)}
      style={rowIndent(depth)}
      title={node.path}
      type="button"
    >
      <span aria-hidden="true" className="cv-changes__chevron">
        <ChevronRight size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />
      </span>
      <span aria-hidden="true" className="cv-changes__icon">
        <FolderIcon size={ROW_ICON_SIZE} strokeWidth={ROW_ICON_STROKE} />
      </span>
      <span className="cv-changes__name">{node.name}</span>
      <AgentTurnChangesStat added={node.stats.addedLines} deleted={node.stats.deletedLines} />
    </button>
  );
}

function FileRow({
  aligned,
  onOpenFile,
  row,
}: {
  readonly row: FileRowModel;
  readonly aligned: boolean;
  onOpenFile(relativePath: string): void;
}) {
  const { depth, node } = row;
  return (
    <button
      className="cv-changes__row"
      onClick={() => onOpenFile(node.file.relativePath)}
      style={rowIndent(depth)}
      title={node.file.relativePath}
      type="button"
    >
      {aligned && <span aria-hidden="true" className="cv-changes__chevron" />}
      <span aria-hidden="true" className="cv-changes__icon">
        <FileTypeGlyph kind={fileTypeGlyphKind(node.name)} />
      </span>
      <span className="cv-changes__name">{node.name}</span>
      <AgentTurnChangesStat added={node.stats.addedLines} deleted={node.stats.deletedLines} />
    </button>
  );
}

function rowIndent(depth: number): CSSProperties {
  return {
    paddingInlineStart: ROW_INSET_PX + Math.min(depth, MAX_ROW_INDENT_DEPTH) * ROW_INDENT_PX,
  };
}

function unsupportedRow(row: never): never {
  throw new Error(`Unsupported turn change row: ${String(row)}`);
}
