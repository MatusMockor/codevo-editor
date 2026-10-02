import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject,
} from "react";
import {
  remotePortErrorMessage,
  remotePortPollDelay,
  type RemoteLoopbackScheme,
  type RemotePortPreviewPort,
} from "../domain/remotePortPreview";
import type { RemotePortListing, RemotePortOwner } from "../domain/remotePortPreviewWire";
import {
  initialRemotePortPreviewState,
  remotePortPreviewAuthority,
  remotePortPreviewReducer,
  remotePortPreviewView,
  type RemotePortPreviewAction,
  type RemotePortPreviewAuthority,
  type RemotePortPreviewTarget,
  type RemotePortPreviewView,
} from "./remotePortPreviewState";

export type RemotePortPreviewInput = Readonly<{
  port: RemotePortPreviewPort;
  enabled: boolean;
  owner: RemotePortOwner | null;
  target: RemotePortPreviewTarget | null;
  activity: Readonly<{ turnActive: boolean; terminalOpen: boolean }>;
}>;
export type RemotePortOpenOptions = Readonly<{ scheme?: RemoteLoopbackScheme; path?: string }>;
export type RemotePortOpenResult =
  | Readonly<{ kind: "opened"; localPort: number }>
  | Readonly<{ kind: "failed"; reason: string }>
  | Readonly<{ kind: "stale" }>;
export type RemotePortPreviewSurface = RemotePortPreviewView &
  Readonly<{
    refresh(): void;
    open(port: number, options?: RemotePortOpenOptions): Promise<RemotePortOpenResult>;
    close(port: number): Promise<void>;
  }>;

type RemotePortSession = Readonly<{
  authority: RemotePortPreviewAuthority;
  port: RemotePortPreviewPort;
  isDisposed(): boolean;
  refresh(): Promise<void>;
  reschedule(): void;
  dispatch(action: RemotePortPreviewAction): void;
  dispose(): void;
}>;

type RemotePortSessionDeps = Readonly<{
  authority: RemotePortPreviewAuthority;
  port: RemotePortPreviewPort;
  sequence: MutableRefObject<number>;
  delay: () => number;
  dispatch: Dispatch<RemotePortPreviewAction>;
}>;

const STALE: RemotePortOpenResult = Object.freeze({ kind: "stale" });

type RemotePortMarker = Extract<RemotePortPreviewAction, { type: "mark" }>["marker"];

const markAction = (
  key: string,
  port: number,
  marker: RemotePortMarker,
): RemotePortPreviewAction => ({ type: "mark", key, port, marker });

function createRemotePortSession(deps: RemotePortSessionDeps): RemotePortSession {
  const { authority, port, sequence } = deps;
  let disposed = false;
  let inFlight = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: (() => void)[] = [];
  let serving: (() => void)[] = [];
  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clearTimer();
    timer = setTimeout(run, deps.delay());
  };
  const dispatch = (action: RemotePortPreviewAction) => {
    if (disposed) return;
    deps.dispatch(action);
  };
  const settle = (issued: number, action: RemotePortPreviewAction) => {
    if (issued !== sequence.current) return;
    dispatch(action);
  };
  const finish = () => {
    inFlight = false;
    const served = serving;
    serving = [];
    served.forEach((resolve) => resolve());
    if (disposed) return;
    if (pending) {
      pending = false;
      run();
      return;
    }
    schedule();
  };
  function run(): void {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    clearTimer();
    inFlight = true;
    sequence.current += 1;
    const issued = sequence.current;
    serving = queued;
    queued = [];
    void new Promise<RemotePortListing>((resolve) => resolve(port.list(authority.request)))
      .then(
        (listing) => settle(issued, { type: "listed", key: authority.key, listing }),
        (reason: unknown) =>
          settle(issued, {
            type: "listFailed",
            key: authority.key,
            error: remotePortErrorMessage(reason),
          }),
      )
      .finally(finish);
  }
  return {
    authority,
    port,
    isDisposed: () => disposed,
    dispatch,
    refresh: () =>
      new Promise<void>((resolve) => {
        if (disposed) return resolve();
        queued.push(resolve);
        run();
      }),
    reschedule: () => {
      if (disposed || inFlight || timer === null) return;
      schedule();
    },
    dispose: () => {
      disposed = true;
      clearTimer();
      [...queued, ...serving].forEach((resolve) => resolve());
      queued = [];
      serving = [];
    },
  };
}

