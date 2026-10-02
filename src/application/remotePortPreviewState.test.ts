import { describe, expect, it } from "vitest";
import type { RemotePortForward, RemotePortListing } from "../domain/remotePortPreviewWire";
import { initialRemotePortPreviewState, remotePortPreviewReducer } from "./remotePortPreviewState";

const KEY = "owner-a";

function listing(scannedAt: string, forward: RemotePortForward | null = null): RemotePortListing {
  return {
    ports: [{ port: 3000, address: "loopback-v4", source: "agent", process: "node", forward }],
    truncated: false,
    scannedAt,
  };
}

const ready = remotePortPreviewReducer(
  remotePortPreviewReducer(initialRemotePortPreviewState, { type: "reset", key: KEY }),
  { type: "listed", key: KEY, listing: listing("2026-10-02T09:15:00.000Z") },
);

describe("remote port preview state identity", () => {
  it("keeps the same state when a poll returns the same ports", () => {
    const next = remotePortPreviewReducer(ready, {
      type: "listed",
      key: KEY,
      listing: listing("2026-10-02T09:15:05.000Z"),
    });
    expect(next).toBe(ready);
  });

  it("publishes a new state when a forward or port changes", () => {
    const forwarded = remotePortPreviewReducer(ready, {
      type: "listed",
      key: KEY,
      listing: listing("2026-10-02T09:15:05.000Z", { localPort: 3000, state: "open" }),
    });
    expect(forwarded).not.toBe(ready);
    expect(forwarded.listing?.ports[0]?.forward).toEqual({ localPort: 3000, state: "open" });
  });

  it("keeps the same state for a repeated identical listing failure", () => {
    const failed = remotePortPreviewReducer(ready, {
      type: "listFailed",
      key: KEY,
      error: "Runner connection was superseded",
    });
    const again = remotePortPreviewReducer(failed, {
      type: "listFailed",
      key: KEY,
      error: "Runner connection was superseded",
    });
    expect(again).toBe(failed);
    const recovered = remotePortPreviewReducer(failed, {
      type: "listed",
      key: KEY,
      listing: listing("2026-10-02T09:15:10.000Z"),
    });
    expect(recovered.status).toBe("ready");
    expect(recovered.error).toBeNull();
  });
});
