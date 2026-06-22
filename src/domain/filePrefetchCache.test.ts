import { describe, expect, it } from "vitest";
import {
  FilePrefetchCache,
  shouldPrefetchFileContent,
} from "./filePrefetchCache";

describe("FilePrefetchCache", () => {
  it("returns cached content for the same workspace root and path", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/src/User.php", "<?php class User {}");

    expect(cache.get("/workspace", "/workspace/src/User.php")).toBe(
      "<?php class User {}",
    );
  });

  it("returns null for an unknown path", () => {
    const cache = new FilePrefetchCache();

    expect(cache.get("/workspace", "/workspace/src/Missing.php")).toBeNull();
  });

  it("normalizes trailing separators in the workspace root key", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace/", "/workspace/src/User.php", "content");

    expect(cache.get("/workspace", "/workspace/src/User.php")).toBe("content");
  });

  it("does not return content stored under a different workspace root", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace-a", "/shared/User.php", "a-content");

    expect(cache.get("/workspace-b", "/shared/User.php")).toBeNull();
  });

  it("treats a null root lookup as a miss", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/src/User.php", "content");

    expect(cache.get(null, "/workspace/src/User.php")).toBeNull();
  });

  it("invalidates a single cached entry", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/src/User.php", "old");
    cache.invalidate("/workspace/src/User.php");

    expect(cache.get("/workspace", "/workspace/src/User.php")).toBeNull();
  });

  it("invalidates an entry regardless of which workspace root stored it", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/src/User.php", "old");
    cache.invalidate("/workspace/src/User.php");

    expect(cache.get("/workspace", "/workspace/src/User.php")).toBeNull();
  });

  it("clears every entry", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/a.php", "a");
    cache.set("/workspace", "/workspace/b.php", "b");
    cache.clear();

    expect(cache.get("/workspace", "/workspace/a.php")).toBeNull();
    expect(cache.get("/workspace", "/workspace/b.php")).toBeNull();
  });

  it("reports whether an entry is already cached for a root", () => {
    const cache = new FilePrefetchCache();
    cache.set("/workspace", "/workspace/a.php", "a");

    expect(cache.has("/workspace", "/workspace/a.php")).toBe(true);
    expect(cache.has("/workspace", "/workspace/b.php")).toBe(false);
    expect(cache.has("/workspace-b", "/workspace/a.php")).toBe(false);
  });

  it("evicts the least recently used entry when the entry limit is reached", () => {
    const cache = new FilePrefetchCache({ maxEntries: 2 });
    cache.set("/workspace", "/workspace/a.php", "a");
    cache.set("/workspace", "/workspace/b.php", "b");
    cache.set("/workspace", "/workspace/c.php", "c");

    expect(cache.get("/workspace", "/workspace/a.php")).toBeNull();
    expect(cache.get("/workspace", "/workspace/b.php")).toBe("b");
    expect(cache.get("/workspace", "/workspace/c.php")).toBe("c");
  });

  it("treats a read as recent use so it is not the next eviction target", () => {
    const cache = new FilePrefetchCache({ maxEntries: 2 });
    cache.set("/workspace", "/workspace/a.php", "a");
    cache.set("/workspace", "/workspace/b.php", "b");
    cache.get("/workspace", "/workspace/a.php");
    cache.set("/workspace", "/workspace/c.php", "c");

    expect(cache.get("/workspace", "/workspace/a.php")).toBe("a");
    expect(cache.get("/workspace", "/workspace/b.php")).toBeNull();
    expect(cache.get("/workspace", "/workspace/c.php")).toBe("c");
  });

  it("evicts oldest entries when the total byte budget is exceeded", () => {
    const cache = new FilePrefetchCache({ maxTotalBytes: 10 });
    cache.set("/workspace", "/workspace/a.php", "aaaaa");
    cache.set("/workspace", "/workspace/b.php", "bbbbb");
    cache.set("/workspace", "/workspace/c.php", "ccccc");

    expect(cache.get("/workspace", "/workspace/a.php")).toBeNull();
    expect(cache.get("/workspace", "/workspace/c.php")).toBe("ccccc");
  });
});

describe("shouldPrefetchFileContent", () => {
  it("allows ordinary source files", () => {
    expect(shouldPrefetchFileContent("/workspace/src/User.php")).toBe(true);
  });

  it("rejects common binary extensions", () => {
    expect(shouldPrefetchFileContent("/workspace/assets/logo.png")).toBe(false);
    expect(shouldPrefetchFileContent("/workspace/build/app.wasm")).toBe(false);
    expect(shouldPrefetchFileContent("/workspace/archive.zip")).toBe(false);
  });

  it("rejects blank paths", () => {
    expect(shouldPrefetchFileContent("")).toBe(false);
  });
});
