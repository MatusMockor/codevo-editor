import { describe, expect, it } from "vitest";
import {
  SPEECH_MAX_SERVER_CANDIDATES,
  speechServerPreference,
  type SpeechServerCandidate,
} from "./speechServerSelection";

const candidate = (
  serverId: string,
  connected = true,
  speechTranscription = true,
): SpeechServerCandidate => ({ serverId, connected, speechTranscription });

describe("speech server preference", () => {
  it("puts the thread's own capable server first and keeps the others as fallbacks", () => {
    expect(
      speechServerPreference({
        threadServerId: "b",
        candidates: [candidate("a"), candidate("b"), candidate("c")],
      }),
    ).toEqual(["b", "a", "c"]);
  });
  it.each([
    ["disconnected", candidate("b", false, true)],
    ["without the capability", candidate("b", true, false)],
  ])("falls back to the capable servers in order when the thread server is %s", (_, own) => {
    expect(
      speechServerPreference({
        threadServerId: "b",
        candidates: [candidate("z", true, false), own, candidate("c"), candidate("a")],
      }),
    ).toEqual(["c", "a"]);
  });
  it("lists the capable servers in the given order without a thread server", () => {
    expect(
      speechServerPreference({
        threadServerId: null,
        candidates: [candidate("m", false), candidate("k"), candidate("a")],
      }),
    ).toEqual(["k", "a"]);
    expect(
      speechServerPreference({ threadServerId: "missing", candidates: [candidate("k")] }),
    ).toEqual(["k"]);
  });
  it("lists nothing when no connected server advertises speech", () => {
    expect(speechServerPreference({ threadServerId: "a", candidates: [] })).toEqual([]);
    expect(
      speechServerPreference({
        threadServerId: "a",
        candidates: [candidate("a", false), candidate("b", true, false)],
      }),
    ).toEqual([]);
  });
  it("bounds the fallback scan without hiding the thread's own server", () => {
    const filler = Array.from({ length: SPEECH_MAX_SERVER_CANDIDATES }, (_, index) =>
      candidate(`s${index}`, true, false),
    );
    const candidates = [...filler, candidate("late")];
    expect(speechServerPreference({ threadServerId: "late", candidates })).toEqual(["late"]);
    expect(speechServerPreference({ threadServerId: null, candidates })).toEqual([]);
    expect(speechServerPreference({ threadServerId: "s0", candidates })).toEqual([]);
  });
  it("never lists more than the bounded fallbacks plus the thread server", () => {
    const many = Array.from({ length: SPEECH_MAX_SERVER_CANDIDATES + 8 }, (_, index) =>
      candidate(`s${index}`),
    );
    const last = `s${SPEECH_MAX_SERVER_CANDIDATES + 7}`;
    const listed = speechServerPreference({ threadServerId: last, candidates: many });
    expect(listed).toHaveLength(SPEECH_MAX_SERVER_CANDIDATES + 1);
    expect(listed[0]).toBe(last);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
