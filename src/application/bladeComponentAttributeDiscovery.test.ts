import { describe, expect, it, vi } from "vitest";
import {
  collectBladeComponentAttributes,
  invalidateBladeComponentAttributesForPath,
  type BladeComponentAttributesCacheRef,
} from "./bladeComponentAttributeDiscovery";

const ROOT = "/workspace";
const ANONYMOUS_ALERT_PATH = `${ROOT}/resources/views/components/alert.blade.php`;
const CLASS_ALERT_PATH = `${ROOT}/app/View/Components/Alert.php`;

function makeCacheRef(): BladeComponentAttributesCacheRef {
  return { current: {} };
}

function makeDeps(overrides: {
  cacheRef?: BladeComponentAttributesCacheRef;
  currentWorkspaceRootRef?: { current: string | null };
  readNavigationFileContent: (path: string) => Promise<string>;
}) {
  return {
    cacheRef: overrides.cacheRef ?? makeCacheRef(),
    currentWorkspaceRootRef: overrides.currentWorkspaceRootRef ?? {
      current: ROOT,
    },
    readNavigationFileContent: overrides.readNavigationFileContent,
    workspaceRoot: ROOT,
  };
}

describe("collectBladeComponentAttributes", () => {
  it("parses @props attributes from the anonymous component source", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === ANONYMOUS_ALERT_PATH) {
        return "@props(['type' => 'info', 'message'])";
      }

      throw new Error("missing");
    });

    await expect(
      collectBladeComponentAttributes(
        "alert",
        makeDeps({ readNavigationFileContent }),
      ),
    ).resolves.toEqual(["type", "message"]);
  });

  it("prefers class component constructor attributes over the anonymous view", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === CLASS_ALERT_PATH) {
        return [
          "<?php",
          "class Alert extends Component",
          "{",
          "    public function __construct(public string $type = 'info') {}",
          "}",
        ].join("\n");
      }

      if (path === ANONYMOUS_ALERT_PATH) {
        return "@props(['message'])";
      }

      throw new Error("missing");
    });

    await expect(
      collectBladeComponentAttributes(
        "alert",
        makeDeps({ readNavigationFileContent }),
      ),
    ).resolves.toEqual(["type"]);
  });

  it("caches attributes per component and root", async () => {
    const cacheRef = makeCacheRef();
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === ANONYMOUS_ALERT_PATH) {
        return "@props(['type'])";
      }

      throw new Error("missing");
    });
    const deps = makeDeps({ cacheRef, readNavigationFileContent });

    await collectBladeComponentAttributes("alert", deps);
    const callsAfterFirst = readNavigationFileContent.mock.calls.length;
    await collectBladeComponentAttributes("alert", deps);

    expect(readNavigationFileContent.mock.calls.length).toBe(callsAfterFirst);
  });

  it("stale root drops result", async () => {
    const cacheRef = makeCacheRef();
    const currentWorkspaceRootRef: { current: string | null } = {
      current: ROOT,
    };
    const readNavigationFileContent = vi.fn(async (path: string) => {
      currentWorkspaceRootRef.current = "/other";

      if (path === ANONYMOUS_ALERT_PATH) {
        return "@props(['type'])";
      }

      throw new Error("missing");
    });

    await expect(
      collectBladeComponentAttributes(
        "alert",
        makeDeps({ cacheRef, currentWorkspaceRootRef, readNavigationFileContent }),
      ),
    ).resolves.toEqual([]);
    expect(cacheRef.current[ROOT]).toBeUndefined();
  });

  it("returns no attributes when no component source exists", async () => {
    const readNavigationFileContent = vi.fn(async () => {
      throw new Error("missing");
    });

    await expect(
      collectBladeComponentAttributes(
        "alert",
        makeDeps({ readNavigationFileContent }),
      ),
    ).resolves.toEqual([]);
  });

  it("caches the empty result for missing components", async () => {
    const cacheRef = makeCacheRef();
    const readNavigationFileContent = vi.fn(async () => {
      throw new Error("missing");
    });
    const deps = makeDeps({ cacheRef, readNavigationFileContent });

    await collectBladeComponentAttributes("typo", deps);
    const callsAfterFirst = readNavigationFileContent.mock.calls.length;
    await collectBladeComponentAttributes("typo", deps);

    expect(readNavigationFileContent.mock.calls.length).toBe(callsAfterFirst);
  });

  it("re-probes a missing component after its source path is invalidated", async () => {
    const cacheRef = makeCacheRef();
    const contentByPath = new Map<string, string>();
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const content = contentByPath.get(path);

      if (content === undefined) {
        throw new Error("missing");
      }

      return content;
    });
    const deps = makeDeps({ cacheRef, readNavigationFileContent });

    await expect(collectBladeComponentAttributes("alert", deps)).resolves.toEqual(
      [],
    );

    contentByPath.set(ANONYMOUS_ALERT_PATH, "@props(['type'])");
    invalidateBladeComponentAttributesForPath(
      cacheRef,
      ROOT,
      ANONYMOUS_ALERT_PATH,
    );

    await expect(collectBladeComponentAttributes("alert", deps)).resolves.toEqual(
      ["type"],
    );
  });
});

describe("invalidateBladeComponentAttributesForPath", () => {
  it("drops the root cache when a component source changes", () => {
    const cacheRef = makeCacheRef();
    cacheRef.current[ROOT] = { alert: ["type"] };

    invalidateBladeComponentAttributesForPath(
      cacheRef,
      ROOT,
      ANONYMOUS_ALERT_PATH,
    );

    expect(cacheRef.current[ROOT]).toBeUndefined();
  });

  it("keeps the cache for unrelated paths", () => {
    const cacheRef = makeCacheRef();
    cacheRef.current[ROOT] = { alert: ["type"] };

    invalidateBladeComponentAttributesForPath(
      cacheRef,
      ROOT,
      `${ROOT}/resources/views/welcome.blade.php`,
    );

    expect(cacheRef.current[ROOT]).toEqual({ alert: ["type"] });
  });
});
