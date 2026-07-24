import { describe, expect, it, vi } from "vitest";
import {
  validateDebugServerReadyLoopbackUrl,
  type DebugServerReadyLoopbackUrl,
} from "../domain/debugServerReadyUrl";
import {
  DEBUG_SERVER_READY_OPEN_FAILED,
  TauriServerReadyExternalUrlOpener,
} from "./tauriServerReadyExternalUrlOpener";

describe("TauriServerReadyExternalUrlOpener", () => {
  it("opens the exact validated and serialized loopback URL", async () => {
    const openUrl = vi.fn(async () => undefined);
    const opener = new TauriServerReadyExternalUrlOpener(openUrl);
    const validated = validateDebugServerReadyLoopbackUrl(
      "http://localhost:3000/api?ready=true#status",
    );
    if (validated.kind !== "valid") throw new Error("test URL must be valid");

    await expect(opener.openExternal(validated.url)).resolves.toBeUndefined();

    expect(openUrl).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3000/api?ready=true#status",
    );
  });

  it("revalidates a forged brand before reaching the host opener", async () => {
    const openUrl = vi.fn(async () => undefined);
    const opener = new TauriServerReadyExternalUrlOpener(openUrl);

    await expect(
      opener.openExternal("https://example.com:4443" as DebugServerReadyLoopbackUrl),
    ).rejects.toThrow(DEBUG_SERVER_READY_OPEN_FAILED);

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("maps host opener failures to a generic error without leaking details", async () => {
    const openUrl = vi.fn(async () => {
      throw new Error("secret OS handler detail");
    });
    const opener = new TauriServerReadyExternalUrlOpener(openUrl);
    const validated = validateDebugServerReadyLoopbackUrl("https://[::1]:8443");
    if (validated.kind !== "valid") throw new Error("test URL must be valid");

    await expect(opener.openExternal(validated.url)).rejects.toThrow(
      DEBUG_SERVER_READY_OPEN_FAILED,
    );
    await expect(opener.openExternal(validated.url)).rejects.not.toThrow(
      "secret OS handler detail",
    );
  });
});
