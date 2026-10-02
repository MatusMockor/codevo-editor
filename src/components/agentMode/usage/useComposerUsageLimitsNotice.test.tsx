// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAccountUsageLoadState } from "../../../domain/agentAccountUsage";
import { AgentComposerUsageLimitsNotice } from "./AgentComposerUsageLimitsNotice";
import { useComposerUsageLimitsNotice } from "./useComposerUsageLimitsNotice";

type Usage = Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const HOUR = 3_600_000;

interface WindowSpec {
  readonly id?: string;
  readonly usedPercent: number;
  readonly resetsAtEpochMs?: number | null;
  readonly resetsLabel?: string | null;
}

function usage(usedPercent: number, fetchedAtEpochMs: number): Usage {
  return usageWith(fetchedAtEpochMs, [{ usedPercent }]);
}

function usageWith(fetchedAtEpochMs: number, windows: ReadonlyArray<WindowSpec>): Usage {
  return {
    claudeCode: {
      kind: "ready",
      snapshot: {
        provider: "claudeCode",
        fetchedAtEpochMs,
        windows: windows.map((spec) => ({
          id: spec.id ?? "seven_day",
          label: "Weekly limit",
          usedPercent: spec.usedPercent,
          windowDurationMinutes: 10_080,
          resetsAtEpochMs: spec.resetsAtEpochMs ?? null,
          resetsLabel: spec.resetsLabel === undefined ? "Sep 28" : spec.resetsLabel,
        })),
      },
    },
    codex: { kind: "idle" },
  };
}

