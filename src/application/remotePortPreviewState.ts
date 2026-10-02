import {
  remotePortForwardView,
  remotePortPreviewKey,
  type RemotePortForwardView,
  type RemotePortLocalMarker,
} from "../domain/remotePortPreview";
import type {
  RemoteListeningPort,
  RemotePortListing,
  RemotePortListRequest,
  RemotePortOwner,
  RemotePortScope,
} from "../domain/remotePortPreviewWire";

export type RemotePortPreviewStatus = "idle" | "loading" | "ready" | "error";
export type RemotePortPreviewTarget = Readonly<{
  serverId: string;
  runnerId: string;
  scope: RemotePortScope;
}>;
export type RemotePortPreviewAuthority = Readonly<{ key: string; request: RemotePortListRequest }>;
export type RemotePortPreviewEntry = RemoteListeningPort &
  Readonly<{ forward: RemotePortForwardView }>;
export type RemotePortPreviewView = Readonly<{
  status: RemotePortPreviewStatus;
  ports: readonly RemotePortPreviewEntry[];
  truncated: boolean;
  error: string | null;
}>;

export type RemotePortPreviewState = Readonly<{
  key: string | null;
  status: RemotePortPreviewStatus;
  listing: RemotePortListing | null;
  error: string | null;
  markers: ReadonlyMap<number, RemotePortLocalMarker>;
}>;

export type RemotePortPreviewAction =
  | Readonly<{ type: "reset"; key: string | null }>
  | Readonly<{ type: "listed"; key: string; listing: RemotePortListing }>
  | Readonly<{ type: "listFailed"; key: string; error: string }>
  | Readonly<{ type: "mark"; key: string; port: number; marker: RemotePortLocalMarker | null }>;

const NO_MARKERS: ReadonlyMap<number, RemotePortLocalMarker> = new Map();

export const initialRemotePortPreviewState: RemotePortPreviewState = Object.freeze({
  key: null,
  status: "idle",
  listing: null,
  error: null,
  markers: NO_MARKERS,
});

export const remotePortPreviewAuthority = (
  enabled: boolean,
  owner: RemotePortOwner | null,
  target: RemotePortPreviewTarget | null,
): RemotePortPreviewAuthority | null => {
  if (!enabled || owner === null || target === null) return null;
  const request: RemotePortListRequest = {
    serverId: target.serverId,
    runnerId: target.runnerId,
    ownerId: owner.ownerId,
    ownerGeneration: owner.ownerGeneration,
    scope: target.scope,
  };
  return { key: remotePortPreviewKey(request), request };
};

const retainListedMarkers = (
  markers: ReadonlyMap<number, RemotePortLocalMarker>,
  listing: RemotePortListing,
): ReadonlyMap<number, RemotePortLocalMarker> => {
  const listed = new Set(listing.ports.map((entry) => entry.port));
  return new Map(
    [...markers].filter(([port, marker]) => marker.kind === "opening" || listed.has(port)),
  );
};

const withMarker = (
  markers: ReadonlyMap<number, RemotePortLocalMarker>,
  port: number,
  marker: RemotePortLocalMarker | null,
): ReadonlyMap<number, RemotePortLocalMarker> => {
  const next = new Map(markers);
  next.delete(port);
  if (marker === null) return next;
  return next.set(port, marker);
};

export const remotePortPreviewReducer = (
  state: RemotePortPreviewState,
  action: RemotePortPreviewAction,
): RemotePortPreviewState => {
  if (action.type === "reset") {
    return {
      ...initialRemotePortPreviewState,
      key: action.key,
      status: action.key === null ? "idle" : "loading",
    };
  }
  if (action.key !== state.key) return state;
  switch (action.type) {
    case "listed":
      return {
        ...state,
        status: "ready",
        listing: action.listing,
        error: null,
        markers: retainListedMarkers(state.markers, action.listing),
      };
    case "listFailed":
      return { ...state, status: "error", error: action.error };
    case "mark":
      return { ...state, markers: withMarker(state.markers, action.port, action.marker) };
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
};

const EMPTY_PORTS: readonly RemotePortPreviewEntry[] = Object.freeze([]);

export const remotePortPreviewView = (
  state: RemotePortPreviewState,
  key: string | null,
): RemotePortPreviewView => {
  if (key === null) return { status: "idle", ports: EMPTY_PORTS, truncated: false, error: null };
  if (state.key !== key) {
    return { status: "loading", ports: EMPTY_PORTS, truncated: false, error: null };
  }
  const ports =
    state.listing?.ports.map(({ forward, ...entry }) => ({
      ...entry,
      forward: remotePortForwardView(forward, state.markers.get(entry.port) ?? null),
    })) ?? EMPTY_PORTS;
  return {
    status: state.status,
    ports,
    truncated: state.listing?.truncated ?? false,
    error: state.error,
  };
};
