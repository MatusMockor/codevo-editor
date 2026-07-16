import { describe, expect, it } from "vitest";
import { createLatteIntelligenceCaches } from "./latteIntelligenceCaches";

describe("createLatteIntelligenceCaches", () => {
  it("creates isolated include-argument cache, in-flight, and generation state", () => {
    const first = createLatteIntelligenceCaches();
    const second = createLatteIntelligenceCaches();

    first.includeArgumentGenerationByRoot["/workspace"] = 3;
    first.includeArgumentInFlight.queries.set(
      "/workspace\0query",
      Promise.resolve([]),
    );

    expect(second.includeArgumentCache).toEqual({});
    expect(second.includeArgumentGenerationByRoot).toEqual({});
    expect(second.includeArgumentInFlight.graphs.size).toBe(0);
    expect(second.includeArgumentInFlight.queries.size).toBe(0);
  });
});
