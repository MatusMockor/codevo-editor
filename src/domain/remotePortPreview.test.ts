import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-port-preview-wire.json";
import {
  REMOTE_PORT_POLL_MS,
  classifyLoopbackUrl,
  parseRemotePortListing,
  remotePortErrorMessage,
  remotePortForwardView,
  remotePortPollDelay,
  remotePortPreviewKey,
  type RemotePortLocalMarker,
} from "./remotePortPreview";
import type { RemotePortForward, RemotePortListRequest } from "./remotePortPreviewWire";

type WireCase = Readonly<{ name: string; value: unknown }>;
type ListingSection = Readonly<{ accepted: readonly WireCase[]; rejected: readonly WireCase[] }>;
const listingSection = (
  wireContract as unknown as { sections: Readonly<{ portListing: ListingSection }> }
).sections.portListing;

describe("parseRemotePortListing", () => {
  it.each(listingSection.accepted.map((fixture) => [fixture.name, fixture.value] as const))(
    "accepts %s",
    (_name, value) => {
      expect(parseRemotePortListing(value)).toBe(value);
    },
  );

  it.each(listingSection.rejected.map((fixture) => [fixture.name, fixture.value] as const))(
    "rejects %s",
    (_name, value) => {
      expect(() => parseRemotePortListing(value)).toThrow("Invalid server port listing.");
    },
  );

  it("rejects garbage", () => {
    for (const value of [null, undefined, "ports", 3000, [], { ports: [] }])
      expect(() => parseRemotePortListing(value)).toThrow("Invalid server port listing.");
  });
});

describe("remotePortForwardView", () => {
  const open: RemotePortForward = { localPort: 43000, state: "open" };
  const opening: RemotePortForward = { localPort: 43000, state: "opening" };
  const localOpening: RemotePortLocalMarker = { kind: "opening" };
  const localFailed: RemotePortLocalMarker = { kind: "failed", reason: "ssh refused" };

  it.each([
    ["no forward, no marker", null, null, { kind: "none" }],
    ["wire opening", opening, null, { kind: "opening" }],
    ["wire open", open, null, { kind: "open", localPort: 43000 }],
    ["local opening over none", null, localOpening, { kind: "opening" }],
    ["local opening over wire open", open, localOpening, { kind: "opening" }],
    ["local failed over none", null, localFailed, { kind: "failed", reason: "ssh refused" }],
    ["local failed over wire open", open, localFailed, { kind: "failed", reason: "ssh refused" }],
  ] as const)("%s", (_name, forward, marker, expected) => {
    expect(remotePortForwardView(forward, marker)).toEqual(expected);
  });
});

