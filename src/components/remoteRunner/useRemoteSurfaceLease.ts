import { useLayoutEffect, useMemo, useRef } from "react";
import { remoteSurfaceScopeKey, type RemoteSurfaceScope } from "../../domain/remoteRunnerSurfaces";

/** Every transition is a new lease, including returning to the same checkout. */
export function useRemoteSurfaceLease(owner: RemoteSurfaceScope) {
  const key = remoteSurfaceScopeKey(owner);
  const token = useMemo(() => ({ key }), [key]);
  const current = useRef<typeof token | null>(token);
  useLayoutEffect(() => {
    current.current = token;
    return () => {
      current.current = null;
    };
  }, [token]);
  return useMemo(() => ({ key, isCurrent: () => current.current === token }), [key, token]);
}
