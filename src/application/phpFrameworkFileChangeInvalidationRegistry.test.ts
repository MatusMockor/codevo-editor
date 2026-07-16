import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  createPhpFrameworkFileChangeInvalidator,
} from "./phpFrameworkFileChangeInvalidationRegistry";

const ROOT = "/workspace";
const PATH = `${ROOT}/app/Changed.php`;

function dependencies(providers: readonly PhpFrameworkProvider[] = []) {
  return {
    frameworkRuntime: {
      providers,
    },
    invalidateBladeComponentNamesForPath: vi.fn(),
    invalidateBladeViewDataEntriesForPath: vi.fn(),
    invalidateLatteExpressionDataForPath: vi.fn(),
    invalidateNeonConfigForPath: vi.fn(),
  };
}

describe("createPhpFrameworkFileChangeInvalidator", () => {
  it("is inert when no framework provider is active", () => {
    const invalidators = dependencies();
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
    expect(
      invalidators.invalidateLatteExpressionDataForPath,
    ).not.toHaveBeenCalled();
  });

  it("runs both Laravel Blade invalidators in their existing order", () => {
    const calls: string[] = [];
    const invalidators = {
      ...dependencies([phpLaravelFrameworkProvider]),
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
    expect(
      invalidators.invalidateLatteExpressionDataForPath,
    ).not.toHaveBeenCalled();
  });

  it("runs the Nette expression-data and Neon invalidators", () => {
    const invalidators = dependencies([phpNetteFrameworkProvider]);
    const invalidateForPath =
      createPhpFrameworkFileChangeInvalidator(invalidators);

    invalidateForPath(ROOT, PATH);

    expect(invalidators.invalidateNeonConfigForPath).toHaveBeenCalledWith(
      ROOT,
      PATH,
    );
    expect(
      invalidators.invalidateLatteExpressionDataForPath,
    ).toHaveBeenCalledWith(ROOT, PATH);
    expect(
      invalidators.invalidateBladeComponentNamesForPath,
    ).not.toHaveBeenCalled();
    expect(
      invalidators.invalidateBladeViewDataEntriesForPath,
    ).not.toHaveBeenCalled();
  });

  it("runs provider-owned descriptors in active provider order", () => {
    const calls: string[] = [];
    const invalidators = {
      ...dependencies([
        {
          id: "first",
          fileChangeInvalidations: [{ kind: "neonConfig" }],
        },
        {
          id: "second",
          fileChangeInvalidations: [{ kind: "bladeComponentNames" }],
        },
      ]),
      invalidateBladeComponentNamesForPath: vi.fn(() =>
        calls.push("components"),
      ),
      invalidateNeonConfigForPath: vi.fn(() => calls.push("neon")),
    };
    const invalidateForPath =
      createPhpFrameworkFileChangeInvalidator(invalidators);

    invalidateForPath(ROOT, PATH);

    expect(calls).toEqual(["neon", "components"]);
  });
});
