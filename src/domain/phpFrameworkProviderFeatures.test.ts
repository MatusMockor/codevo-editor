import { describe, expect, it } from "vitest";
import {
  createPhpFrameworkFeatureBag,
  definePhpFrameworkFeature,
  registerPhpFrameworkFeature,
} from "./phpFrameworkProviderFeatures";

describe("phpFrameworkProviderFeatures", () => {
  it("resolves only the exact typed feature identity", () => {
    const feature = definePhpFrameworkFeature<{ enabled: boolean }>("sample");
    const sameId = definePhpFrameworkFeature<{ enabled: boolean }>("sample");
    const bag = createPhpFrameworkFeatureBag({ id: "owner" }, [
      registerPhpFrameworkFeature(feature, { enabled: true }),
    ]);

    expect(bag.ownerId).toBe("owner");
    expect(bag.get(feature)).toEqual({ enabled: true });
    expect(bag.get(sameId)).toBeUndefined();
    expect(bag.has(feature)).toBe(true);
    expect(bag.has(sameId)).toBe(false);
  });

  it("clones and freezes registrations without mutating caller values", () => {
    const feature = definePhpFrameworkFeature<{ values: string[] }>("sample");
    const value = { values: ["first"] };
    const bag = createPhpFrameworkFeatureBag({ id: "owner" }, [
      registerPhpFrameworkFeature(feature, value),
    ]);

    value.values.push("second");

    expect(value.values).toEqual(["first", "second"]);
    expect(Object.isFrozen(value)).toBe(false);
    expect(bag.get(feature)?.values).toEqual(["first"]);
    expect(Object.isFrozen(bag.get(feature))).toBe(true);
    expect(Object.isFrozen(bag.get(feature)?.values)).toBe(true);
  });

  it("rejects duplicate feature ids for one owner", () => {
    const first = definePhpFrameworkFeature<object>("duplicate");
    const second = definePhpFrameworkFeature<object>("duplicate");

    expect(() =>
      createPhpFrameworkFeatureBag({ id: "owner" }, [
        registerPhpFrameworkFeature(first, {}),
        registerPhpFrameworkFeature(second, {}),
      ]),
    ).toThrow(
      'Duplicate PHP framework feature id "duplicate" for owner "owner".',
    );
  });
});
