import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import {
  createRemoteFileRevealRequest,
  type RemoteFileRevealRequest,
} from "../../application/remoteFileRevealRequest";
import { remoteSurfaceScopeKey } from "../../domain/remoteRunnerSurfaces";
import { agentLocalFileLinkNotice } from "./agentMarkdownLinks";
import { remoteSurfaceSupports, type AgentRemoteSurface } from "./agentRemoteSurface";
import type { AgentRemoteFileLinkPort, AgentRemoteFileOpenOutcome } from "./agentRemoteFileLinks";

export const REMOTE_FILE_REVEAL_ACCEPT_TIMEOUT_MS = 10_000;

export interface AgentRemoteFileLinksOptions {
  readonly surface: AgentRemoteSurface | null;
  readonly openFiles: () => void;
  readonly reportNotice: (notice: AgentTasksNotice) => void;
}

export interface AgentRemoteFileLinks {
  readonly port: AgentRemoteFileLinkPort;
  readonly reveal: RemoteFileRevealRequest | null;
}

export function useAgentRemoteFileLinks({
  surface,
  openFiles,
  reportNotice,
}: AgentRemoteFileLinksOptions): AgentRemoteFileLinks {
  const surfaceKey = surface === null ? null : remoteSurfaceScopeKey(surface.scope);
  const latestSurface = useRef(surface);
  const latestOpenFiles = useRef(openFiles);
  useLayoutEffect(() => {
    latestSurface.current = surface;
    latestOpenFiles.current = openFiles;
  });
  const sequence = useRef(0);
  const pendingRef = useRef<RemoteFileRevealRequest | null>(null);
  const [pending, setPending] = useState<RemoteFileRevealRequest | null>(null);

  const filesSupported = remoteSurfaceSupports(surface, "files");
  useEffect(() => {
    const current = pendingRef.current;
    if (current === null) return;
    if (remoteSurfaceScopeKey(current.scope) !== surfaceKey) {
      current.settle("superseded");
      return;
    }
    if (!filesSupported) current.settle("filesUnavailable");
  }, [filesSupported, surfaceKey]);
  useEffect(() => () => pendingRef.current?.settle("superseded"), []);

  const port = useMemo<AgentRemoteFileLinkPort>(
    () => ({
      open: ({ scope, target }) => {
        const current = latestSurface.current;
        if (
          current === null ||
          remoteSurfaceScopeKey(current.scope) !== remoteSurfaceScopeKey(scope)
        )
          return Promise.resolve<AgentRemoteFileOpenOutcome>("superseded");
        pendingRef.current?.settle("superseded");
        if (!remoteSurfaceSupports(current, "files"))
          return Promise.resolve<AgentRemoteFileOpenOutcome>("filesUnavailable");
        return new Promise<AgentRemoteFileOpenOutcome>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const stopTimer = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
          };
          const request = createRemoteFileRevealRequest(++sequence.current, current.scope, target, {
            accepted: stopTimer,
            settled: (outcome) => {
              stopTimer();
              if (pendingRef.current === request) pendingRef.current = null;
              setPending((shown) => (shown === request ? null : shown));
              resolve(outcome);
            },
          });
          timer = setTimeout(
            () => request.settle("filesUnavailable"),
            REMOTE_FILE_REVEAL_ACCEPT_TIMEOUT_MS,
          );
          pendingRef.current = request;
          setPending(request);
          latestOpenFiles.current();
        });
      },
      report: (failure) => reportNotice(agentLocalFileLinkNotice(failure)),
    }),
    [reportNotice],
  );
  const reveal =
    pending !== null && remoteSurfaceScopeKey(pending.scope) === surfaceKey ? pending : null;
  return { port, reveal };
}
