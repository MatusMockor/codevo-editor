import { describe, expect, it } from "vitest";
import {
  decodeNodeDebugAttachCandidateListResult,
  isNodeDebugAttachCandidate,
  isNodeDebugAttachCandidateLeaseId,
  isSafeNodeDebugAttachPort,
  MAX_NODE_DEBUG_ATTACH_CANDIDATES,
  MAX_NODE_DEBUG_ATTACH_CANDIDATE_DETAIL_BYTES,
  MAX_NODE_DEBUG_ATTACH_CANDIDATE_LABEL_BYTES,
} from "./nodeDebugAttachCandidate";

const LEASE_ID = "0123456789abcdef0123456789abcdef";

function candidate(candidateLeaseId = LEASE_ID) {
  return {
    candidateLeaseId,
    label: "Node.js inspector",
    detail: "Integrated terminal · 127.0.0.1:9229",
    port: 9_229,
  };
}

describe("Node debug attach candidate contract", () => {
  it("decodes and deeply freezes a redacted ok result", () => {
    const source = {
      status: "ok",
      candidates: [candidate()],
      truncated: false,
    } as const;

    const result = decodeNodeDebugAttachCandidateListResult(source);

    expect(result).toEqual(source);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== "ok") throw new Error("expected ok result");
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(result.candidates[0]).not.toBe(source.candidates[0]);
  });

  it.each(["unavailable", "error"] as const)("decodes and freezes a %s result", (status) => {
    const result = decodeNodeDebugAttachCandidateListResult({ status });

    expect(result).toEqual({ status });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts only the exact wire fields and excludes backend process identity", () => {
    for (const forbidden of [
      "pid",
      "processId",
      "argv",
      "image",
      "processImage",
      "webSocketUrl",
      "wsUrl",
      "manualPort",
    ]) {
      expect(() =>
        decodeNodeDebugAttachCandidateListResult({
          status: "ok",
          candidates: [{ ...candidate(), [forbidden]: "backend-only" }],
          truncated: false,
        }),
      ).toThrow("exactly the fields candidateLeaseId, label, detail, port");
    }

    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [candidate()],
        truncated: false,
        manualPort: 9_229,
      }),
    ).toThrow("exactly the fields status, candidates, truncated");
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "error",
        message: "sensitive backend detail",
      }),
    ).toThrow("exactly the fields status");
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "unavailable",
        truncated: false,
      }),
    ).toThrow("exactly the fields status");
  });

  it("rejects accessors without invoking flipping or throwing getters", () => {
    let reads = 0;
    const flippingCandidate = candidate();
    Object.defineProperty(flippingCandidate, "candidateLeaseId", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? LEASE_ID : "not-a-lease";
      },
    });
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [flippingCandidate],
        truncated: false,
      }),
    ).toThrow("enumerable own data field");
    expect(reads).toBe(0);

    const throwingResult = {
      candidates: [candidate()],
      truncated: false,
    } as Record<string, unknown>;
    Object.defineProperty(throwingResult, "status", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter must never execute");
      },
    });
    expect(() => decodeNodeDebugAttachCandidateListResult(throwingResult)).toThrow(TypeError);
    expect(reads).toBe(0);
  });

  it("requires plain exact own fields including symbols and non-enumerable properties", () => {
    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      status: "ok",
      candidates: [candidate()],
      truncated: false,
    });
    expect(() => decodeNodeDebugAttachCandidateListResult(customPrototype)).toThrow(
      "a plain object",
    );

    const symbolExtra = candidate();
    Object.defineProperty(symbolExtra, Symbol("pid"), {
      enumerable: true,
      value: 41,
    });
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [symbolExtra],
        truncated: false,
      }),
    ).toThrow("string-named own fields only");

    const nonEnumerableExtra = candidate();
    Object.defineProperty(nonEnumerableExtra, "pid", {
      enumerable: false,
      value: 41,
    });
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [nonEnumerableExtra],
        truncated: false,
      }),
    ).toThrow("enumerable own data field");

    const nullPrototype = Object.assign(Object.create(null), {
      status: "ok",
      candidates: [candidate()],
      truncated: false,
    });
    expect(decodeNodeDebugAttachCandidateListResult(nullPrototype).status).toBe("ok");
  });

  it("requires a dense plain array with data entries and no extra fields", () => {
    const sparse = new Array(1);
    const extra = [candidate()] as Array<ReturnType<typeof candidate>> & { pid?: number };
    extra.pid = 41;
    class CandidateArray extends Array<ReturnType<typeof candidate>> {}
    const subclass = new CandidateArray(candidate());
    let getterReads = 0;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterReads += 1;
        return candidate();
      },
    });

    for (const candidates of [sparse, extra, subclass, accessor]) {
      expect(() =>
        decodeNodeDebugAttachCandidateListResult({
          status: "ok",
          candidates,
          truncated: false,
        }),
      ).toThrow(TypeError);
    }
    expect(getterReads).toBe(0);
  });

  it.each([
    "",
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "0123456789abcdef0123456789abcdeg",
    "0123456789ABCDEF0123456789ABCDEF",
    "f".repeat(1_000_000),
    123,
    null,
  ])("rejects malformed lease ID %#", (candidateLeaseId) => {
    expect(isNodeDebugAttachCandidateLeaseId(candidateLeaseId)).toBe(false);
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [candidate(candidateLeaseId as string)],
        truncated: false,
      }),
    ).toThrow("32 lowercase hexadecimal");
  });

  it.each([0, -1, 65_536, 9_229.5, Number.NaN, Number.POSITIVE_INFINITY, "9229"])(
    "rejects unsafe port %#",
    (port) => {
      expect(isSafeNodeDebugAttachPort(port)).toBe(false);
      expect(
        isNodeDebugAttachCandidate({
          ...candidate(),
          port,
        }),
      ).toBe(false);
    },
  );

  it("enforces row and unique-lease bounds", () => {
    const candidates = Array.from({ length: MAX_NODE_DEBUG_ATTACH_CANDIDATES }, (_, index) =>
      candidate(index.toString(16).padStart(32, "0")),
    );
    const result = decodeNodeDebugAttachCandidateListResult({
      status: "ok",
      candidates,
      truncated: true,
    });
    expect(result.status === "ok" && result.candidates).toHaveLength(
      MAX_NODE_DEBUG_ATTACH_CANDIDATES,
    );

    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [...candidates, candidate("f".repeat(32))],
        truncated: true,
      }),
    ).toThrow(`at most ${MAX_NODE_DEBUG_ATTACH_CANDIDATES} candidates`);
    expect(() =>
      decodeNodeDebugAttachCandidateListResult({
        status: "ok",
        candidates: [candidate(), candidate()],
        truncated: false,
      }),
    ).toThrow("unique lease IDs");
  });

  it("measures display bounds in UTF-8 bytes", () => {
    const exactLabel = "é".repeat(MAX_NODE_DEBUG_ATTACH_CANDIDATE_LABEL_BYTES / 2);
    const exactDetail = "é".repeat(MAX_NODE_DEBUG_ATTACH_CANDIDATE_DETAIL_BYTES / 2);
    expect(
      isNodeDebugAttachCandidate({
        ...candidate(),
        label: exactLabel,
        detail: exactDetail,
      }),
    ).toBe(true);
    expect(
      isNodeDebugAttachCandidate({
        ...candidate(),
        label: `${exactLabel}x`,
      }),
    ).toBe(false);
    expect(
      isNodeDebugAttachCandidate({
        ...candidate(),
        detail: `${exactDetail}x`,
      }),
    ).toBe(false);
  });

  it("rejects enormous display text before UTF-8 encoding can amplify work", () => {
    const huge = "x".repeat(1_000_000);
    expect(
      isNodeDebugAttachCandidate({
        ...candidate(),
        label: huge,
      }),
    ).toBe(false);
    expect(
      isNodeDebugAttachCandidate({
        ...candidate(),
        detail: huge,
      }),
    ).toBe(false);
  });

  it.each([
    ["empty label", { label: " " }],
    ["C0 control", { label: "Node\u0000inspector" }],
    ["C1 control", { detail: "Node\u0085inspector" }],
    ["format control", { detail: "Node\u202einspector" }],
    ["line separator", { label: "Node\u2028inspector" }],
    ["paragraph separator", { detail: "Node\u2029inspector" }],
    ["unpaired high surrogate", { label: "Node\ud800" }],
    ["unpaired low surrogate", { detail: "Node\udc00" }],
  ])("rejects %s in display text", (_name, patch) => {
    expect(isNodeDebugAttachCandidate({ ...candidate(), ...patch })).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { status: "unknown", truncated: false },
    { status: "ok", candidates: {}, truncated: false },
    { status: "ok", candidates: [], truncated: 0 },
    { status: "unavailable", truncated: false },
    { status: "error", truncated: false },
  ])("rejects malformed result %#", (value) => {
    expect(() => decodeNodeDebugAttachCandidateListResult(value)).toThrow(TypeError);
  });
});
