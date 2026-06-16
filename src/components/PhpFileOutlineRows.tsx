import { ChevronRight, FileCode2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { PhpFileOutlineNode } from "../domain/phpFileOutline";

interface PhpFileOutlineRowsProps {
  expandedNodeIds: Set<string>;
  level: number;
  nodes: PhpFileOutlineNode[];
  onOpenNode(node: PhpFileOutlineNode): void;
  onToggleNode(id: string): void;
}

export function PhpFileOutlineRows({
  expandedNodeIds,
  level,
  nodes,
  onOpenNode,
  onToggleNode,
}: PhpFileOutlineRowsProps) {
  return (
    <>
      {nodes.map((node) => (
        <PhpFileOutlineEntry
          expandedNodeIds={expandedNodeIds}
          key={node.id}
          level={level}
          node={node}
          onOpenNode={onOpenNode}
          onToggleNode={onToggleNode}
        />
      ))}
    </>
  );
}

interface PhpFileOutlineEntryProps {
  expandedNodeIds: Set<string>;
  level: number;
  node: PhpFileOutlineNode;
  onOpenNode(node: PhpFileOutlineNode): void;
  onToggleNode(id: string): void;
}

function PhpFileOutlineEntry({
  expandedNodeIds,
  level,
  node,
  onOpenNode,
  onToggleNode,
}: PhpFileOutlineEntryProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodeIds.has(node.id);

  return (
    <div className="tree-row-group">
      <button
        aria-expanded={hasChildren ? isExpanded : undefined}
        className="tree-row php-file-outline-row"
        onClick={() => {
          if (hasChildren) {
            onToggleNode(node.id);
          }

          if (!node.path) {
            return;
          }

          onOpenNode(node);
        }}
        style={{ "--tree-level": level } as CSSProperties}
        title={node.fullyQualifiedName || node.label}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={getChevronClassName(hasChildren, isExpanded)}
          size={15}
        />
        <FileCode2 aria-hidden="true" size={16} />
        <span>{node.label}</span>
        <small>{node.kind}</small>
      </button>

      {hasChildren && isExpanded ? (
        <PhpFileOutlineRows
          expandedNodeIds={expandedNodeIds}
          level={level + 1}
          nodes={node.children}
          onOpenNode={onOpenNode}
          onToggleNode={onToggleNode}
        />
      ) : null}
    </div>
  );
}

function getChevronClassName(hasChildren: boolean, isExpanded: boolean): string {
  if (!hasChildren) {
    return "tree-chevron placeholder";
  }

  if (isExpanded) {
    return "tree-chevron expanded";
  }

  return "tree-chevron";
}
