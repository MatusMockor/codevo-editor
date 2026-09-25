import { RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ActiveDebugAdapterKind } from "../../application/useDebugSession";
import type { StackFrame } from "../../domain/debug";
import type { DebuggerSessionSnapshot } from "../../domain/debugSessionState";
import type { DebugRestartFrameCommand } from "../DebugPanel";
import { useWindowedRows } from "../useWindowedRows";
import { DebugActionButton } from "./DebugActionButton";
import { displayPath } from "./debugLocationLabels";
import {
  CALL_STACK_ROW_HEIGHT,
  DEBUG_LIST_VIEWPORT_HEIGHT,
  DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
} from "./debugListLayout";

const EMPTY_STACK_FRAMES: readonly StackFrame[] = Object.freeze([]);

export function CallStack({
  debugAdapterKind,
  debugControlPending,
  debugRestartFrame,
  onNavigateToFrame,
  onSelectFrame,
  rootPath,
  selectedFrameId,
  snapshot,
  workspaceTrusted,
}: {
  debugAdapterKind: ActiveDebugAdapterKind;
  debugControlPending: boolean;
  debugRestartFrame?: DebugRestartFrameCommand;
  onNavigateToFrame(filePath: string, lineNumber: number): void;
  onSelectFrame(frameId: number): void;
  rootPath: string | null;
  selectedFrameId: number | null;
  snapshot: DebuggerSessionSnapshot;
  workspaceTrusted: boolean;
}) {
  const state = snapshot.state;
  const [rovingFrameId, setRovingFrameId] = useState<number | null>(null);
  const frameButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const frameFocusOwnedRef = useRef(false);
  const previousSelectedFrameIdRef = useRef(selectedFrameId);
  const visibleFrames = state.kind === "stopped" ? state.frames : EMPTY_STACK_FRAMES;
  const highlightedFrameId =
    state.kind === "stopped" ? (selectedFrameId ?? state.topFrame?.frameId ?? null) : null;
  const visibleFrameIds = visibleFrames.map(({ frameId }) => frameId).join(":");
  const rovingFrameIndex = visibleFrames.findIndex(({ frameId }) => frameId === rovingFrameId);
  const highlightedFrameIndex = visibleFrames.findIndex(
    ({ frameId }) => frameId === highlightedFrameId,
  );
  const pinnedFrameIndices = useMemo(
    () => [...new Set([rovingFrameIndex, highlightedFrameIndex].filter((index) => index >= 0))],
    [highlightedFrameIndex, rovingFrameIndex],
  );
  const estimateFrameHeight = useCallback(() => CALL_STACK_ROW_HEIGHT, []);
  const keyForFrameIndex = useCallback(
    (index: number) => String(visibleFrames[index]?.frameId ?? index),
    [visibleFrames],
  );
  const windowedFrames = useWindowedRows({
    enabled: visibleFrames.length > DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
    estimateHeight: estimateFrameHeight,
    fallbackViewportHeight: DEBUG_LIST_VIEWPORT_HEIGHT,
    itemCount: visibleFrames.length,
    keyForIndex: keyForFrameIndex,
    pinnedIndices: pinnedFrameIndices,
  });
  const scrollToFrameIndex = windowedFrames.scrollToIndex;

  useEffect(() => {
    const selectionChanged = previousSelectedFrameIdRef.current !== selectedFrameId;
    previousSelectedFrameIdRef.current = selectedFrameId;
    if (visibleFrames.length === 0) {
      frameFocusOwnedRef.current = false;
      if (rovingFrameId !== null) setRovingFrameId(null);
      return;
    }
    const selectedIsVisible = visibleFrames.some(({ frameId }) => frameId === selectedFrameId);
    const rovingIsVisible = visibleFrames.some(({ frameId }) => frameId === rovingFrameId);
    const highlightedIsVisible = visibleFrames.some(
      ({ frameId }) => frameId === highlightedFrameId,
    );
    const nextFrameId: number =
      selectionChanged && selectedIsVisible
        ? selectedFrameId!
        : rovingIsVisible
          ? rovingFrameId!
          : highlightedIsVisible
            ? highlightedFrameId!
            : visibleFrames[0]!.frameId;
    const activeFrameIsVisible = [...frameButtonRefs.current.values()].some(
      (element) => element === document.activeElement,
    );
    if (rovingFrameId !== nextFrameId) setRovingFrameId(nextFrameId);
    if (frameFocusOwnedRef.current && !activeFrameIsVisible) {
      frameButtonRefs.current.get(nextFrameId)?.focus();
    }
  }, [highlightedFrameId, rovingFrameId, selectedFrameId, visibleFrameIds, visibleFrames]);

  useLayoutEffect(() => {
    if (highlightedFrameIndex >= 0) {
      scrollToFrameIndex(highlightedFrameIndex, "nearest");
    }
  }, [highlightedFrameIndex, scrollToFrameIndex]);

  if (state.kind !== "stopped") {
    return <div className="cv-debug__message">Not paused</div>;
  }

  const rovingFrame = state.frames.some(({ frameId }) => frameId === rovingFrameId)
    ? rovingFrameId
    : state.frames.some(({ frameId }) => frameId === highlightedFrameId)
      ? highlightedFrameId
      : (state.frames[0]?.frameId ?? null);

  if (state.frames.length === 0) {
    return (
      <div
        data-testid={state.framesTruncated ? "debug-stack-truncated" : undefined}
        role={state.framesTruncated ? "status" : undefined}
        className="cv-debug__message"
      >
        {state.framesTruncated
          ? "Stack trace truncated; no inspectable frames were retained."
          : "No stack frames"}
      </div>
    );
  }

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, frameId: number) => {
    const currentIndex = state.frames.findIndex((frame) => frame.frameId === frameId);
    if (currentIndex < 0) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + 1, state.frames.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = state.frames.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextFrameId = state.frames[nextIndex]?.frameId;
    if (nextFrameId === undefined) return;
    setRovingFrameId(nextFrameId);
    scrollToFrameIndex(nextIndex, "nearest");
    const mountedFrame = frameButtonRefs.current.get(nextFrameId);
    if (mountedFrame) {
      mountedFrame.focus();
    } else {
      requestAnimationFrame(() => frameButtonRefs.current.get(nextFrameId)?.focus());
    }
  };

  return (
    <>
      {state.framesTruncated ? (
        <div data-testid="debug-stack-truncated" role="status" className="cv-debug__message">
          Stack trace truncated to the inspectable frame limit.
        </div>
      ) : null}
      <div
        aria-label="Call stack frames"
        onScroll={windowedFrames.onScroll}
        ref={windowedFrames.containerRef}
        role="list"
        className="cv-debug__windowed-list"
      >
        <div className="cv-debug__windowed-body" style={{ height: windowedFrames.totalHeight }}>
          {windowedFrames.rows.map(({ index, offsetTop }) => {
            const frame = state.frames[index];
            if (!frame) return null;
            const selected = frame.frameId === highlightedFrameId;
            const showRestart =
              selected &&
              index === state.frames.findIndex(({ frameId }) => frameId === highlightedFrameId) &&
              debugAdapterKind === "node" &&
              !debugControlPending &&
              workspaceTrusted &&
              frameAllowsInlineActions(frame) &&
              canRestartFrame(debugRestartFrame);
            return (
              <div
                aria-posinset={index + 1}
                aria-setsize={state.frames.length}
                key={frame.frameId}
                ref={(element) => windowedFrames.measureRow(String(frame.frameId), element)}
                role="listitem"
                className="cv-debug__windowed-row cv-debug__frame"
                data-selected={selected ? "true" : undefined}
                style={{ top: offsetTop }}
              >
                <button
                  aria-current={selected ? "true" : undefined}
                  data-testid="debug-frame"
                  onClick={() => activateFrame(frame, onSelectFrame, onNavigateToFrame)}
                  onBlur={(event) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof HTMLElement) || next.dataset.testid !== "debug-frame") {
                      frameFocusOwnedRef.current = false;
                    }
                  }}
                  onFocus={() => {
                    frameFocusOwnedRef.current = true;
                    setRovingFrameId(frame.frameId);
                  }}
                  onKeyDown={(event) => moveFocus(event, frame.frameId)}
                  ref={(element) => {
                    if (element) frameButtonRefs.current.set(frame.frameId, element);
                    else frameButtonRefs.current.delete(frame.frameId);
                  }}
                  className="cv-debug__frame-button"
                  tabIndex={frame.frameId === rovingFrame ? 0 : -1}
                  type="button"
                >
                  {frame.name}{" "}
                  <span className="cv-debug__muted">
                    {frame.filePath
                      ? `${displayPath(rootPath, frame.filePath)}:${frame.lineNumber}`
                      : `line ${frame.lineNumber}`}
                  </span>
                </button>
                {showRestart ? (
                  <DebugActionButton
                    disabled={false}
                    label="Restart Frame"
                    onClick={() => {
                      if (canRestartFrame(debugRestartFrame)) debugRestartFrame?.restartFrame();
                    }}
                    title="Restart Frame"
                  >
                    <RotateCw aria-hidden="true" size={12} />
                  </DebugActionButton>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function canRestartFrame(command: DebugRestartFrameCommand | undefined): boolean {
  try {
    return command?.canRestartFrame() === true;
  } catch {
    return false;
  }
}

function frameAllowsInlineActions(frame: StackFrame): boolean {
  const presentationHint = (frame as StackFrame & { presentationHint?: unknown }).presentationHint;
  return presentationHint !== "label" && presentationHint !== "subtle";
}

function activateFrame(
  frame: StackFrame,
  onSelectFrame: (frameId: number) => void,
  onNavigateToFrame: (filePath: string, lineNumber: number) => void,
) {
  onSelectFrame(frame.frameId);

  if (frame.filePath === null) {
    return;
  }

  onNavigateToFrame(frame.filePath, frame.lineNumber);
}
