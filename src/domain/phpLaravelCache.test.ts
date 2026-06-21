import { describe, expect, it } from "vitest";
import {
  isUsableLaravelCacheStoreName,
  phpLaravelCacheStoreCompletionInsertText,
  phpLaravelCacheStoreConfigKey,
  phpLaravelCacheStoreNameFromConfigKey,
  phpLaravelCacheStoreReferenceContextAt,
} from "./phpLaravelCache";

describe("phpLaravelCache", () => {
  it("detects supported Laravel Cache store strings", () => {
    const samples = [
      ["Cache::store('redis')", "Cache::store"],
      ["Cache::driver('redis')", "Cache::driver"],
      ["cache()->store('redis')", "cache()->store"],
      ["cache()->driver('redis')", "cache()->driver"],
      ["Cache::store(name: 'redis')", "Cache::store"],
      ["Cache::driver(driver: 'redis')", "Cache::driver"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelCacheStoreReferenceContextAt(
          source,
          positionAfter(source, "redis"),
        ),
      ).toMatchObject({
        call,
        prefix: "redis",
        storeName: "redis",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-cache calls", () => {
    const secondArgument = `<?php\n\nCache::store(null, 'redis');\n`;
    const interpolated = `<?php\n\nCache::store("red$is");\n`;
    const invalid = `<?php\n\nCache::store('redis/main');\n`;
    const wrongCall = `<?php\n\nStorage::disk('redis');\n`;

    expect(
      phpLaravelCacheStoreReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "redis"),
      ),
    ).toBeNull();
    expect(
      phpLaravelCacheStoreReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "red"),
      ),
    ).toBeNull();
    expect(
      phpLaravelCacheStoreReferenceContextAt(invalid, positionAfter(invalid, "redis")),
    ).toBeNull();
    expect(
      phpLaravelCacheStoreReferenceContextAt(wrongCall, positionAfter(wrongCall, "redis")),
    ).toBeNull();
  });

  it("maps cache store names to cache config keys", () => {
    expect(phpLaravelCacheStoreConfigKey("redis")).toBe("cache.stores.redis");
    expect(phpLaravelCacheStoreNameFromConfigKey("cache.stores.database")).toBe(
      "database",
    );
    expect(phpLaravelCacheStoreNameFromConfigKey("cache.stores.redis.driver")).toBe(
      null,
    );
    expect(phpLaravelCacheStoreNameFromConfigKey("cache.default")).toBe(null);
    expect(isUsableLaravelCacheStoreName("redis-cluster")).toBe(true);
    expect(isUsableLaravelCacheStoreName("redis/main")).toBe(false);
  });

  it("uses whole store-name insert text", () => {
    expect(phpLaravelCacheStoreCompletionInsertText("redis")).toBe("redis");
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
