import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BottomPanelView } from "../domain/bottomPanel";

export interface WorkbenchBottomPanelState {
  readonly view: BottomPanelView;
  readonly visible: boolean;
}

export interface AgentLayoutBottomPanel {
  readonly bottomPanelView: BottomPanelView;
  readonly bottomPanelVisible: boolean;
  readonly setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  readonly setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  readonly agentLayoutRef: { current: boolean };
}

const INITIAL_BOTTOM_PANEL: WorkbenchBottomPanelState = { view: "problems", visible: false };

export function nextBottomPanelView(
  current: WorkbenchBottomPanelState,
  requested: BottomPanelView,
  agentLayout: boolean,
): WorkbenchBottomPanelState {
  if (agentLayout && requested !== "terminal") return current;
  if (current.view === requested) return current;
  return { ...current, view: requested };
}

export function nextBottomPanelVisibility(
  current: WorkbenchBottomPanelState,
  requested: boolean,
  agentLayout: boolean,
  rejectedViewPending: boolean,
): WorkbenchBottomPanelState {
  if (!agentLayout || !requested) {
    return current.visible === requested ? current : { ...current, visible: requested };
  }
  if (rejectedViewPending) return current;
  if (current.visible && current.view === "terminal") return current;
  return { view: "terminal", visible: true };
}

export function useAgentLayoutBottomPanel(): AgentLayoutBottomPanel {
  const [state, setState] = useState<WorkbenchBottomPanelState>(INITIAL_BOTTOM_PANEL);
  const agentLayoutRef = useRef(false);
  const rejectedViewRef = useRef(false);

  const setView = useCallback<Dispatch<SetStateAction<BottomPanelView>>>((action) => {
    setState((current) => {
      const requested = typeof action === "function" ? action(current.view) : action;
      return nextBottomPanelView(current, requested, agentLayoutRef.current);
    });
    if (agentLayoutRef.current && typeof action !== "function" && action !== "terminal") {
      markRejectedView(rejectedViewRef);
    }
  }, []);

  const setVisible = useCallback<Dispatch<SetStateAction<boolean>>>((action) => {
    const rejectedViewPending = rejectedViewRef.current;
    setState((current) => {
      const requested = typeof action === "function" ? action(current.visible) : action;
      return nextBottomPanelVisibility(
        current,
        requested,
        agentLayoutRef.current,
        rejectedViewPending,
      );
    });
  }, []);

  return {
    bottomPanelView: state.view,
    bottomPanelVisible: state.visible,
    setBottomPanelView: setView,
    setBottomPanelVisible: setVisible,
    agentLayoutRef,
  };
}

function markRejectedView(rejectedViewRef: { current: boolean }): void {
  if (rejectedViewRef.current) return;
  rejectedViewRef.current = true;
  queueMicrotask(() => {
    rejectedViewRef.current = false;
  });
}
