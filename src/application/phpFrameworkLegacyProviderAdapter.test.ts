import { describe, expect, it } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  composePhpFrameworkLegacyProvider,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";

describe("phpFrameworkLegacyProviderAdapter", () => {
  it("clones immutable snapshots without freezing the caller provider", () => {
    const searchQueries = ["route("];
    const provider: PhpFrameworkProvider = {
      id: "mutable",
      routes: { searchQueries },
    };
    const snapshot = composePhpFrameworkLegacyProvider(
      projectPhpFrameworkLegacyProvider(provider),
    );

    searchQueries.push("resource(");
    provider.presentation = { activityLabel: "Still mutable" };

    expect(snapshot).not.toBe(provider);
    expect(snapshot.routes?.searchQueries).toEqual(["route("]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.routes)).toBe(true);
    expect(Object.isFrozen(provider)).toBe(false);
    expect(Object.isFrozen(searchQueries)).toBe(false);
  });
});
