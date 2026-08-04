import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * React only takes its eager bail-out path for a value-preserving `setState`
 * while the owning fiber has no pending lanes. A publication made from the
 * effect flush that follows a commit never meets that precondition, so an
 * unchanged value still schedules a full re-render of the owning hook. This
 * state hook resolves the next value against a live mirror at dispatch time and
 * skips the dispatch entirely when nothing changed.
 */
export function useCommitBailoutState<T>(
  initialState: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(initialState);
  const latestRef = useRef(state);
  const publish = useCallback((action: SetStateAction<T>) => {
    const next = resolveNextState(action, latestRef.current);

    if (Object.is(next, latestRef.current)) {
      return;
    }

    latestRef.current = next;
    setState(next);
  }, []);

  return [state, publish];
}

function resolveNextState<T>(action: SetStateAction<T>, current: T): T {
  if (typeof action !== "function") {
    return action;
  }

  return (action as (previous: T) => T)(current);
}
