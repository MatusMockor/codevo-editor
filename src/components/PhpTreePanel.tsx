import { ChevronRight, FileCode2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { PhpTree, PhpTreeNode } from "../domain/phpTree";

interface PhpTreePanelProps {
  activePath: string | null;
  expandedNodeIds: Set<string>;
  isLoading: boolean;
  onOpenNode(node: PhpTreeNode): void;
  onToggleNode(id: string): void;
  rootPath: string | null;
  tree: PhpTree;
}

export function PhpTreePanel({
  activePath,
  expandedNodeIds,
  isLoading,
  onOpenNode,
  onToggleNode,
  rootPath,
  tree,
}: PhpTreePanelProps) {
  if (!rootPath) {
    return (
      <div className="empty-tree">
        <p>No workspace</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="empty-tree">
        <p>Loading PHP tree</p>
      </div>
    );
  }

  if (tree.nodes.length === 0) {
    return (
      <div className="empty-tree">
        <p>No PHP symbols indexed</p>
      </div>
    );
  }

  return (
    <nav aria-label="PHP symbols" className="php-tree">
      {tree.nodes.map((node) => (
        <PhpTreeEntry
          activePath={activePath}
          expandedNodeIds={expandedNodeIds}
          key={node.id}
          level={0}
          node={node}
          onOpenNode={onOpenNode}
          onToggleNode={onToggleNode}
        />
      ))}
    </nav>
  );
}

interface PhpTreeEntryProps {
  activePath: string | null;
  expandedNodeIds: Set<string>;
  level: number;
  node: PhpTreeNode;
  onOpenNode(node: PhpTreeNode): void;
  onToggleNode(id: string): void;
}

function PhpTreeEntry({
  activePath,
  expandedNodeIds,
  level,
  node,
  onOpenNode,
  onToggleNode,
}: PhpTreeEntryProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodeIds.has(node.id);
  const isActive = Boolean(node.path && node.path === activePath);

  return (
    <div className="tree-row-group">
      <button
        aria-expanded={hasChildren ? isExpanded : undefined}
        className={isActive ? "tree-row active php-tree-row" : "tree-row php-tree-row"}
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
        title={node.relativePath || node.fullyQualifiedName || node.label}
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

      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <PhpTreeEntry
              activePath={activePath}
              expandedNodeIds={expandedNodeIds}
              key={child.id}
              level={level + 1}
              node={child}
              onOpenNode={onOpenNode}
              onToggleNode={onToggleNode}
            />
          ))
        : null}
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
