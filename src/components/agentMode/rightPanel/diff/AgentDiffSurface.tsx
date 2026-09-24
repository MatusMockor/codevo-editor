import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DiffViewComputationGateway } from "../../../../application/diffViewComputation";
import {
  agentDiffTruncationNote,
  type AgentDiffFile,
  type AgentDiffSource,
} from "../../../../application/rightPanel/agentDiffSources";
import {
  useAgentDiffSurface,
  type AgentDiffFileView,
  type AgentDiffRevealRequest,
} from "../../../../application/rightPanel/useAgentDiffSurface";
import type {
  AgentDiffScope,
  AgentDiffTurnOption,
} from "../../../../domain/diffView/agentDiffScope";
import { AgentDiffFileSection } from "./AgentDiffFileSection";
import { AgentDiffFileTree } from "./AgentDiffFileTree";
import type { AgentDiffLayout } from "./AgentDiffHunks";
import { AgentDiffToolbar } from "./AgentDiffToolbar";
import { useViewportWidth } from "../../../useViewportWidth";
import "./agentDiff.css";

export const AGENT_DIFF_SPLIT_MIN_WIDTH = 520;

export interface AgentDiffScopeChoices {
  readonly turns: ReadonlyArray<AgentDiffTurnOption>;
  readonly workingTree: boolean;
  readonly branch: {
    readonly head: string;
    readonly bases: ReadonlyArray<string>;
    readonly defaultBase: string;
  } | null;
}

export interface AgentDiffSurfaceProps {
  readonly scope: AgentDiffScope;
  readonly scopeLabel: string;
  readonly choices: AgentDiffScopeChoices;
  readonly source: AgentDiffSource | null;
  readonly computation: DiffViewComputationGateway;
  readonly emptyReason: string | null;
  readonly warning: string | null;
  readonly reveal: AgentDiffRevealRequest | null;
  readonly replacementBody: ReactNode;
  onScopeChange(scope: AgentDiffScope): void;
  onOpenFile(file: AgentDiffFile): void;
  onRefresh(): void;
}

export function AgentDiffSurface(props: AgentDiffSurfaceProps) {
  const [layout, setLayout] = useState<AgentDiffLayout>("unified");
  const [wrap, setWrap] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [treeVisible, setTreeVisible] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
  const narrow = useViewportWidth(surfaceElement) < AGENT_DIFF_SPLIT_MIN_WIDTH;
  const effectiveLayout: AgentDiffLayout = narrow ? "unified" : layout;
  const effectiveTreeVisible = treeVisible && !narrow;
  const sections = useRef(new Map<string, HTMLDivElement>());
  const diff = useAgentDiffSurface({
    source: props.source,
    computation: props.computation,
    ignoreWhitespace,
    reveal: props.reveal,
  });
  const totals = diffTotals(diff.files);
  const statsPartial = diff.status.kind === "ready" && diff.status.statsPartial;
  const replacement = props.replacementBody !== null;
  const revealed = diff.revealed;

  useEffect(() => {
    if (revealed === null) return;
    setCurrentPath(revealed.displayPath);
    sections.current.get(revealed.displayPath)?.scrollIntoView({ block: "start" });
  }, [revealed]);

  const reveal = (displayPath: string) => {
    setCurrentPath(displayPath);
    diff.revealFile(displayPath);
    sections.current.get(displayPath)?.scrollIntoView({ block: "start" });
  };

  return (
    <section
      aria-label="Diff"
      className="cv-diff"
      data-layout={effectiveLayout}
      data-mode={replacement ? "replacement" : "files"}
      data-narrow={narrow}
      data-wrap={wrap}
      ref={setSurfaceElement}
    >
      <AgentDiffToolbar
        added={totals.added}
        choices={props.choices}
        deleted={totals.deleted}
        ignoreWhitespace={ignoreWhitespace}
        layout={effectiveLayout}
        mode={replacement ? "replacement" : "files"}
        narrow={narrow}
        onCollapseAll={diff.collapseAll}
        onIgnoreWhitespaceChange={setIgnoreWhitespace}
        onLayoutChange={setLayout}
        onRefresh={() => {
          props.onRefresh();
          diff.refresh();
        }}
        onScopeChange={props.onScopeChange}
        onTreeVisibleChange={setTreeVisible}
        onWrapChange={setWrap}
        scope={props.scope}
        scopeLabel={props.scopeLabel}
        statsPartial={statsPartial}
        treeVisible={effectiveTreeVisible}
        wrap={wrap}
      />
      {props.warning !== null && !replacement && (
        <p className="cv-rp-note cv-rp-note--warning" role="status">
          {props.warning}
        </p>
      )}
      <div className="cv-diff__body">
        <div
          className={replacement ? "cv-diff__files cv-diff__files--replacement" : "cv-diff__files"}
        >
          {props.replacementBody ?? (
            <DiffFiles
              diff={diff}
              emptyReason={props.source === null ? props.emptyReason : null}
              layout={effectiveLayout}
              onOpenFile={props.onOpenFile}
              sections={sections.current}
            />
          )}
        </div>
        {effectiveTreeVisible && !replacement && (
          <AgentDiffFileTree
            currentPath={currentPath}
            files={diff.files.map((view) => view.file)}
            onSelect={reveal}
          />
        )}
      </div>
    </section>
  );
}

