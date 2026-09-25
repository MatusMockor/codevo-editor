import type { ComposerBranchItem } from "../../application/useComposerBranchPicker";
import { localBranchRef, remoteBranchRef } from "../../domain/agentWorktreeBase";
import type { GitBranches } from "../../domain/git";

export const MAX_COMPOSER_BRANCH_ITEMS = 200;

export function composerBranchItems(
  branches: GitBranches,
  query: string,
): ReadonlyArray<ComposerBranchItem> {
  const needle = query.trim().toLowerCase();
  const matches = (item: ComposerBranchItem): boolean =>
    needle === "" || item.name.toLowerCase().includes(needle);
  return [...localItems(branches), ...remoteItems(branches)]
    .filter(matches)
    .slice(0, MAX_COMPOSER_BRANCH_ITEMS);
}

function localItems(branches: GitBranches): ReadonlyArray<ComposerBranchItem> {
  const ordered = [...branches.local].sort((left, right) => {
    if (left === branches.current) return -1;
    if (right === branches.current) return 1;
    return left.localeCompare(right);
  });
  return ordered.flatMap((name): ReadonlyArray<ComposerBranchItem> => {
    const ref = localBranchRef(name);
    if (ref === null) return [];
    return [{ current: name === branches.current, kind: "local", name, ref }];
  });
}

function remoteItems(branches: GitBranches): ReadonlyArray<ComposerBranchItem> {
  return Object.entries(branches.remotes)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([remote, names]) =>
      [...names].sort().flatMap((name): ReadonlyArray<ComposerBranchItem> => {
        const ref = remoteBranchRef(remote, name);
        if (ref === null) return [];
        return [{ current: false, kind: "remote", name: `${remote}/${name}`, ref }];
      }),
    );
}
