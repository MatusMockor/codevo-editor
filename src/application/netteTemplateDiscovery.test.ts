import { describe, expect, it } from "vitest";
import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";

describe("isLatteScanSkippedDirectory", () => {
  it("skips generated and dependency directories by basename", () => {
    expect(isLatteScanSkippedDirectory("/ws/app/vendor")).toBe(true);
    expect(isLatteScanSkippedDirectory("/ws/app/node_modules")).toBe(true);
    expect(isLatteScanSkippedDirectory("/ws/app/UI/Home")).toBe(false);
  });
});