async function openThroughSession(
  session: RemotePortSession,
  port: number,
  options: RemotePortOpenOptions | undefined,
): Promise<RemotePortOpenResult> {
  const mark = (marker: RemotePortMarker) =>
    session.dispatch(markAction(session.authority.key, port, marker));
  mark({ kind: "opening" });
  let localPort: number;
  try {
    const response = await session.port.open({
      ...session.authority.request,
      port,
      scheme: options?.scheme ?? "http",
      path: options?.path ?? "/",
    });
    localPort = response.localPort;
  } catch (reason) {
    if (session.isDisposed()) return STALE;
    const failure = remotePortErrorMessage(reason);
    mark({ kind: "failed", reason: failure });
    return { kind: "failed", reason: failure };
  }
  if (session.isDisposed()) return STALE;
  await session.refresh();
  if (session.isDisposed()) return STALE;
  mark(null);
  return { kind: "opened", localPort };
}

async function closeThroughSession(session: RemotePortSession, port: number): Promise<void> {
  const { serverId, ownerId, ownerGeneration, scope } = session.authority.request;
  try {
    await session.port.close({ serverId, ownerId, ownerGeneration, scope, port });
  } catch (reason) {
    session.dispatch(
      markAction(session.authority.key, port, {
        kind: "failed",
        reason: remotePortErrorMessage(reason),
      }),
    );
    return;
  }
  session.dispatch(markAction(session.authority.key, port, null));
  await session.refresh();
}

const windowFocused = (): boolean => typeof document !== "undefined" && document.hasFocus();

export function useRemotePortPreview(input: RemotePortPreviewInput): RemotePortPreviewSurface {
  const authority = remotePortPreviewAuthority(input.enabled, input.owner, input.target);
  const key = authority?.key ?? null;
  const { turnActive, terminalOpen } = input.activity;
  const [state, dispatch] = useReducer(remotePortPreviewReducer, initialRemotePortPreviewState);
  const latest = useRef({ authority, port: input.port, turnActive, terminalOpen });
  const focused = useRef(false);
  const sequence = useRef(0);
  const session = useRef<RemotePortSession | null>(null);

  useLayoutEffect(() => {
    latest.current = { authority, port: input.port, turnActive, terminalOpen };
  });

  useEffect(() => {
    focused.current = windowFocused();
    const onFocus = () => {
      focused.current = true;
      void session.current?.refresh();
    };
    const onBlur = () => {
      focused.current = false;
      session.current?.reschedule();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    dispatch({ type: "reset", key });
    const current = latest.current;
    if (key === null || current.authority?.key !== key) return;
    const active = createRemotePortSession({
      authority: current.authority,
      port: current.port,
      sequence,
      dispatch,
      delay: () =>
        remotePortPollDelay({
          turnActive: latest.current.turnActive,
          terminalOpen: latest.current.terminalOpen,
          focused: focused.current,
        }),
    });
    session.current = active;
    void active.refresh();
    return () => {
      active.dispose();
      if (session.current === active) session.current = null;
    };
  }, [key]);

  useEffect(() => {
    session.current?.reschedule();
  }, [turnActive, terminalOpen]);

  const refresh = useCallback(() => {
    void session.current?.refresh();
  }, []);
  const open = useCallback(async (port: number, options?: RemotePortOpenOptions) => {
    const active = session.current;
    if (active === null) return STALE;
    return openThroughSession(active, port, options);
  }, []);
  const close = useCallback(async (port: number) => {
    const active = session.current;
    if (active === null) return;
    await closeThroughSession(active, port);
  }, []);

  const view = useMemo(() => remotePortPreviewView(state, key), [state, key]);
  return useMemo(() => ({ ...view, refresh, open, close }), [view, refresh, open, close]);
}