function DiffFiles(props: {
  readonly diff: ReturnType<typeof useAgentDiffSurface>;
  readonly emptyReason: string | null;
  readonly layout: AgentDiffLayout;
  readonly sections: Map<string, HTMLDivElement>;
  onOpenFile(file: AgentDiffFile): void;
}) {
  const { diff } = props;
  if (props.emptyReason !== null) return <p className="cv-rp-note">{props.emptyReason}</p>;
  switch (diff.status.kind) {
    case "idle":
      return <p className="cv-rp-note">Select changes to review.</p>;
    case "loading":
      return <p className="cv-rp-note">Loading changes…</p>;
    case "unavailable":
      return <p className="cv-rp-note">{diff.status.reason}</p>;
    case "failed":
      return (
        <p className="cv-rp-note cv-rp-note--warning">
          {diff.status.message}{" "}
          <button className="cv-rp-link" onClick={diff.refresh} type="button">
            Retry
          </button>
        </p>
      );
    case "ready":
      if (diff.files.length === 0 && diff.reloadError === null)
        return <p className="cv-rp-note">No changes.</p>;
      return (
        <>
          {diff.reloadError !== null && (
            <p className="cv-rp-note cv-rp-note--warning" role="alert">
              {`The diff could not be refreshed: ${diff.reloadError}`}{" "}
              <button className="cv-rp-link" onClick={diff.refresh} type="button">
                Retry
              </button>
            </p>
          )}
          {diff.files.map((view) => (
            <AgentDiffFileSection
              key={view.file.displayPath}
              layout={props.layout}
              onOpen={props.onOpenFile}
              onToggle={() => diff.toggleFile(view.file.displayPath)}
              sectionRef={(node) => {
                if (node === null) {
                  props.sections.delete(view.file.displayPath);
                  return;
                }
                props.sections.set(view.file.displayPath, node);
              }}
              view={view}
            />
          ))}
          {diff.status.truncated && (
            <p className="cv-rp-note">{agentDiffTruncationNote(diff.files.length)}</p>
          )}
        </>
      );
  }
}

function diffTotals(files: ReadonlyArray<AgentDiffFileView>): {
  readonly added: number | null;
  readonly deleted: number | null;
} {
  const known = files.filter((view) => view.file.added !== null || view.file.deleted !== null);
  if (known.length === 0) return { added: null, deleted: null };
  return {
    added: known.reduce((total, view) => total + (view.file.added ?? 0), 0),
    deleted: known.reduce((total, view) => total + (view.file.deleted ?? 0), 0),
  };
}
