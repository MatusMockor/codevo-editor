import { describe, expect, it } from "vitest";
import {
  isLaravelHigherOrderCollectionProxyMethod,
  phpLaravelHigherOrderCollectionProxyElementType,
} from "./phpLaravelHigherOrderProxy";

const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class User extends Model
{
}
`;

const collectionType = "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\User>";

describe("phpLaravelHigherOrderProxy", () => {
  it("recognises higher-order collection proxy methods", () => {
    for (const method of [
      "map",
      "filter",
      "each",
      "reject",
      "sortBy",
      "groupBy",
      "partition",
      "sum",
      "every",
      "some",
      "unique",
      "keyBy",
      "contains",
      "flatMap",
    ]) {
      expect(isLaravelHigherOrderCollectionProxyMethod(method)).toBe(true);
    }
  });

  it("does not treat control-flow proxies or arbitrary methods as element proxies", () => {
    for (const method of ["when", "unless", "until", "pluck", "all", "toArray", "load"]) {
      expect(isLaravelHigherOrderCollectionProxyMethod(method)).toBe(false);
    }
  });

  it("resolves the element type for a higher-order proxy member on a collection", () => {
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "map",
        collectionType,
      ),
    ).toBe("App\\Models\\User");
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "filter",
        collectionType,
      ),
    ).toBe("App\\Models\\User");
  });

  it("resolves the element type for support and lazy collections too", () => {
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "reject",
        "Illuminate\\Support\\Collection<int, App\\Models\\User>",
      ),
    ).toBe("App\\Models\\User");
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "each",
        "Illuminate\\Support\\LazyCollection<int, App\\Models\\User>",
      ),
    ).toBe("App\\Models\\User");
  });

  it("does not apply the proxy when the member is not a higher-order method", () => {
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "pluck",
        collectionType,
      ),
    ).toBeNull();
  });

  it("does not apply the proxy when the receiver is not a collection", () => {
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(
        modelSource,
        "map",
        "App\\Models\\User",
      ),
    ).toBeNull();
    expect(
      phpLaravelHigherOrderCollectionProxyElementType(modelSource, "map", null),
    ).toBeNull();
  });
});
