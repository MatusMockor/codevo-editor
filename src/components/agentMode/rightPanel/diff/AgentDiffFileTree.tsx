import { File, Folder } from "lucide-react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import {
  buildAgentTurnDiffTree,
  type TurnDiffTreeNode,
} from "../../../../domain/agentTurnDiffTree";
import { TreeRow } from "../../../../ui/foundation/TreeRow";
import { DiffStat } from "./AgentDiffFileSection";

export interface AgentDiffFileTreeProps {
  readonly files: ReadonlyArray<AgentDiffFile>;
  readonly currentPath: string | null;
  onSelect(displayPath: string): void;
}

export function AgentDiffFileTree({ currentPath, files, onSelect }: AgentDiffFileTreeProps) {
  const tree = buildAgentTurnDiffTree(
    files.map((file) => ({
      relativePath: file.displayPath,
      oldRelativePath: file.oldRelativePath,
      status: file.status,
      addedLines: file.added,
      deletedLines: file.deleted,
    })),
  );
  return (
    <nav aria-label="Changed files" className="cv-diff-tree">
      {flatten(tree.nodes, 0).map(({ depth, node }) => (
        <TreeRow
          current={node.kind === "file" && node.path === currentPath}
          depth={depth}
          expanded={node.kind === "directory" ? true : undefined}
          icon={node.kind === "directory" ? <Folder size={14} /> : <File size={14} />}
          key={node.path}
          label={node.name}
          onActivate={() => {
            if (node.kind === "file") onSelect(node.path);
          }}
          trailing={
            node.kind === "file" ? (
              <DiffStat added={node.stats.addedLines} deleted={node.stats.deletedLines} />
            ) : undefined
          }
        />
      ))}
    </nav>
  );
}

function flatten(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  depth: number,
): ReadonlyArray<{ readonly depth: number; readonly node: TurnDiffTreeNode }> {
  return nodes.flatMap((node) =>
    node.kind === "directory"
      ? [{ depth, node }, ...flatten(node.children, depth + 1)]
      : [{ depth, node }],
  );
}
