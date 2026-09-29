// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentModelRows } from "../agentMode/agentLaunchPresentation";
import { AgentProviderModelsList } from "./AgentProviderModelsList";

describe("AgentProviderModelsList", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("lists current models with ids and stars, and folds legacy models behind a toggle", () => {
    const rows = agentModelRows("claudeCode");
    const onToggleFavorite = vi.fn();
    act(() =>
      root.render(
        <AgentProviderModelsList
          favoriteKeys={new Set(["claudeCode/claude-opus-5-5"])}
          onToggleFavorite={onToggleFavorite}
          rows={rows}
        />,
      ),
    );
    const current = rows.filter((row) => row.isLegacy !== true && row.value !== "default");
    const legacyCount = rows.filter((row) => row.isLegacy === true).length;
    expect(legacyCount).toBeGreaterThan(0);
    expect(host.querySelectorAll(".settings-models__row").length).toBe(current.length);
    expect(host.textContent).toContain("claude-opus-5-5");
    expect(
      host.querySelector('[aria-label="Favorite Claude Opus 5.5"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host.querySelector('[aria-label="Favorite Claude Opus 5"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
    const legacy = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(`${legacyCount} legacy models`),
    );
    expect(legacy?.getAttribute("aria-expanded")).toBe("false");
    act(() => legacy?.click());
    expect(legacy?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".settings-models__row").length).toBe(
      current.length + legacyCount,
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Favorite Claude Sonnet 5"]')?.click(),
    );
    expect(onToggleFavorite).toHaveBeenCalledWith("claudeCode/claude-sonnet-5");
  });

  it("marks new and default models with badges", () => {
    const rows = agentModelRows("claudeCode");
    act(() =>
      root.render(
        <AgentProviderModelsList favoriteKeys={new Set()} onToggleFavorite={vi.fn()} rows={rows} />,
      ),
    );
    const badgesFor = (choice: string): ReadonlyArray<string> => {
      const row = [...host.querySelectorAll(".settings-models__row")].find(
        (candidate) => candidate.querySelector(".settings-models__id")?.textContent === choice,
      );
      return [...(row?.querySelectorAll(".settings-badge") ?? [])].map(
        (badge) => badge.textContent ?? "",
      );
    };
    const newRow = rows.find((row) => row.isNew && row.isLegacy !== true);
    const defaultRow = rows.find((row) => row.isDefault && row.isLegacy !== true);
    expect(newRow).toBeDefined();
    expect(defaultRow).toBeDefined();
    expect(badgesFor(newRow?.value ?? "")).toContain("NEW");
    expect(badgesFor(defaultRow?.value ?? "")).toContain("Default");
    const plain = rows.find((row) => !row.isNew && !row.isDefault && row.isLegacy !== true);
    expect(badgesFor(plain?.value ?? "")).toEqual([]);
  });

  it("hides the automatic default choice and renders no legacy toggle without legacy models", () => {
    const rows = agentModelRows("codex").filter((row) => row.isLegacy !== true);
    act(() =>
      root.render(
        <AgentProviderModelsList favoriteKeys={new Set()} onToggleFavorite={vi.fn()} rows={rows} />,
      ),
    );
    expect(host.querySelector(".settings-models__legacy")).toBeNull();
    const listed = rows.filter((row) => row.value !== "default");
    expect(host.querySelectorAll(".settings-models__row").length).toBe(listed.length);
    expect(
      [...host.querySelectorAll(".settings-models__id")].map((node) => node.textContent),
    ).not.toContain("default");
  });
});
