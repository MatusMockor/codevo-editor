import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitSurfaceStatus,
  GitSurfaceStatusGateway,
  GitSurfaceTarget,
} from "../../domain/gitSurfaceStatus";
import { useLatest } from "../../ui/foundation/useLatest";

export type GitSurfaceStatusLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly previous: GitSurfaceStatus | null }
  | { readonly kind: "ready"; readonly status: GitSurfaceStatus }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly previous: GitSurfaceStatus | null;
    };

export interface GitSurfaceStatusSnapshot {
  readonly load: GitSurfaceStatusLoad;
  refresh(): void;
}

export interface UseGitSurfaceStatusOptions {
  readonly gateway: GitSurfaceStatusGateway | null;
  readonly target: GitSurfaceTarget | null;
  readonly enabled: boolean;
}

interface KeyedLoad {
  readonly key: string | null;
  readonly load: GitSurfaceStatusLoad;
}

const IDLE: GitSurfaceStatusLoad = { kind: "idle" };
const FALLBACK_FAILURE = "Git status is unavailable.";

export function gitSurfaceStatusValue(load: GitSurfaceStatusLoad): GitSurfaceStatus | null {
  switch (load.kind) {
    case "idle":
      return null;
    case "loading":
      return load.previous;
    case "ready":
      return load.status;
    case "failed":
      return load.previous;
    default: {
      const exhaustive: never = load;
      return exhaustive;
    }
  }
}

function previousValue(previous: KeyedLoad, key: string): GitSurfaceStatus | null {
  if (previous.key !== key) {
    return null;
  }
  return gitSurfaceStatusValue(previous.load);
}

export function useGitSurfaceStatus({
  enabled,
  gateway,
  target,
}: UseGitSurfaceStatusOptions): GitSurfaceStatusSnapshot {
  const targetKey =
    target === null ? null : JSON.stringify([target.repositoryRoot, target.worktreePath]);
  const [state, setState] = useState<KeyedLoad>({ key: null, load: IDLE });
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const gatewayRef = useLatest(gateway);
  const targetRef = useLatest(target);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const activeGateway = gatewayRef.current;
    const activeTarget = targetRef.current;
    if (!enabled || activeGateway === null || activeTarget === null || targetKey === null) {
      setState({ key: targetKey, load: IDLE });
      return;
    }
    setState((previous) => ({
      key: targetKey,
      load: { kind: "loading", previous: previousValue(previous, targetKey) },
    }));
    activeGateway.getSurfaceStatus(activeTarget).then(
      (status) => {
        if (generation.current !== current) {
          return;
        }
        setState({ key: targetKey, load: { kind: "ready", status } });
      },
      (error: unknown) => {
        if (generation.current !== current) {
          return;
        }
        setState((previous) => ({
          key: targetKey,
          load: {
            kind: "failed",
            message: error instanceof Error ? error.message : FALLBACK_FAILURE,
            previous: previousValue(previous, targetKey),
          },
        }));
      },
    );
  }, [enabled, gatewayRef, nonce, targetKey, targetRef]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const load = state.key === targetKey ? state.load : IDLE;
  return useMemo(() => ({ load, refresh }), [load, refresh]);
}
