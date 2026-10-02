import { describe, expect, it, vi } from "vitest";
import type {
  RemotePortCloseRequest,
  RemotePortListing,
  RemotePortListRequest,
  RemotePortOpenRequest,
} from "../domain/remotePortPreviewWire";
import { TauriRemotePortPreviewGateway } from "./tauriRemotePortPreviewGateway";

const listRequest: RemotePortListRequest = {
  serverId: "linux",
  runnerId: "7389088c-29b8-4cec-9a15-e825e1fb2f66",
  ownerId: "workspace-a",
  ownerGeneration: 3,
  scope: { kind: "task", taskId: "0f8fad5b-d9cb-469f-a165-70867728950e" },
};
const openRequest: RemotePortOpenRequest = {
  ...listRequest,
  port: 3000,
  scheme: "http",
  path: "/",
};
const closeRequest: RemotePortCloseRequest = {
  serverId: listRequest.serverId,
  ownerId: listRequest.ownerId,
  ownerGeneration: listRequest.ownerGeneration,
  scope: listRequest.scope,
  port: 3000,
};
const releaseRequest = { ownerId: "workspace-a", ownerGeneration: 3 };
const listing: RemotePortListing = {
  ports: [
    {
      port: 3000,
      address: "loopback-v4",
      source: "agent",
      process: "node",
      forward: { localPort: 3000, state: "open" },
    },
  ],
  truncated: false,
  scannedAt: "2026-10-02T09:15:00.000Z",
};
const unsafe = <T>(value: unknown) => value as T;

describe("remote port preview gateway commands", () => {
  it("lists through the exact command with a single request argument", async () => {
    const invoke = vi.fn().mockResolvedValue(listing);
    expect(await new TauriRemotePortPreviewGateway(invoke).list(listRequest)).toEqual(listing);
    expect(invoke).toHaveBeenCalledWith("remote_port_list", { request: listRequest });
  });

  it("opens and returns only the validated local port", async () => {
    const invoke = vi.fn().mockResolvedValue({ localPort: 43000 });
    expect(await new TauriRemotePortPreviewGateway(invoke).open(openRequest)).toEqual({
      localPort: 43000,
    });
    expect(invoke).toHaveBeenCalledWith("remote_port_open", { request: openRequest });
  });

  it("closes and releases with empty responses", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    await expect(gateway.close(closeRequest)).resolves.toBeUndefined();
    invoke.mockResolvedValue(undefined);
    await expect(gateway.releaseOwner(releaseRequest)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      ["remote_port_close", { request: closeRequest }],
      ["remote_port_release_owner", { request: releaseRequest }],
    ]);
  });
});

describe("remote port preview gateway request validation", () => {
  it.each([
    ["list with host", "list", { ...listRequest, host: "evil" }],
    ["list with pid", "list", { ...listRequest, pid: 42 }],
    ["list without generation", "list", { ...listRequest, ownerGeneration: undefined }],
    ["list with generation 0", "list", { ...listRequest, ownerGeneration: 0 }],
    ["open with privileged port", "open", { ...openRequest, port: 80 }],
    ["open with javascript scheme", "open", { ...openRequest, scheme: "javascript" }],
    ["open with backslash path", "open", { ...openRequest, path: "/\\evil" }],
    ["open with absolute url path", "open", { ...openRequest, path: "http://evil/" }],
    ["open with target host", "open", { ...openRequest, targetHost: "10.0.0.1" }],
    ["close with runnerId", "close", { ...closeRequest, runnerId: listRequest.runnerId }],
    ["close with pid", "close", { ...closeRequest, pid: 42 }],
    ["release with serverId", "releaseOwner", { ...releaseRequest, serverId: "linux" }],
    ["release with blank owner", "releaseOwner", { ...releaseRequest, ownerId: " " }],
  ] as const)("rejects %s before IPC", async (_name, method, request) => {
    const invoke = vi.fn();
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    await expect(gateway[method](unsafe(request))).rejects.toThrow("Invalid server port request.");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("remote port preview gateway response validation", () => {
  it("rejects a listing with excess fields or a foreign shape", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...listing, host: "secret" });
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    await expect(gateway.list(listRequest)).rejects.toThrow("Invalid server port listing.");
    invoke.mockResolvedValue({
      ...listing,
      ports: [{ ...listing.ports[0], forward: { localPort: 3000, state: "open", pid: 1 } }],
    });
    await expect(gateway.list(listRequest)).rejects.toThrow("Invalid server port listing.");
  });

  it("rejects open responses that are not a bounded local port", async () => {
    const invoke = vi.fn();
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    for (const response of [
      null,
      { localPort: 80 },
      { localPort: 43000, url: "http://127.0.0.1:43000" },
      {},
    ]) {
      invoke.mockResolvedValueOnce(response);
      await expect(gateway.open(openRequest)).rejects.toThrow("Invalid server port response.");
    }
  });

  it("rejects non-empty close and release responses", async () => {
    const invoke = vi.fn().mockResolvedValue({ closed: true });
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    await expect(gateway.close(closeRequest)).rejects.toThrow("Invalid server port response.");
    await expect(gateway.releaseOwner(releaseRequest)).rejects.toThrow(
      "Invalid server port response.",
    );
  });
});

describe("remote port preview gateway errors", () => {
  it("normalizes native errors and bounds unknown failures", async () => {
    const generic = "The server could not complete this port operation.";
    const invoke = vi.fn();
    const gateway = new TauriRemotePortPreviewGateway(invoke);
    invoke.mockRejectedValueOnce("Port 3000 is not listening on the server.");
    await expect(gateway.open(openRequest)).rejects.toThrow(
      "Port 3000 is not listening on the server.",
    );
    invoke.mockRejectedValueOnce(new Error("Server disconnected."));
    await expect(gateway.list(listRequest)).rejects.toThrow("Server disconnected.");
    invoke.mockRejectedValueOnce({ secret: "not a message" });
    await expect(gateway.close(closeRequest)).rejects.toThrow(generic);
    invoke.mockRejectedValueOnce("x".repeat(1001));
    await expect(gateway.releaseOwner(releaseRequest)).rejects.toThrow(generic);
    invoke.mockRejectedValueOnce("");
    await expect(gateway.list(listRequest)).rejects.toThrow(generic);
  });
});
