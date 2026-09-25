import { describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_CHECK_COMMAND,
  createAppUpdateCheck,
  parseAppUpdateCheckOutcome,
} from "./tauriAppUpdateCheck";

const metadata = {
  rid: 3,
  currentVersion: "0.2.0-beta.72",
  version: "0.2.0-beta.73",
  date: null,
  body: "Notes",
  rawJson: { version: "0.2.0-beta.73" },
};

const available = { kind: "available", ...metadata };

describe("createAppUpdateCheck", () => {
  it("invokes the check command without arguments and builds an update from the metadata", async () => {
    const invokeCommand = vi.fn(async () => available);
    const construct = vi.fn((value: unknown) => ({ constructed: value }));
    const check = createAppUpdateCheck(invokeCommand, construct);

    const result = await check();

    expect(invokeCommand).toHaveBeenCalledWith(APP_UPDATE_CHECK_COMMAND);
    expect(invokeCommand.mock.calls[0]).toHaveLength(1);
    expect(construct).toHaveBeenCalledWith({
      rid: 3,
      currentVersion: "0.2.0-beta.72",
      version: "0.2.0-beta.73",
      body: "Notes",
      rawJson: { version: "0.2.0-beta.73" },
    });
    expect(result).toEqual({ constructed: expect.objectContaining({ rid: 3 }) });
  });

  it("returns null when there is no newer release", async () => {
    const construct = vi.fn();
    const check = createAppUpdateCheck(async () => ({ kind: "upToDate" }), construct);
    await expect(check()).resolves.toBeNull();
    expect(construct).not.toHaveBeenCalled();
  });

  it("propagates a command failure such as a missing release manifest", async () => {
    const construct = vi.fn();
    const check = createAppUpdateCheck(async () => {
      throw new Error("Could not fetch a valid release JSON from the remote");
    }, construct);
    await expect(check()).rejects.toThrow("valid release JSON");
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects a malformed outcome before constructing an update", async () => {
    const construct = vi.fn();
    const check = createAppUpdateCheck(async () => null, construct);
    await expect(check()).rejects.toThrow(TypeError);
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
    ["a legacy no-release outcome", { kind: "noRelease", channel: "stable" }],
    ["an up-to-date outcome with a channel", { kind: "upToDate", channel: "beta" }],
    ["an unknown field", { ...available, endpoint: "https://example.com" }],
    ["a channel field", { ...available, channel: "beta" }],
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
