import { GitBranch } from "lucide-react";
import { useId, useMemo } from "react";
import type { AgentGitHistoryBranchFilter } from "../../application/useAgentGitHistory";
import type { GitBranches } from "../../domain/git";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";

interface Props {
  readonly identity: string;
  readonly branches: GitBranches | null;
  readonly value: AgentGitHistoryBranchFilter;
  readonly disabled: boolean;
  onChange(value: AgentGitHistoryBranchFilter): void;
}
export function AgentHistoryBranchPicker({ identity, branches, value, disabled, onChange }: Props) {
  const id = useId();
  const searchIdentity = useMemo(() => ({ identity }), [identity]);
  const options = useMemo(
    () => [
      agentPickerOption("all", "All branches", "Show local and remote history"),
      agentPickerOption("root:head", "Current branch", branches?.current ?? "HEAD"),
      ...(branches?.local.map((branch) =>
        agentPickerOption(
          `root:refs/heads/${branch}`,
          branch,
          branch === branches.current ? "Current working branch" : "Local branch",
          null,
          null,
          <GitBranch size={13} />,
          "Local branches",
        ),
      ) ?? []),
      ...Object.entries(branches?.remotes ?? {}).flatMap(([remote, names]) =>
        names.map((branch) =>
          agentPickerOption(
            `root:refs/remotes/${remote}/${branch}`,
            `${remote}/${branch}`,
            "Remote branch",
            null,
            null,
            <GitBranch size={13} />,
            "Remote branches",
          ),
        ),
      ),
    ],
    [branches],
  );
  return (
    <div
      className="agent-history__branch-picker"
      title="Browse a branch’s history. Your working branch stays unchanged."
    >
      <AgentPickerMenu
        id={id}
        label="History branch"
        options={options}
        value={
          value.kind === "branch"
            ? `root:${value.ref}`
            : value.kind === "head"
              ? "root:head"
              : "all"
        }
        disabled={disabled}
        tone={null}
        prefix={null}
        describedBy={null}
        align="start"
        variant="ghost"
        menuLayout="checkout"
        searchSubject="branches"
        searchIdentity={searchIdentity}
        icon={<GitBranch size={13} />}
        onChange={(ref) => {
          if (ref === "all") {
            onChange({ kind: "all" });
            return;
          }
          if (ref === "root:head") {
            onChange({ kind: "head" });
            return;
          }
          onChange({ kind: "branch", ref: ref.slice(5) });
        }}
      />
    </div>
  );
}
