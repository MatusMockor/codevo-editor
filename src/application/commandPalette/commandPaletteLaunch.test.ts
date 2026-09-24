import { describe, expect, it, vi } from "vitest";
import { createCommandPaletteLaunch } from "./commandPaletteLaunch";

describe("createCommandPaletteLaunch", () => {
  it("hands a request out exactly once and notifies subscribers", () => {
    const launch = createCommandPaletteLaunch();
    const listener = vi.fn();
    launch.subscribe(listener);
    launch.request({ page: "shortcuts", query: "" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(launch.take()).toEqual({ page: "shortcuts", query: "" });
    expect(launch.take()).toBeNull();
  });

  it("keeps only the latest pending request", () => {
    const launch = createCommandPaletteLaunch();
    launch.request({ page: "root", query: "" });
    launch.request({ page: "shortcuts", query: "tog" });
    expect(launch.take()).toEqual({ page: "shortcuts", query: "tog" });
  });
});
