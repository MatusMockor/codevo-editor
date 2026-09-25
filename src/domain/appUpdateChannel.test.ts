import { describe, expect, it } from "vitest";
import {
  APP_UPDATE_CHANNELS,
  APP_UPDATE_CHANNEL_LABELS,
  DEFAULT_APP_UPDATE_CHANNEL,
  isAppUpdateChannel,
  normalizeAppUpdateChannel,
} from "./appUpdateChannel";

describe("appUpdateChannel", () => {
  it("is a closed pair of channels with user-facing labels", () => {
    expect(APP_UPDATE_CHANNELS).toEqual(["stable", "beta"]);
    expect(APP_UPDATE_CHANNEL_LABELS).toEqual({ stable: "Stable", beta: "Beta" });
    expect(isAppUpdateChannel("stable")).toBe(true);
    expect(isAppUpdateChannel("beta")).toBe(true);
    expect(isAppUpdateChannel("Beta")).toBe(false);
  });

  it.each([undefined, null, "", "nightly", "STABLE", 1, {}, ["beta"], "constructor", "__proto__"])(
    "falls back to the beta channel for %j",
    (value) => {
      expect(normalizeAppUpdateChannel(value)).toBe(DEFAULT_APP_UPDATE_CHANNEL);
    },
  );

  it("keeps a valid channel", () => {
    expect(normalizeAppUpdateChannel("stable")).toBe("stable");
  });
});
