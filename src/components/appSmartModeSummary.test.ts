import { describe, expect, it } from "vitest";
import type { LanguageServerPlan } from "../domain/languageServer";
import { smartModeSummary } from "./appSmartModeSummary";

const readyPlan: LanguageServerPlan = {
  command: null,
  initializeRequest: null,
  message: "ready",
  provider: "phpactor",
  status: "ready",
};

describe("smartModeSummary", () => {
  it("keeps workspace, intelligence-mode, and trust precedence stable", () => {
    expect(smartModeSummary(null, "fullSmart", null, readyPlan, true)).toBe("No workspace");
    expect(smartModeSummary("/workspace", "basic", null, readyPlan, true)).toBe("Lightweight");
    expect(smartModeSummary("/workspace", "lightSmart", null, readyPlan, true)).toBe("Smart Index");
    expect(smartModeSummary("/workspace", "fullSmart", null, readyPlan, false)).toBe("Untrusted");
  });

  it("projects only runtime state owned by the current workspace", () => {
    expect(
      smartModeSummary(
        "/workspace",
        "fullSmart",
        { kind: "starting", rootPath: "/workspace", sessionId: 1 },
        readyPlan,
        true,
      ),
    ).toBe("PHPactor: starting");
    expect(
      smartModeSummary(
        "/workspace",
        "fullSmart",
        { kind: "starting", rootPath: "/other", sessionId: 1 },
        readyPlan,
        true,
      ),
    ).toBe("IDE ready");
  });

  it("falls back truthfully when no runtime or ready plan exists", () => {
    expect(smartModeSummary("/workspace", "fullSmart", null, readyPlan, true)).toBe("IDE ready");
    expect(smartModeSummary("/workspace", "fullSmart", null, null, true)).toBe("IDE setup needed");
  });
});
