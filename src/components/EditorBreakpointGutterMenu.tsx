import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type * as Monaco from "monaco-editor";
import {
  useEditorBreakpointGutterMenu,
  type EditorBreakpointGutterActions,
  type EditorBreakpointGutterEditorKind,
  type EditorBreakpointGutterEditorValues,
  type EditorBreakpointGutterRequest,
} from "../application/useEditorBreakpointGutterMenu";
import type { Breakpoint } from "../domain/debug";
import {
  debugBreakpointConditionError,
  debugBreakpointConditionValue,
  type DebugBreakpointGutterMenuItem,
} from "../domain/debugBreakpointGutterMenu";
import {
  breakpointHitConditionError,
  formatBreakpointHitCondition,
  parseBreakpointHitCondition,
} from "../domain/debugBreakpointHitCondition";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
} from "../domain/debugBreakpointLogMessage";

export type { EditorBreakpointGutterActions };

interface Props {
  readonly actions?: Partial<EditorBreakpointGutterActions>;
  readonly activeDocumentPath: string | undefined;
  readonly breakpoints: readonly Breakpoint[];
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly modelIdentity: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly onMutationError?: (error: unknown) => void;
  readonly toggleBreakpointFallback?: EditorBreakpointGutterActions["toggleBreakpoint"];
  readonly workspaceRoot: string | null;
}

export function EditorBreakpointGutterMenu(props: Props) {
  const coordinator = useEditorBreakpointGutterMenu(props);
  if (!coordinator.request) return null;
  if (coordinator.request.view === "menu") {
    return createPortal(
      <BreakpointMenu
        items={coordinator.items}
        onCancel={() => coordinator.close(true)}
        onSelect={coordinator.selectMenuItem}
        popoverId={coordinator.popoverId}
        request={coordinator.request}
      />,
      document.body,
    );
  }
  return createPortal(
    <BreakpointEditor
      breakpoint={coordinator.currentBreakpoint}
      kind={coordinator.request.view}
      onCancel={() => coordinator.close(true)}
      onSave={coordinator.save}
      popoverId={coordinator.popoverId}
      request={coordinator.request}
    />,
    document.body,
  );
}

function BreakpointMenu({
  items,
  onCancel,
  onSelect,
  popoverId,
  request,
}: {
  readonly items: readonly DebugBreakpointGutterMenuItem[];
  onCancel(): void;
  onSelect(item: DebugBreakpointGutterMenuItem): void;
  readonly popoverId: string;
  readonly request: EditorBreakpointGutterRequest;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  useLayoutEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);
  const focusItem = (index: number) => {
    setActiveIndex(index);
    rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]').item(index).focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const activeItem = items[activeIndex];
      if (!activeItem) return;
      onSelect(activeItem);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    focusItem((activeIndex + direction + items.length) % items.length);
  };
  return (
    <div
      aria-label={`Breakpoint actions for line ${request.lineNumber}`}
      className="breakpoint-editor-popover breakpoint-editor-menu"
      data-editor-breakpoint-gutter-menu={popoverId}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="menu"
      style={boundedPosition(request.anchor, 228, 230)}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          onFocus={() => setActiveIndex(index)}
          role="menuitem"
          tabIndex={index === activeIndex ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function BreakpointEditor({
  breakpoint,
  kind,
  onCancel,
  onSave,
  popoverId,
  request,
}: {
  readonly breakpoint: Breakpoint | null;
  readonly kind: EditorBreakpointGutterEditorKind;
  onCancel(): void;
  onSave(values: EditorBreakpointGutterEditorValues): Promise<boolean>;
  readonly popoverId: string;
  readonly request: EditorBreakpointGutterRequest;
}) {
  const errorId = `${useId()}-error`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [condition, setCondition] = useState(breakpoint?.condition ?? "");
  const [hitCondition, setHitCondition] = useState(
    formatBreakpointHitCondition(breakpoint?.hitCondition),
  );
  const [logMessage, setLogMessage] = useState(breakpoint?.logMessage ?? "");
  const [pending, setPending] = useState(false);
  const conditionValue = debugBreakpointConditionValue(condition);
  const conditionError =
    kind === "conditional"
      ? (debugBreakpointConditionError(condition.trim()) ??
        (!breakpoint?.condition && !conditionValue ? "A breakpoint condition is required." : null))
      : null;
  const parsedHitCondition = parseBreakpointHitCondition(hitCondition);
  const hitError =
    kind === "hitCondition"
      ? (breakpointHitConditionError(hitCondition) ??
        (!breakpoint?.hitCondition && !parsedHitCondition ? "A hit count is required." : null))
      : null;
  const logError =
    kind === "logpoint"
      ? (breakpointLogMessageError(logMessage) ??
        (!breakpoint && !isBreakpointLogMessage(logMessage)
          ? "A logpoint message is required."
          : null))
      : null;
  const error = conditionError ?? hitError ?? logError;
  const title =
    kind === "conditional"
      ? breakpoint?.condition
        ? "Edit Conditional Breakpoint"
        : "Add Conditional Breakpoint"
      : kind === "hitCondition"
        ? breakpoint?.hitCondition
          ? "Edit Breakpoint Hit Count"
          : "Add Breakpoint Hit Count"
        : breakpoint?.logMessage
          ? "Edit Logpoint"
          : "Add Logpoint";
  const submit = async () => {
    if (error || pending) return;
    setPending(true);
    const saved = await onSave({ condition, hitCondition, logMessage });
    if (!saved) setPending(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []),
    ];
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + focusable.length) % focusable.length
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };
  return (
    <div
      aria-label={`${title} at line ${request.lineNumber}`}
      aria-modal="true"
      className="breakpoint-editor-popover breakpoint-editor-dialog"
      data-editor-breakpoint-gutter-menu={popoverId}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
      style={boundedPosition(request.anchor, 376, 190)}
    >
      <span>{title}</span>
      {kind === "conditional" ? (
        <label>
          Condition
          <input
            aria-describedby={conditionError ? errorId : undefined}
            aria-invalid={conditionError ? "true" : undefined}
            aria-label="Condition"
            autoFocus
            onChange={(event) => setCondition(event.target.value)}
            value={condition}
          />
        </label>
      ) : null}
      {kind === "hitCondition" ? (
        <label>
          Hit Count
          <input
            aria-describedby={hitError ? errorId : undefined}
            aria-invalid={hitError ? "true" : undefined}
            aria-label="Hit Count"
            autoFocus
            onChange={(event) => setHitCondition(event.target.value)}
            placeholder="5, >=5, or %5"
            value={hitCondition}
          />
        </label>
      ) : null}
      {kind === "logpoint" ? (
        <label>
          Log message
          <input
            aria-describedby={logError ? errorId : undefined}
            aria-invalid={logError ? "true" : undefined}
            aria-label="Log message"
            autoFocus
            onChange={(event) => setLogMessage(event.target.value)}
            placeholder="value={value}"
            value={logMessage}
          />
        </label>
      ) : null}
      {error ? (
        <div id={errorId} role="alert">
          {error}
        </div>
      ) : null}
      <div>
        <button
          aria-label="Save breakpoint"
          disabled={Boolean(error) || pending}
          onClick={() => void submit()}
          type="button"
        >
          Save
        </button>
        <button onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

function boundedPosition(
  anchor: { readonly x: number; readonly y: number },
  width: number,
  height: number,
) {
  return {
    left: Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8)),
    maxHeight: `calc(100vh - 16px)`,
    maxWidth: `calc(100vw - 16px)`,
    overflow: "auto",
    top: Math.max(8, Math.min(anchor.y, window.innerHeight - height - 8)),
  };
}
