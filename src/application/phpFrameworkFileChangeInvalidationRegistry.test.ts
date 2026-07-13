import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkFileChangeInvalidator,
} from "./phpFrameworkFileChangeInvalidationRegistry";

const ROOT = "/workspace";
const PATH = `${ROOT}/app/Changed.php`;

function dependencies(providerId: string | null) {
  return {
    frameworkRuntime: {
      hasProvider: (candidateProviderId: string) =>
        candidateProviderId === providerId,
    },
    invalidateBladeComponentNamesForPath: vi.fn(),
    invalidateBladeViewDataEntriesForPath: vi.fn(),
    invalidateNeonConfigForPath: vi.fn(),
  };
}

describe("createPhpFrameworkFileChangeInvalidator", () => {
  it("is inert when no framework provider is active", () => {
    const invalidators = dependencies(null);
    const invalidateForPath =
      createPhpFrameworkFileChangeInvalidator(invalidators);

    invalidateForPath(ROOT, PATH);

    expect(
      invalidators.invalidateBladeComponentNamesForPath,
    ).not.toHaveBeenCalled();
    expect(
      invalidators.invalidateBladeViewDataEntriesForPath,
    ).not.toHaveBeenCalled();
    expect(invalidators.invalidateNeonConfigForPath).not.toHaveBeenCalled();
  });

  it("runs both Laravel Blade invalidators in their existing order", () => {
    const calls: string[] = [];
    const invalidators = {
      ...dependencies("laravel"),
      invalidateBladeComponentNamesForPath: vi.fn(() =>
        calls.push("components"),
      ),
      invalidateBladeViewDataEntriesForPath: vi.fn(() =>
        calls.push("viewData"),
      ),
    };
    const invalidateForPath =
      createPhpFrameworkFileChangeInvalidator(invalidators);

    invalidateForPath(ROOT, PATH);

    expect(calls).toEqual(["components", "viewData"]);
    expect(
      invalidators.invalidateBladeComponentNamesForPath,
    ).toHaveBeenCalledWith(ROOT, PATH);
    expect(
      invalidators.invalidateBladeViewDataEntriesForPath,
    ).toHaveBeenCalledWith(ROOT, PATH);
    expect(invalidators.invalidateNeonConfigForPath).not.toHaveBeenCalled();
  });

  it("runs only the Nette Neon invalidator for Nette", () => {
    const invalidators = dependencies("nette");
    const invalidateForPath =
      createPhpFrameworkFileChangeInvalidator(invalidators);

    invalidateForPath(ROOT, PATH);

    expect(invalidators.invalidateNeonConfigForPath).toHaveBeenCalledWith(
      ROOT,
      PATH,
    );
    expect(
      invalidators.invalidateBladeComponentNamesForPath,
    ).not.toHaveBeenCalled();
    expect(
      invalidators.invalidateBladeViewDataEntriesForPath,
    ).not.toHaveBeenCalled();
  });
});
