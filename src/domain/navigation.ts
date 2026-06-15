import type { EditorRevealTarget } from "./languageServerFeatures";

export type NavigationLocation = EditorRevealTarget;

export interface NavigationHistory {
  backStack: NavigationLocation[];
  forwardStack: NavigationLocation[];
}

const MAX_STACK_DEPTH = 100;

export function createNavigationHistory(): NavigationHistory {
  return {
    backStack: [],
    forwardStack: [],
  };
}

export function recordNavigationLocation(
  history: NavigationHistory,
  location: NavigationLocation | null,
): NavigationHistory {
  if (!location) {
    return history;
  }

  if (sameLocation(history.backStack[history.backStack.length - 1], location)) {
    return history;
  }

  return {
    backStack: [...history.backStack, location].slice(-MAX_STACK_DEPTH),
    forwardStack: [],
  };
}

export function navigateBack(
  history: NavigationHistory,
  current: NavigationLocation | null,
): { history: NavigationHistory; target: NavigationLocation | null } {
  const target = history.backStack[history.backStack.length - 1];

  if (!target) {
    return { history, target: null };
  }

  return {
    history: {
      backStack: history.backStack.slice(0, -1),
      forwardStack: current
        ? [current, ...history.forwardStack].slice(0, MAX_STACK_DEPTH)
        : history.forwardStack,
    },
    target,
  };
}

export function navigateForward(
  history: NavigationHistory,
  current: NavigationLocation | null,
): { history: NavigationHistory; target: NavigationLocation | null } {
  const [target, ...rest] = history.forwardStack;

  if (!target) {
    return { history, target: null };
  }

  return {
    history: {
      backStack: current
        ? [...history.backStack, current].slice(-MAX_STACK_DEPTH)
        : history.backStack,
      forwardStack: rest,
    },
    target,
  };
}

function sameLocation(
  left: NavigationLocation | undefined,
  right: NavigationLocation,
): boolean {
  if (!left) {
    return false;
  }

  return (
    left.path === right.path &&
    left.position.lineNumber === right.position.lineNumber &&
    left.position.column === right.position.column
  );
}
