import {
  CircleX,
  MoreHorizontal,
  Search,
  SquareSplitHorizontal,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cx } from "../../ui/foundation/classNames";
import { IconButton } from "../../ui/foundation/IconButton";
import { EditorActivityIndicator } from "./EditorActivityIndicator";
import { useEditorChrome } from "./EditorChromeContext";
import { EditorCursorPosition } from "./EditorCursorPosition";
import { EditorMoreMenu } from "./EditorMoreMenu";
import { EditorNodeRunChip } from "./EditorNodeRunChip";

export interface EditorSubheaderActionsProps {
  readonly groupId: string | null;
  onFind(): void;
}

export function EditorSubheaderActions({ groupId, onFind }: EditorSubheaderActionsProps) {
  const chrome = useEditorChrome();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  if (chrome === null || chrome.activeGroupId !== groupId) return null;
  const { errors, warnings } = chrome.diagnostics;
  const diagLabel = `${countLabel(errors, "error")}, ${countLabel(warnings, "warning")}. Show problems`;
  return (
    <div
      className={cx("cv-esub__acts", (chrome.problemsOpen || moreOpen) && "cv-esub__acts--pinned")}
    >
      {chrome.nodeRun === null ? null : (
        <EditorNodeRunChip nodeRun={chrome.nodeRun} onStop={chrome.stopNodeRun} />
      )}
      {chrome.activity === null ? null : (
        <EditorActivityIndicator activity={chrome.activity} onOpen={chrome.openRuntimeView} />
      )}
      {chrome.cursorVisible && chrome.cursorStore !== null ? (
        <EditorCursorPosition
          authority={chrome.cursorAuthority}
          onShowGoToLine={chrome.showGoToLine}
          store={chrome.cursorStore}
        />
      ) : null}
      <button
        aria-label={diagLabel}
        aria-pressed={chrome.problemsOpen}
        className="cv-esub__diag"
        onClick={chrome.toggleProblems}
        title={`Problems ${chrome.shortcuts.problems}`}
        type="button"
      >
        <span className="cv-esub__diag-e">
          <CircleX aria-hidden="true" size={12} />
          {errors}
        </span>
        <span className="cv-esub__diag-w">
          <TriangleAlert aria-hidden="true" size={12} />
          {warnings}
        </span>
      </button>
      <IconButton
        icon={<Search size={14} />}
        label="Find in file"
        onClick={onFind}
        size="xs"
        title={`Find ${chrome.shortcuts.find}`}
      />
      <IconButton
        icon={<SquareSplitHorizontal size={14} />}
        label="Split editor"
        onClick={chrome.splitRight}
        size="xs"
        title={`Split editor ${chrome.shortcuts.split}`}
      />
      <IconButton
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        icon={<MoreHorizontal size={14} />}
        label="More editor actions"
        onClick={() => setMoreOpen((open) => !open)}
        ref={moreRef}
        size="xs"
      />
      <EditorMoreMenu anchorRef={moreRef} chrome={chrome} onClose={closeMore} open={moreOpen} />
    </div>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
