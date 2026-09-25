import { describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_CHECK_COMMAND,
  createChannelUpdateCheck,
  parseAppUpdateCheckOutcome,
} from "./tauriAppUpdateChannelCheck";

const metadata = {
  rid: 3,
  currentVersion: "0.2.0-beta.72",
  version: "0.2.0-beta.73",
  date: null,
  body: "Notes",
  rawJson: { version: "0.2.0-beta.73" },
};

const available = { kind: "available", ...metadata };

describe("createChannelUpdateCheck", () => {
  it("sends only the closed channel and builds an update from the metadata", async () => {
    const invokeCommand = vi.fn(async () => available);
    const construct = vi.fn((value: unknown) => ({ constructed: value }));
    const check = createChannelUpdateCheck(invokeCommand, construct);

    const result = await check("stable");

    expect(invokeCommand).toHaveBeenCalledWith(APP_UPDATE_CHECK_COMMAND, {
      request: { channel: "stable" },
    });
    expect(construct).toHaveBeenCalledWith({
      rid: 3,
      currentVersion: "0.2.0-beta.72",
      version: "0.2.0-beta.73",
      body: "Notes",
      rawJson: { version: "0.2.0-beta.73" },
    });
    expect(result).toEqual({ constructed: expect.objectContaining({ rid: 3 }) });
  });

  it("returns null when the channel has no newer release", async () => {
    const construct = vi.fn();
    const check = createChannelUpdateCheck(async () => ({ kind: "upToDate" }), construct);
    await expect(check("beta")).resolves.toBeNull();
    expect(construct).not.toHaveBeenCalled();
  });

  it("reports a channel without any release as a distinct no-release outcome", async () => {
    const construct = vi.fn();
    const check = createChannelUpdateCheck(
      async () => ({ kind: "noRelease", channel: "stable" }),
      construct,
    );
    await expect(check("stable")).resolves.toEqual({ kind: "noRelease", channel: "stable" });
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects a malformed outcome before constructing an update", async () => {
    const construct = vi.fn();
    const check = createChannelUpdateCheck(async () => null, construct);
    await expect(check("beta")).rejects.toThrow(TypeError);
    expect(construct).not.toHaveBeenCalled();
  });
});

describe("parseAppUpdateCheckOutcome", () => {
  it.each([
    ["null", null],
    ["an array", []],
    ["an unknown kind", { kind: "failed" }],
    ["a missing kind", { ...metadata }],
    ["an up-to-date outcome with extra fields", { kind: "upToDate", version: "1.0.0" }],
    ["a no-release outcome without a channel", { kind: "noRelease" }],
    ["a no-release outcome with an unknown channel", { kind: "noRelease", channel: "nightly" }],
    [
      "a no-release outcome with extra fields",
      { kind: "noRelease", channel: "stable", endpoint: "https://example.com" },
    ],
    ["an unknown field", { ...available, endpoint: "https://example.com" }],
    ["a negative rid", { ...available, rid: -1 }],
    ["a fractional rid", { ...available, rid: 1.5 }],
    ["a missing version", { ...available, version: undefined }],
    ["a numeric date", { ...available, date: 5 }],
    ["a numeric body", { ...available, body: 5 }],
    ["an array manifest", { ...available, rawJson: [] }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseAppUpdateCheckOutcome(value)).toThrow(TypeError);
  });

  it("parses each closed outcome", () => {
    expect(parseAppUpdateCheckOutcome({ kind: "upToDate" })).toEqual({ kind: "upToDate" });
    expect(parseAppUpdateCheckOutcome({ kind: "noRelease", channel: "beta" })).toEqual({
      kind: "noRelease",
      channel: "beta",
    });
    expect(parseAppUpdateCheckOutcome({ ...available, date: "2026-09-01T00:00:00Z" })).toEqual({
      kind: "available",
      metadata: {
        rid: 3,
        currentVersion: "0.2.0-beta.72",
        version: "0.2.0-beta.73",
        date: "2026-09-01T00:00:00Z",
        body: "Notes",
        rawJson: { version: "0.2.0-beta.73" },
      },
    });
  });
});
