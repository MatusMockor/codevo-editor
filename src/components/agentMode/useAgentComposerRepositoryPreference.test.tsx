// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_REPOSITORY_PREFERENCE_KEY,
  MAX_COMPOSER_REPOSITORY_PREFERENCES,
  useAgentComposerRepositoryPreference,
  type ComposerRepositoryPreferenceStorage,
} from "./useAgentComposerRepositoryPreference";

describe("composer repository preferences", () => {
  let root: Root;
  let host: HTMLDivElement;
  let current: ReturnType<typeof useAgentComposerRepositoryPreference>;
  let raw: string | null;
  let storage: ComposerRepositoryPreferenceStorage;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    raw = null;
    storage = {
      getItem: vi.fn(() => raw),
      setItem: vi.fn((_key, value) => {
        raw = value;
      }),
    };
  });

  afterEach(() => act(() => root.unmount()));

  function Harness() {
    current = useAgentComposerRepositoryPreference(storage);
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  it("remembers independent projects across A B A and remount, including a deliberate root choice", () => {
    render();
    act(() => current.rememberRepository("/a", "/a/api"));
    act(() => current.rememberRepository("/b", "/b/web"));
    expect(current.preferences.get("/a")).toBe("/a/api");
    expect(current.preferences.get("/b")).toBe("/b/web");
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(current.preferences.get("/a")).toBe("/a/api");
    act(() => current.rememberRepository("/a", "/a"));
    expect(current.preferences.get("/a")).toBe("/a");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      COMPOSER_REPOSITORY_PREFERENCE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { projectRootKey: "/a", repositoryRoot: "/a" },
          { projectRootKey: "/b", repositoryRoot: "/b/web" },
        ],
      }),
    );
  });

  it("evicts the least recently selected project and bounds writes and retained state", () => {
    render();
    act(() => {
      for (let index = 0; index < 100; index += 1) {
        current.rememberRepository(`/p${index}`, `/p${index}/api`);
      }
    });
    expect(current.preferences.size).toBe(MAX_COMPOSER_REPOSITORY_PREFERENCES);
    expect(current.preferences.has("/p0")).toBe(false);
    expect(current.preferences.get("/p99")).toBe("/p99/api");
    act(() => current.rememberRepository("/p68", "/p68"));
    act(() => current.rememberRepository("/next", "/next"));
    expect(current.preferences.has("/p68")).toBe(true);
    expect(current.preferences.has("/p69")).toBe(false);
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ version: 1, entries: [], unknown: true }),
    JSON.stringify({ version: 1, entries: [{ projectRootKey: "/a", repositoryRoot: 42 }] }),
    JSON.stringify({
      version: 1,
      entries: Array.from({ length: 33 }, (_, index) => ({
        projectRootKey: `/${index}`,
        repositoryRoot: `/${index}`,
      })),
    }),
    JSON.stringify({
      version: 1,
      entries: [{ projectRootKey: "/a", repositoryRoot: "é".repeat(3000) }],
    }),
    " ".repeat(300001),
  ])("rejects malformed or oversized storage %#", (value) => {
    raw = value;
    render();
    expect(current.preferences.size).toBe(0);
  });

  it("keeps a working in-memory preference when storage is unavailable or writes exceed quota", () => {
    storage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    render();
    act(() => current.rememberRepository("/a", "/a/api"));
    expect(current.preferences.get("/a")).toBe("/a/api");
  });

  it("rejects oversized UTF-8 paths and embedded nulls before retaining or writing", () => {
    render();
    act(() => {
      current.rememberRepository("/a", "é".repeat(3000));
      current.rememberRepository("/a\0", "/a/api");
    });
    expect(current.preferences.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("evicts oldest entries when valid paths expand beyond the serialized byte budget", () => {
    render();
    act(() => {
      for (let index = 0; index < 32; index += 1) {
        current.rememberRepository(
          `/${index}/${"\u0001".repeat(4000)}`,
          `/${"\u0002".repeat(4000)}`,
        );
      }
    });
    expect(new TextEncoder().encode(raw ?? "").byteLength).toBeLessThanOrEqual(300000);
    const retained = [...current.preferences.entries()];
    expect(retained.length).toBeLessThan(32);
    expect(retained[0]?.[0]).toMatch(/^\/31\//);
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect([...current.preferences.entries()]).toEqual(retained);
  });
});
