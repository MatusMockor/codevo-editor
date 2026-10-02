import { describe, expect, it } from "vitest";
import {
  SERVER_LINK_REFUSED_MESSAGE,
  mayPointToServerLoopback,
  serverLoopbackDecision,
  serverLoopbackLinkTitle,
  serverLoopbackTitle,
  serverLoopbackUnreachableMessage,
  serverLoopbackUnsupportedMessage,
  serverPortNotRunningMessage,
  verifiedServerLoopbackDecision,
  type ServerLoopbackPorts,
} from "./remoteLoopbackLink";

const LISTED: ServerLoopbackPorts = { kind: "listed", ports: new Set([3000, 5173]) };

describe("server loopback links", () => {
  it.each([
    ["http://localhost:3000/", true],
    ["http://LOCALHOST:3000/", true],
    ["http://app.localhost:3000/", true],
    ["http://127.0.0.1:3000/", true],
    ["http://127.1:3000/", true],
    ["http://[::1]:3000/", true],
    ["http://0.0.0.0:3000/", true],
    ["http://localhost/", true],
    ["https://user:pw@localhost:3000/", true],
    ["https://example.com:3000/", false],
    ["http://192.168.1.10:3000/", false],
    ["http://localhost.example.com:3000/", false],
    ["not a url", true],
    [`http://localhost:3000/${"a".repeat(5000)}`, true],
  ])("recognises %s as loopback: %s", (url, expected) => {
    expect(mayPointToServerLoopback(url)).toBe(expected);
  });

  it("titles forwardable links with the server and port only while forwarding works", () => {
    const forwarding = serverLoopbackTitle(LISTED, "build-box");
    expect(serverLoopbackTitle({ kind: "unlisted" }, "build-box")).toEqual(forwarding);
    expect(serverLoopbackLinkTitle("http://localhost:3000/x", forwarding)).toBe(
      "Opens build-box:3000 through the SSH connection",
    );
    expect(serverLoopbackLinkTitle("http://localhost/", forwarding)).toBeNull();
  });

  it("titles links with the reason when forwarding is not available", () => {
    const unsupported = serverLoopbackTitle({ kind: "unsupported" }, "build-box");
    expect(serverLoopbackLinkTitle("http://localhost:3000/", unsupported)).toBe(
      serverLoopbackUnsupportedMessage("build-box"),
    );
    const unavailable = serverLoopbackTitle(
      { kind: "unavailable", reason: "Reconnect to build-box to open its ports." },
      "build-box",
    );
    expect(serverLoopbackLinkTitle("http://localhost:3000/", unavailable)).toBe(
      "Reconnect to build-box to open its ports.",
    );
    expect(serverLoopbackLinkTitle("https://example.com:3000/", unavailable)).toBeNull();
  });

  it.each([
    ["http://localhost:3000/", "http", 3000, "/"],
    ["http://127.0.0.1:5173/app?x=1#y", "http", 5173, "/app?x=1#y"],
    ["https://localhost:3000/login", "https", 3000, "/login"],
    ["http://[::1]:3000/", "http", 3000, "/"],
    ["http://0.0.0.0:5173/", "http", 5173, "/"],
  ])("opens detected %s through the forward", (url, scheme, port, path) => {
    expect(serverLoopbackDecision(url, LISTED, "build-box")).toEqual({
      kind: "open",
      target: { url, scheme, port, path },
    });
  });

  it.each([
    ["http://localhost/"],
    ["http://localhost:80/"],
    ["http://127.0.0.1:443/"],
    ["https://user@localhost:3000/"],
  ])("refuses %s that cannot be forwarded", (url) => {
    expect(serverLoopbackDecision(url, LISTED, "build-box")).toEqual({
      kind: "notice",
      message: serverLoopbackUnreachableMessage("build-box"),
    });
  });

  it("asks for a fresh listing before reporting an undetected port", () => {
    const target = {
      url: "http://localhost:8080/",
      scheme: "http" as const,
      port: 8080,
      path: "/",
    };
    expect(serverLoopbackDecision("http://localhost:8080/", LISTED, "build-box")).toEqual({
      kind: "verify",
      target,
    });
    expect(verifiedServerLoopbackDecision(target, new Set([8080]))).toEqual({
      kind: "open",
      target,
    });
    expect(verifiedServerLoopbackDecision(target, new Set([3000]))).toEqual({
      kind: "notice",
      message: serverPortNotRunningMessage(8080),
    });
    expect(serverPortNotRunningMessage(8080)).toBe(
      "Port 8080 is not running on the server. Open the server Terminal to keep a dev server running after the turn.",
    );
  });

  it("refuses links it cannot parse", () => {
    expect(serverLoopbackDecision("http://[bad", LISTED, "build-box")).toEqual({
      kind: "notice",
      message: SERVER_LINK_REFUSED_MESSAGE,
    });
  });

  it("lets the authoritative backend decide while the listing is not ready", () => {
    expect(serverLoopbackDecision("http://localhost:8080/", { kind: "unlisted" }, "box")).toEqual({
      kind: "open",
      target: { url: "http://localhost:8080/", scheme: "http", port: 8080, path: "/" },
    });
  });

  it("explains a runner without port preview and an unavailable connection", () => {
    expect(
      serverLoopbackDecision("http://localhost:3000/", { kind: "unsupported" }, "box"),
    ).toEqual({ kind: "notice", message: serverLoopbackUnsupportedMessage("box") });
    expect(
      serverLoopbackDecision(
        "http://localhost:3000/",
        { kind: "unavailable", reason: "Reconnect to box to open its ports." },
        "box",
      ),
    ).toEqual({ kind: "notice", message: "Reconnect to box to open its ports." });
  });
});
