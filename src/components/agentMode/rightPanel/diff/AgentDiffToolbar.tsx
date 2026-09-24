import {
  ChevronDown,
  ChevronsDownUp,
  Columns2,
  FolderTree,
  Pilcrow,
  RefreshCw,
  Rows3,
  WrapText,
  ArrowRight,
} from "lucide-react";
import { useRef, useState } from "react";
import type { AgentDiffScope } from "../../../../domain/diffView/agentDiffScope";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import { SegmentedControl } from "../../../../ui/foundation/SegmentedControl";
import type { AgentDiffLayout } from "./AgentDiffHunks";
import { DiffStat } from "./AgentDiffFileSection";
import { AgentDiffScopeMenu } from "./AgentDiffScopeMenu";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

export type AgentDiffToolbarMode = "files" | "replacement";

export interface AgentDiffToolbarProps {
  readonly mode: AgentDiffToolbarMode;
  readonly scope: AgentDiffScope;
  readonly scopeLabel: string;
  readonly choices: AgentDiffScopeChoices;
  readonly added: number | null;
  readonly deleted: number | null;
  readonly statsPartial: boolean;
  readonly layout: AgentDiffLayout;
  readonly wrap: boolean;
  readonly ignoreWhitespace: boolean;
  readonly treeVisible: boolean;
  readonly narrow: boolean;
  onScopeChange(scope: AgentDiffScope): void;
  onRefresh(): void;
  onCollapseAll(): void;
  onLayoutChange(layout: AgentDiffLayout): void;
  onWrapChange(wrap: boolean): void;
  onIgnoreWhitespaceChange(ignore: boolean): void;
  onTreeVisibleChange(visible: boolean): void;
}

export function AgentDiffToolbar(props: AgentDiffToolbarProps) {
  const scopeRef = useRef<HTMLButtonElement | null>(null);
  const baseRef = useRef<HTMLButtonElement | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const branch = props.choices.branch;
  const scope = props.scope;
  return (
    <div className="cv-rp-sub cv-diff-toolbar">
      <div className="cv-rp-sub__grow">
        <button
          aria-expanded={scopeOpen}
          aria-haspopup="menu"
          aria-label={`Diff scope: ${props.scopeLabel}`}
          className="cv-rp-ctl"
          onClick={() => setScopeOpen((open) => !open)}
          ref={scopeRef}
          type="button"
        >
          {props.scopeLabel}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
        {scope.kind === "branch" && branch !== null && (
          <span
            className="cv-diff-compare"
            title={`Comparing ${branch.head} against ${scope.baseRef}`}
          >
            <span className="cv-diff-compare__head">{branch.head}</span>
            <ArrowRight aria-hidden="true" size={12} />
            <button
              aria-haspopup="menu"
              aria-label={`Base branch: ${scope.baseRef}`}
              className="cv-rp-ctl cv-rp-ctl--quiet"
              onClick={() => setBaseOpen((open) => !open)}
              ref={baseRef}
              type="button"
            >
              {scope.baseRef}
              <ChevronDown aria-hidden="true" size={12} />
            </button>
          </span>
        )}
      </div>
      {props.mode === "files" && <AgentDiffToolbarTools {...props} />}
      <AgentDiffScopeMenu
        anchorRef={scopeRef}
        choices={props.choices}
        onClose={() => setScopeOpen(false)}
        onSelect={props.onScopeChange}
        open={scopeOpen}
        scope={scope}
      />
      {branch !== null && scope.kind === "branch" && (
        <Menu
          anchorRef={baseRef}
          label="Base branch"
          onClose={() => setBaseOpen(false)}
          open={baseOpen}
        >
          {branch.bases.map((base) => (
            <MenuItem
              checked={base === scope.baseRef}
              key={base}
              onSelect={() => {
                setBaseOpen(false);
                props.onScopeChange({ kind: "branch", baseRef: base });
              }}
            >
              {base}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

function AgentDiffToolbarTools(props: AgentDiffToolbarProps) {
  return (
    <div className="cv-rp-sub__tools">
      <DiffStat added={props.added} deleted={props.deleted} />
      {props.statsPartial && (props.added !== null || props.deleted !== null) && (
        <span
          className="cv-diff-toolbar__partial"
          title="Some files have no line counts, so these totals are incomplete."
        >
          partial
        </span>
      )}
      <IconButton
        icon={<RefreshCw size={14} />}
        label="Refresh diff"
        onClick={props.onRefresh}
        size="xs"
      />
      <IconButton
        icon={<ChevronsDownUp size={14} />}
        label="Collapse all files"
        onClick={props.onCollapseAll}
        size="xs"
      />
      {!props.narrow && (
        <SegmentedControl
          iconOnly
          label="Diff layout"
          onChange={props.onLayoutChange}
          options={[
            { value: "unified", label: "Stacked diff view", icon: <Rows3 size={14} /> },
            { value: "split", label: "Split diff view", icon: <Columns2 size={14} /> },
          ]}
          value={props.layout}
        />
      )}
      <IconButton
        icon={<WrapText size={14} />}
        label={props.wrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
        onClick={() => props.onWrapChange(!props.wrap)}
        pressed={props.wrap}
        size="xs"
      />
      <IconButton
        icon={<Pilcrow size={14} />}
        label={props.ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
        onClick={() => props.onIgnoreWhitespaceChange(!props.ignoreWhitespace)}
        pressed={props.ignoreWhitespace}
        size="xs"
      />
      {!props.narrow && (
        <IconButton
          icon={<FolderTree size={14} />}
          label={props.treeVisible ? "Hide file tree" : "Show file tree"}
          onClick={() => props.onTreeVisibleChange(!props.treeVisible)}
          pressed={props.treeVisible}
          size="xs"
        />
      )}
    </div>
  );
}
