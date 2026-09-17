import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../domain/remoteRunnerSurfaces";

export type RemoteTerminalState =
  | { readonly kind: "connecting" | "connected" | "reconnecting" | "closing" | "closed" }
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "error"; readonly message: string };

interface Options {
  readonly gateway: RemoteRunnerSurfacesGateway;
  readonly scope: RemoteSurfaceScope;
  readonly size: { readonly cols: number; readonly rows: number };
  readonly writeOutput: (data: string) => Promise<void>;
  readonly onState: (state: RemoteTerminalState) => void;
}

/** A mounted output subscription; the server owns the primary PTY's lifetime. */
export function createRemoteTerminalSession({
  gateway,
  scope,
  size,
  writeOutput,
  onState,
}: Options) {
  let disposed = false;
  let terminalId: string | null = null;
  let cursor = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;
  let queuedBytes = 0;
  let inputQueue = Promise.resolve();
  let inputEpoch = 0;
  let pollEpoch = 0;
  let notice: string | null = null;
  let resizing = false;
  let pendingSize: typeof size | null = size;
  const active = () => !disposed && !stopped;
  const publish = (state: RemoteTerminalState) => {
    if (!disposed)
      onState(state.kind === "connected" && notice ? { kind: "error", message: notice } : state);
  };
  const failure = (message: string) => {
    notice = message;
    publish({ kind: "error", message });
  };
  const schedule = (delay: number) => {
    if (active())
      timer = setTimeout(() => {
        void poll();
      }, delay);
  };
  const poll = async () => {
    const epoch = pollEpoch;
    const current = () => active() && epoch === pollEpoch;
    if (!current()) return;
    try {
      if (!terminalId) {
        const opened = await gateway.openTerminal({ ...scope, ...size });
        if (!current()) return;
        if (opened.projectId !== scope.projectId || opened.taskId !== (scope.taskId ?? null)) {
          stopped = true;
          failure("The server returned a terminal for a different checkout.");
          return;
        }
        terminalId = opened.id;
        void flushResize();
      }
      const result = await gateway.pollTerminal({ ...scope, terminalId, after: cursor });
      if (!current()) return;
      if (
        result.id !== terminalId ||
        result.projectId !== scope.projectId ||
        result.taskId !== (scope.taskId ?? null)
      ) {
        stopped = true;
        failure("The server returned a terminal for a different checkout.");
        return;
      }
      if (result.truncated) {
        await writeOutput("\r\n[Earlier terminal output is no longer available.]\r\n");
        if (!current()) return;
      }
      for (const chunk of result.chunks) {
        if (chunk.sequence <= cursor) continue;
        if (!result.truncated && chunk.sequence !== cursor + 1) {
          throw new Error("Terminal output sequence is incomplete.");
        }
        cursor = chunk.sequence;
        await writeOutput(chunk.data);
        if (!current()) return;
      }
      retryDelay = 1_000;
      if (result.status === "exited" && cursor >= result.sequence) {
        stopped = true;
        publish({ kind: "exited", exitCode: result.exitCode });
        return;
      }
      publish({ kind: "connected" });
      schedule(cursor < result.sequence ? 0 : 200);
    } catch {
      if (!current()) return;
      publish({ kind: "reconnecting" });
      schedule(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }
  };
  const flushResize = async () => {
    if (resizing || !terminalId || !active()) return;
    resizing = true;
    try {
      while (pendingSize && active()) {
        const next = pendingSize;
        pendingSize = null;
        await gateway.resizeTerminal({ ...scope, terminalId, ...next });
        if (!active()) return;
      }
    } catch {
      if (active()) failure("Could not resize the terminal. Resize the panel to retry.");
    } finally {
      resizing = false;
    }
  };
  publish({ kind: "connecting" });
  void poll();
  return {
    dispose() {
      disposed = true;
      clearTimeout(timer);
      pendingSize = null;
    },
    write(data: string) {
      if (!active() || !terminalId) return;
      const bytes = new TextEncoder().encode(data).byteLength;
      if (bytes + queuedBytes > 65_536) {
        failure("Terminal input is too large. Paste a smaller amount.");
        return;
      }
      const id = terminalId;
      const epoch = inputEpoch;
      queuedBytes += bytes;
      inputQueue = inputQueue.then(async () => {
        try {
          if (!active() || epoch !== inputEpoch) return;
          await gateway.writeTerminal({ ...scope, terminalId: id, data });
          if (!active()) return;
          notice = null;
        } catch {
          if (active()) {
            inputEpoch += 1;
            failure("Terminal input could not be confirmed. It was not sent again.");
          }
        } finally {
          queuedBytes -= bytes;
        }
      });
    },
    resize(next: typeof size) {
      if (!active()) return;
      pendingSize = {
        cols: Math.max(2, Math.min(500, next.cols)),
        rows: Math.max(1, Math.min(300, next.rows)),
      };
      void flushResize();
    },
    async close() {
      if (disposed || stopped || !terminalId) return;
      stopped = true;
      pollEpoch += 1;
      inputEpoch += 1;
      clearTimeout(timer);
      publish({ kind: "closing" });
      try {
        await gateway.closeTerminal({ ...scope, terminalId });
        if (disposed) return;
        publish({ kind: "closed" });
      } catch {
        if (disposed) return;
        stopped = false;
        failure("Closing the terminal could not be confirmed. Reconnecting…");
        schedule(1_000);
      }
    },
  };
}
