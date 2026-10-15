import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import type { DiffViewComputationGateway } from "../../../../application/diffViewComputation";
import {
  MAX_RENDERED_DIFF_LINES_PER_FILE,
  groupDiffHunks,
  limitDiffHunks,
  type DiffHunk,
} from "../../../../domain/diffView/diffHunks";
import {
  MAX_TEXT_DIFF_INPUT_CHARS,
  boundDiffText,
} from "../../../../domain/diffView/diffTextBounds";
import type { LineDiffResult } from "../../../../domain/diffView/lineDiff";
import { BrowserDiffViewGateway } from "../../../../infrastructure/browserDiffViewGateway";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { Spinner } from "../../../../ui/foundation/Spinner";
import { AgentDiffHunks, type AgentDiffLayout } from "./AgentDiffHunks";
import "./agentDiff.css";

export interface AgentTextDiffLabels {
  readonly original: string;
  readonly modified: string;
}

export interface AgentTextDiffViewProps {
  readonly original: string;
  readonly modified: string;
  readonly path: string;
  readonly labels?: AgentTextDiffLabels;
  readonly loading?: boolean;
  readonly layout?: AgentDiffLayout;
  readonly computation?: DiffViewComputationGateway;
}

type TextDiffState =
  | { readonly kind: "computing" }
  | {
      readonly kind: "ready";
      readonly hunks: ReadonlyArray<DiffHunk>;
      readonly added: number;
      readonly deleted: number;
      readonly hiddenChangedLines: number;
    }
  | { readonly kind: "tooLarge" }
  | { readonly kind: "failed"; readonly message: string };

interface KeyedTextDiffState {
  readonly original: string;
  readonly modified: string;
  readonly computation: DiffViewComputationGateway;
  readonly state: TextDiffState;
}

const TEXT_DIFF_STYLE: CSSProperties = { flex: "1 1 auto", minHeight: 0, overflow: "auto" };

let defaultComputation: DiffViewComputationGateway | null = null;

function resolveDefaultComputation(): DiffViewComputationGateway {
  if (defaultComputation !== null) return defaultComputation;
  defaultComputation =
    typeof Worker === "undefined" ? inlineDiffViewGateway : new BrowserDiffViewGateway();
  return defaultComputation;
}

export function AgentTextDiffView({
  computation,
  labels,
  layout = "unified",
  loading = false,
  modified,
  original,
  path,
}: AgentTextDiffViewProps): JSX.Element {
  const gateway = computation ?? resolveDefaultComputation();
  const boundedOriginal = useMemo(() => boundDiffText(original), [original]);
  const boundedModified = useMemo(() => boundDiffText(modified), [modified]);
  const state = useTextDiff(boundedOriginal.text, boundedModified.text, gateway, loading);
  const truncated = boundedOriginal.truncated || boundedModified.truncated;
  return (
    <div
      aria-busy={loading || state.kind === "computing"}
      className="cv-diff-file"
      data-agent-text-diff=""
      style={TEXT_DIFF_STYLE}
    >
      {labels !== undefined && (
        <p
          aria-label={`Comparing ${labels.original} with ${labels.modified}`}
          className="cv-diff-file__note"
        >
          {`${labels.original} ↔ ${labels.modified}`}
        </p>
      )}
      {truncated && (
        <p className="cv-diff-file__note" role="status">
          {`This file is larger than ${formatChars(MAX_TEXT_DIFF_INPUT_CHARS)} characters; only the beginning is compared.`}
        </p>
      )}
      <TextDiffBody layout={layout} loading={loading} path={path} state={state} />
    </div>
  );
}

function TextDiffBody({
  layout,
  loading,
  path,
  state,
}: {
  readonly layout: AgentDiffLayout;
  readonly loading: boolean;
  readonly path: string;
  readonly state: TextDiffState;
}) {
  if (loading) {
    return (
      <p className="cv-diff-file__note">
        <Spinner label="Loading diff" />
      </p>
    );
  }
  switch (state.kind) {
    case "computing":
      return (
        <p className="cv-diff-file__note">
          <Spinner label="Computing diff" />
        </p>
      );
    case "tooLarge":
      return (
        <p className="cv-diff-file__note" role="status">
          The diff is too large to display.
        </p>
      );
    case "failed":
      return (
        <p className="cv-diff-file__note" role="alert">
          {state.message}
        </p>
      );
    case "ready":
      if (state.hunks.length === 0) return <p className="cv-diff-file__note">No changes.</p>;
      return (
        <>
          <AgentDiffHunks hunks={state.hunks} label={`${path} diff`} layout={layout} path={path} />
          {state.hiddenChangedLines > 0 && (
            <p className="cv-diff-file__note" role="status">
              {`${state.hiddenChangedLines} more changed ${state.hiddenChangedLines === 1 ? "line is" : "lines are"} not shown here.`}
            </p>
          )}
        </>
      );
    default:
      return assertNever(state);
  }
}

function useTextDiff(
  original: string,
  modified: string,
  computation: DiffViewComputationGateway,
  loading: boolean,
): TextDiffState {
  const [keyed, setKeyed] = useState<KeyedTextDiffState | null>(null);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    const publish = (state: TextDiffState) => {
      if (controller.signal.aborted) return;
      setKeyed({ original, modified, computation, state });
    };
    computation
      .compute({ original, modified, ignoreWhitespace: false }, controller.signal)
      .then((result) => publish(stateForResult(result)))
      .catch((error: unknown) => publish({ kind: "failed", message: errorMessage(error) }));
    return () => controller.abort();
  }, [computation, loading, modified, original]);
  if (
    keyed === null ||
    keyed.original !== original ||
    keyed.modified !== modified ||
    keyed.computation !== computation
  ) {
    return { kind: "computing" };
  }
  return keyed.state;
}

function stateForResult(result: LineDiffResult): TextDiffState {
  switch (result.kind) {
    case "tooLarge":
      return { kind: "tooLarge" };
    case "ready": {
      const limited = limitDiffHunks(
        groupDiffHunks(result.lines),
        MAX_RENDERED_DIFF_LINES_PER_FILE,
      );
      return {
        kind: "ready",
        hunks: limited.hunks,
        added: result.added,
        deleted: result.deleted,
        hiddenChangedLines: limited.hiddenChangedLines,
      };
    }
    default:
      return assertNever(result);
  }
}

function formatChars(count: number): string {
  return count.toLocaleString("en-US");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The diff could not be computed.";
}

function assertNever(value: never): never {
  throw new Error(`Unexpected text diff state: ${JSON.stringify(value)}`);
}
