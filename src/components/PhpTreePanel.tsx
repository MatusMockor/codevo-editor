import { memo } from "react";
import type { PhpTree, PhpTreeNode } from "../domain/phpTree";
import { PhpTreeRows } from "./PhpTreeRows";

interface PhpTreePanelProps {
  activePath: string | null;
  expandedNodeIds: Set<string>;
  isLoading: boolean;
  onOpenNode(node: PhpTreeNode): void;
  onToggleNode(id: string): void;
  rootPath: string | null;
  tree: PhpTree;
}

function PhpTreePanelComponent({
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
        <p>No indexed PHP symbols. Use Cmd+R for current file structure.</p>
      </div>
    );
  }

  return (
    <nav aria-label="PHP symbols" className="php-tree">
      <PhpTreeRows
        activePath={activePath}
        expandedNodeIds={expandedNodeIds}
        level={0}
        nodes={tree.nodes}
        onOpenNode={onOpenNode}
        onToggleNode={onToggleNode}
      />
    </nav>
  );
}

export const PhpTreePanel = memo(PhpTreePanelComponent);