describe("classifyLoopbackUrl", () => {
  it.each([
    [
      "http://localhost:3000",
      { url: "http://localhost:3000", scheme: "http", port: 3000, path: "/" },
    ],
    [
      "http://LOCALHOST:3000/app",
      { url: "http://LOCALHOST:3000/app", scheme: "http", port: 3000, path: "/app" },
    ],
    [
      "http://127.0.0.1:5173/",
      { url: "http://127.0.0.1:5173/", scheme: "http", port: 5173, path: "/" },
    ],
    ["http://[::1]:8080/x", { url: "http://[::1]:8080/x", scheme: "http", port: 8080, path: "/x" }],
    ["http://0.0.0.0:4000", { url: "http://0.0.0.0:4000", scheme: "http", port: 4000, path: "/" }],
    [
      "https://localhost:8443",
      { url: "https://localhost:8443", scheme: "https", port: 8443, path: "/" },
    ],
    [
      "http://localhost:65535/a?b=1#c",
      { url: "http://localhost:65535/a?b=1#c", scheme: "http", port: 65535, path: "/a?b=1#c" },
    ],
    [
      "http://localhost:1024",
      { url: "http://localhost:1024", scheme: "http", port: 1024, path: "/" },
    ],
    [
      "http://127.0.0.2:3000/",
      { url: "http://127.0.0.2:3000/", scheme: "http", port: 3000, path: "/" },
    ],
    ["http://127.1:3000", { url: "http://127.1:3000", scheme: "http", port: 3000, path: "/" }],
    [
      "http://localhost.:3000/",
      { url: "http://localhost.:3000/", scheme: "http", port: 3000, path: "/" },
    ],
    [
      "http://app.localhost:3000/",
      { url: "http://app.localhost:3000/", scheme: "http", port: 3000, path: "/" },
    ],
    ["http://[::]:3000/", { url: "http://[::]:3000/", scheme: "http", port: 3000, path: "/" }],
    [
      "http://[::ffff:127.0.0.1]:3000/",
      { url: "http://[::ffff:127.0.0.1]:3000/", scheme: "http", port: 3000, path: "/" },
    ],
  ] as const)("accepts %s", (url, expected) => {
    expect(classifyLoopbackUrl(url)).toEqual(expected);
  });

  it.each([
    ["no port", "http://localhost/"],
    ["default http port", "http://localhost:80/"],
    ["default https port", "https://localhost:443/"],
    ["privileged port", "http://localhost:1023/"],
    ["port above range", "http://localhost:65536/"],
    ["userinfo", "http://user:secret@localhost:3000/"],
    ["username only", "http://user@localhost:3000/"],
    ["backslash", "http://localhost:3000\\admin"],
    ["control character", "http://localhost:3000/\u0007"],
    ["whitespace", "http://localhost:3000/a b"],
    ["non-http scheme", "ftp://localhost:3000/"],
    ["javascript scheme", "javascript:alert(1)"],
    ["websocket scheme", "ws://localhost:3000/"],
    ["garbage", "not a url"],
    ["empty", ""],
    ["lookalike host", "http://localhost.evil.com:3000/"],
    ["localhost suffix without label boundary", "http://evillocalhost:3000/"],
    ["non-loopback mapped address", "http://[::ffff:10.0.0.1]:3000/"],
    ["public ipv6", "http://[2001:db8::1]:3000/"],
    ["remote host", "http://example.com:3000/"],
    ["relative", "/localhost:3000"],
    ["too long", `http://localhost:3000/${"a".repeat(5000)}`],
  ])("rejects %s", (_name, url) => {
    expect(classifyLoopbackUrl(url)).toBeNull();
  });

  it("never throws on non-string input", () => {
    for (const value of [null, undefined, 3000, {}, []])
      expect(classifyLoopbackUrl(value as unknown as string)).toBeNull();
  });
});

describe("remotePortPollDelay", () => {
  it("pins the cadence", () => {
    expect(REMOTE_PORT_POLL_MS).toEqual({ active: 5000, idle: 30000 });
  });

  it.each([
    [true, false, true, 5000],
    [false, true, true, 5000],
    [true, true, true, 5000],
    [false, false, true, 30000],
    [true, false, false, 30000],
    [false, true, false, 30000],
    [false, false, false, 30000],
  ])("turn %s terminal %s focused %s -> %i ms", (turnActive, terminalOpen, focused, delay) => {
    expect(remotePortPollDelay({ turnActive, terminalOpen, focused })).toBe(delay);
  });
});

describe("remotePortPreviewKey", () => {
  const base: RemotePortListRequest = {
    serverId: "linux",
    runnerId: "runner-1",
    ownerId: "workspace-a",
    ownerGeneration: 1,
    scope: { kind: "task", taskId: "7389088c-29b8-4cec-9a15-e825e1fb2f66" },
  };

  it("is exact for every authority field", () => {
    const key = remotePortPreviewKey(base);
    expect(remotePortPreviewKey({ ...base })).toBe(key);
    const variants: RemotePortListRequest[] = [
      { ...base, serverId: "other" },
      { ...base, runnerId: "runner-2" },
      { ...base, ownerId: "workspace-b" },
      { ...base, ownerGeneration: 2 },
      { ...base, scope: { kind: "project", projectId: "7389088c-29b8-4cec-9a15-e825e1fb2f66" } },
    ];
    for (const variant of variants) expect(remotePortPreviewKey(variant)).not.toBe(key);
  });

  it("cannot be forged by separator characters in ids", () => {
    const left = remotePortPreviewKey({ ...base, serverId: "a", runnerId: "b,c" });
    const right = remotePortPreviewKey({ ...base, serverId: "a,b", runnerId: "c" });
    expect(left).not.toBe(right);
  });
});

describe("remotePortErrorMessage", () => {
  it("passes bounded messages and hides everything else", () => {
    const generic = "The server could not complete this port operation.";
    expect(remotePortErrorMessage("Server disconnected.")).toBe("Server disconnected.");
    expect(remotePortErrorMessage(new Error("Port is not listed."))).toBe("Port is not listed.");
    expect(remotePortErrorMessage({ message: "secret" })).toBe(generic);
    expect(remotePortErrorMessage("")).toBe(generic);
    expect(remotePortErrorMessage("x".repeat(1001))).toBe(generic);
    expect(remotePortErrorMessage("x".repeat(1000))).toBe("x".repeat(1000));
  });
});
