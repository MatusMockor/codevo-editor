import { describe, expect, it } from "vitest";
import { phpMethodPositionInSource } from "./phpMethodPosition";

describe("phpMethodPositionInSource", () => {
  it("returns the editor position of the first matching method name", () => {
    const source = "<?php\nclass A\n{\n    public function renderShow(): void {}\n}\n";

    expect(phpMethodPositionInSource(source, ["actionShow", "renderShow"]))
      .toEqual({ column: 21, lineNumber: 4 });
  });
});
