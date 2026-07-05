import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createNavigationHistory,
  type NavigationHistory,
} from "../domain/navigation";

export interface NavigationHistoryLifecycle {
  navigationHistory: NavigationHistory;
  setNavigationHistory: Dispatch<SetStateAction<NavigationHistory>>;
  resetHistory: () => void;
  restoreHistory: (history: NavigationHistory) => void;
}

/**
 * Owns the per-workspace back/forward stack state and exposes explicit reset /
 * restore hooks for the workbench's workspace-cache lifecycle.
 */
export function useNavigationHistoryLifecycle(): NavigationHistoryLifecycle {
  const [navigationHistory, setNavigationHistory] =
    useState<NavigationHistory>(createNavigationHistory);

  const resetHistory = useCallback(() => {
    setNavigationHistory(createNavigationHistory());
  }, []);

  const restoreHistory = useCallback((history: NavigationHistory) => {
    setNavigationHistory(history);
  }, []);

  return {
    navigationHistory,
    resetHistory,
    restoreHistory,
    setNavigationHistory,
  };
}
