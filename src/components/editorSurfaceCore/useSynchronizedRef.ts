import { useEffect, type MutableRefObject } from "react";

/**
 * Keeps an imperative editor binding current after React commits.
 *
 * Using an effect is intentional: several Monaco registrations read these refs
 * from callbacks that can outlive the render that created them. Updating during
 * render would subtly change when a replacement becomes observable.
 */
export function useSynchronizedRef<Value>(ref: MutableRefObject<Value>, value: Value): void {
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
