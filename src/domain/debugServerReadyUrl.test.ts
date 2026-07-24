import { describe, expect, it } from "vitest";
import {
  DEBUG_SERVER_READY_URL_MAX_BYTES,
  validateDebugServerReadyLoopbackUrl,
} from "./debugServerReadyUrl";

describe("validateDebugServerReadyLoopbackUrl", () => {
  it.each([
    ["localhost HTTP", "http://localhost:3000", "http://localhost:3000/"],
    ["localhost HTTPS", "https://localhost:8443/api", "https://localhost:8443/api"],
    ["IPv4 loopback", "http://127.0.0.1:5173", "http://127.0.0.1:5173/"],
    [
      "IPv4 loopback range",
      "http://127.255.255.255:65535/ready",
      "http://127.255.255.255:65535/ready",
    ],
    ["IPv6 loopback", "https://[::1]:4443", "https://[::1]:4443/"],
    [
      "path, query, and fragment",
      "http://localhost:8080/swagger/index.html?theme=dark#api",
      "http://localhost:8080/swagger/index.html?theme=dark#api",
    ],
  ])("accepts %s", (_case, value, serialized) => {
    expect(validateDebugServerReadyLoopbackUrl(value)).toEqual({
      kind: "valid",
      url: serialized,
    });
  });

  it.each([
    ["non-string", 3000],
    ["empty", ""],
    ["leading whitespace", " http://localhost:3000"],
    ["trailing whitespace", "http://localhost:3000 "],
    ["control character", "http://localhost:3000/a\nb"],
    ["unsupported scheme", "ftp://localhost:3000"],
    ["scheme case ambiguity", "HTTP://localhost:3000"],
    ["missing port", "http://localhost/path"],
    ["default HTTP port", "http://localhost:80"],
    ["default HTTPS port", "https://localhost:443"],
    ["port zero", "http://localhost:0"],
    ["negative port", "http://localhost:-1"],
    ["oversized port", "http://localhost:65536"],
    ["leading-zero port", "http://localhost:03000"],
    ["username", "http://user@localhost:3000"],
    ["password", "http://user:secret@localhost:3000"],
    ["localhost trailing dot", "http://localhost.:3000"],
    ["localhost case ambiguity", "http://LOCALHOST:3000"],
    ["public hostname", "https://example.com:4433"],
    ["loopback suffix", "http://localhost.example.com:3000"],
    ["unspecified IPv4", "http://0.0.0.0:3000"],
    ["private IPv4", "http://192.168.1.5:3000"],
    ["short IPv4", "http://127.1:3000"],
    ["integer IPv4", "http://2130706433:3000"],
    ["hex IPv4", "http://0x7f000001:3000"],
    ["leading-zero IPv4", "http://127.000.000.001:3000"],
    ["unspecified IPv6", "http://[::]:3000"],
    ["mapped IPv6", "http://[::ffff:127.0.0.1]:3000"],
    ["IPv6 zone", "http://[::1%25lo0]:3000"],
    ["fragment before authority end", "http://localhost#fragment:3000"],
  ])("rejects %s", (_case, value) => {
    expect(validateDebugServerReadyLoopbackUrl(value)).toEqual({ kind: "invalid" });
  });

  it("enforces the UTF-8 byte limit on input and serialized output", () => {
    const oversized = `http://localhost:3000/${"ž".repeat(
      DEBUG_SERVER_READY_URL_MAX_BYTES,
    )}`;

    expect(validateDebugServerReadyLoopbackUrl(oversized)).toEqual({ kind: "invalid" });
  });
});