describe("useComposerUsageLimitsNotice", () => {
  let host: HTMLDivElement;
  let root: Root;
  let notice: ReturnType<typeof useComposerUsageLimitsNotice> | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    notice = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({ accountUsage }: { accountUsage: Usage | undefined }) {
    notice = useComposerUsageLimitsNotice(accountUsage, () => NOW);
    return null;
  }

  it("stays hidden under the threshold until /usage shows it", () => {
    act(() => root.render(<Harness accountUsage={usage(40, 1)} />));
    expect(notice?.visible).toBe(false);
    act(() => notice?.show());
    expect(notice?.visible).toBe(true);
    expect(notice?.providers.map((entry) => entry.provider)).toEqual(["claudeCode"]);
  });

  it("appears at 90% and stays dismissed for the same snapshot but returns for a new window", () => {
    act(() => root.render(<Harness accountUsage={usage(89.9, 1)} />));
    expect(notice?.visible).toBe(false);
    act(() => root.render(<Harness accountUsage={usage(90, 1)} />));
    expect(notice?.visible).toBe(true);
    act(() => notice?.dismiss());
    expect(notice?.visible).toBe(false);
    act(() => root.render(<Harness accountUsage={usage(93, 1)} />));
    expect(notice?.visible).toBe(false);
    act(() =>
      root.render(
        <Harness accountUsage={usageWith(2, [{ usedPercent: 94, resetsLabel: "Oct 5" }])} />,
      ),
    );
    expect(notice?.visible).toBe(true);
  });

  it("keeps a dismissed notice hidden when the same window is re-fetched", () => {
    const resetsAtEpochMs = NOW + 2 * HOUR;
    act(() =>
      root.render(<Harness accountUsage={usageWith(1, [{ usedPercent: 95, resetsAtEpochMs }])} />),
    );
    expect(notice?.visible).toBe(true);
    act(() => notice?.dismiss());
    act(() =>
      root.render(<Harness accountUsage={usageWith(2, [{ usedPercent: 97, resetsAtEpochMs }])} />),
    );
    expect(notice?.visible).toBe(false);
    act(() =>
      root.render(
        <Harness
          accountUsage={usageWith(3, [{ usedPercent: 98, resetsLabel: null, resetsAtEpochMs }])}
        />,
      ),
    );
    expect(notice?.visible).toBe(false);
  });

  it("shows a dismissed provider again when a new window resets at a different time", () => {
    act(() =>
      root.render(
        <Harness accountUsage={usageWith(1, [{ usedPercent: 95, resetsAtEpochMs: NOW + HOUR }])} />,
      ),
    );
    act(() => notice?.dismiss());
    expect(notice?.visible).toBe(false);
    act(() =>
      root.render(
        <Harness
          accountUsage={usageWith(2, [{ usedPercent: 91, resetsAtEpochMs: NOW + 5 * HOUR }])}
        />,
      ),
    );
    expect(notice?.visible).toBe(true);
  });

  it("shows a second window crossing the threshold after the first was dismissed", () => {
    const resetsAtEpochMs = NOW + HOUR;
    act(() =>
      root.render(
        <Harness
          accountUsage={usageWith(1, [
            { id: "five_hour", usedPercent: 95, resetsAtEpochMs },
            { id: "seven_day", usedPercent: 50, resetsAtEpochMs: NOW + 48 * HOUR },
          ])}
        />,
      ),
    );
    act(() => notice?.dismiss());
    act(() =>
      root.render(
        <Harness
          accountUsage={usageWith(2, [
            { id: "five_hour", usedPercent: 96, resetsAtEpochMs },
            { id: "seven_day", usedPercent: 92, resetsAtEpochMs: NOW + 48 * HOUR },
          ])}
        />,
      ),
    );
    expect(notice?.visible).toBe(true);
  });

  it("ignores hot windows whose reset time has already passed", () => {
    act(() =>
      root.render(
        <Harness accountUsage={usageWith(1, [{ usedPercent: 99, resetsAtEpochMs: NOW - 1 }])} />,
      ),
    );
    expect(notice?.visible).toBe(false);
    act(() =>
      root.render(
        <Harness accountUsage={usageWith(2, [{ usedPercent: 99, resetsAtEpochMs: NOW }])} />,
      ),
    );
    expect(notice?.visible).toBe(false);
    act(() =>
      root.render(
        <Harness accountUsage={usageWith(3, [{ usedPercent: 99, resetsAtEpochMs: NOW + 1 }])} />,
      ),
    );
    expect(notice?.visible).toBe(true);
  });

  it("lets /usage reopen a dismissed notice for the same snapshot", () => {
    act(() => root.render(<Harness accountUsage={usage(95, 1)} />));
    act(() => notice?.dismiss());
    act(() => notice?.show());
    expect(notice?.visible).toBe(true);
  });

  it("has nothing to show when no provider reported limits", () => {
    act(() =>
      root.render(
        <Harness accountUsage={{ claudeCode: { kind: "idle" }, codex: { kind: "unavailable" } }} />,
      ),
    );
    act(() => notice?.show());
    expect(notice?.providers).toEqual([]);
    expect(notice?.visible).toBe(false);
    act(() => root.render(<Harness accountUsage={undefined} />));
    expect(notice?.visible).toBe(false);
  });

  it("renders the limit bars and dismisses from the banner", () => {
    function NoticeHarness({ accountUsage }: { accountUsage: Usage }) {
      notice = useComposerUsageLimitsNotice(accountUsage, () => NOW);
      return <AgentComposerUsageLimitsNotice notice={notice} />;
    }
    act(() => root.render(<NoticeHarness accountUsage={usage(96, 1)} />));
    expect(host.textContent).toContain("Usage limits");
    expect(host.textContent).toContain("Weekly limit");
    const dismiss = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss usage limits"]',
    );
    act(() => dismiss?.click());
    expect(host.textContent).toBe("");
  });

  it("marks hot limits from an old reading with when they were measured", () => {
    function NoticeHarness({ accountUsage }: { accountUsage: Usage }) {
      notice = useComposerUsageLimitsNotice(accountUsage, Date.now);
      return <AgentComposerUsageLimitsNotice notice={notice} />;
    }
    const fresh = Date.now() - 60_000;
    act(() => root.render(<NoticeHarness accountUsage={usage(96, fresh)} />));
    expect(host.querySelector(".cv-usage-limits__as-of")).toBeNull();

    act(() => root.render(<NoticeHarness accountUsage={usage(96, fresh - 2 * HOUR)} />));
    expect(host.querySelector(".cv-usage-limits__as-of")?.textContent).toMatch(/^As of /u);
    expect(host.querySelector<HTMLElement>(".cv-usage-limits__value")?.dataset.reading).toBe(
      "asOf",
    );
  });
});
