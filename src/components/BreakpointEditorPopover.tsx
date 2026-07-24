import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { BreakpointPopoverRequest } from "./useEditorBreakpointInteractions";
import { breakpointConditionError } from "./useEditorBreakpointInteractions";
import { breakpointLogMessageEditorError } from "./useEditorBreakpointInteractions";
import {
  breakpointHitConditionError,
  formatBreakpointHitCondition,
} from "../domain/debugBreakpointHitCondition";

interface Props {
  onCancel(): void;
  onEdit(kind: "condition" | "hitCondition" | "logMessage"): void;
  onRemove(): void;
  onRemoveLogpoint(): void;
  onSave(condition: string): Promise<boolean>;
  readonly request: BreakpointPopoverRequest;
}

export function BreakpointEditorPopover({
  onCancel,
  onEdit,
  onRemove,
  onRemoveLogpoint,
  onSave,
  request,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState(
    request.editKind === "hitCondition"
      ? formatBreakpointHitCondition(request.breakpoint?.hitCondition)
      : request.editKind === "logMessage"
        ? (request.breakpoint?.logMessage ?? "")
        : (request.breakpoint?.condition ?? ""),
  );
  const [savePending, setSavePending] = useState(false);
  const error =
    request.editKind === "hitCondition"
      ? breakpointHitConditionError(value)
      : request.editKind === "logMessage"
        ? breakpointLogMessageEditorError(value, request.breakpoint !== null)
        : breakpointConditionError(value.trim());

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onCancel();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onCancel]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const style = {
    left: `${Math.max(8, request.anchor.x)}px`,
    top: `${Math.max(8, request.anchor.y)}px`,
  };
  const submit = async () => {
    if (error || savePending) return;
    setSavePending(true);
    const saved = await onSave(value);
    if (!saved) setSavePending(false);
  };

  if (request.kind === "menu") {
    const actionLabel = request.breakpoint?.condition
      ? "Edit Conditional Breakpoint"
      : "Add Conditional Breakpoint";
    return (
      <div
        aria-label={`Breakpoint actions for line ${request.lineNumber}`}
        className="breakpoint-editor-popover breakpoint-editor-menu"
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role="menu"
        style={style}
      >
        <button autoFocus onClick={() => onEdit("condition")} role="menuitem" type="button">
          {actionLabel}
        </button>
        {request.hitConditionSupported ? (
          <button onClick={() => onEdit("hitCondition")} role="menuitem" type="button">
            {request.breakpoint?.hitCondition ? "Edit Hit Count" : "Add Hit Count"}
          </button>
        ) : null}
        {request.logMessageSupported ? (
          <button onClick={() => onEdit("logMessage")} role="menuitem" type="button">
            {request.breakpoint?.logMessage ? "Edit Logpoint" : "Add Logpoint"}
          </button>
        ) : null}
        {request.logMessageSupported && request.breakpoint?.logMessage ? (
          <button onClick={onRemoveLogpoint} role="menuitem" type="button">
            Remove Logpoint
          </button>
        ) : null}
        {request.breakpoint ? (
          <button onClick={onRemove} role="menuitem" type="button">
            Remove Breakpoint
          </button>
        ) : null}
      </div>
    );
  }

  const title =
    request.editKind === "hitCondition"
      ? request.breakpoint?.hitCondition
        ? "Edit Breakpoint Hit Count"
        : "Add Breakpoint Hit Count"
      : request.editKind === "logMessage"
        ? request.breakpoint?.logMessage
          ? "Edit Logpoint"
          : "Add Logpoint"
      : request.breakpoint?.condition
        ? "Edit Conditional Breakpoint"
        : "Add Conditional Breakpoint";
  return (
    <div
      aria-label={`${title} at line ${request.lineNumber}`}
      aria-modal="false"
      className="breakpoint-editor-popover breakpoint-editor-dialog"
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
      style={style}
    >
      <label htmlFor={inputId}>{title}</label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        autoFocus
        id={inputId}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !error) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={
          request.editKind === "hitCondition"
            ? "Hit count: 5, >=5, or %5"
            : request.editKind === "logMessage"
              ? "Log message, for example value={value}"
            : "Expression, for example count > 3"
        }
        value={value}
      />
      {error ? (
        <div className="breakpoint-editor-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
      <div className="breakpoint-editor-actions">
        <button
          disabled={error !== null || savePending}
          onClick={() => void submit()}
          type="button"
        >
          {savePending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
