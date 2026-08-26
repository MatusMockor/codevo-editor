// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
} from "../domain/settings";
import { AgentsSettingsPanel } from "./AgentsSettingsPanel";

describe("AgentsSettingsPanel", () => {
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

  it("clears favorites with the next persisted revision", () => {
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          agentCliVersionGateway: null,
          appSettings: {
            ...defaultAppSettings(),
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: 7,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 8 }),
    );
  });

  it("does not reuse an exhausted persisted revision", () => {
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          agentCliVersionGateway: null,
          appSettings: {
            ...defaultAppSettings(),
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("can clear a favorite after a corrupt stored snapshot recovers", () => {
    const recovered = normalizeAppSettings({
      agentModelFavoriteKeys: ["claudeCode/unknown"],
      agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
    });
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          agentCliVersionGateway: null,
          appSettings: {
            ...recovered,
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: 1,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 2 }),
    );
  });
});
