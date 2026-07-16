import { describe, expect, it } from "vitest";
import { latteFilterRegistrationsFromSource } from "./latteFilterRegistrations";

function offsetOf(source: string, needle: string, start = 0): number {
  const index = source.indexOf(needle, start);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index;
}

function callable(
  source: string,
  serviceName: string,
  methodName: string,
  start = 0,
) {
  return {
    methodName,
    methodOffset: offsetOf(source, methodName, start),
    serviceName,
    serviceOffset: offsetOf(source, serviceName, start),
  };
}

function inlineObjectCallable(
  source: string,
  serviceClassName: string,
  methodName: string,
  start = 0,
) {
  return {
    methodName,
    methodOffset: offsetOf(source, methodName, start),
    serviceClassName,
    serviceOffset: offsetOf(source, serviceClassName, start),
  };
}

describe("latteFilterRegistrationsFromSource", () => {
  it("extracts real ebox-crm inline object filter callables", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register('activeLabel', [Crm\\ApplicationModule\\Helpers\\ActiveLabelHelper(), process])",
      "            - register('diff', [Crm\\ApplicationModule\\Helpers\\DiffHelper(), process])",
      "            - register('json', [Crm\\ApplicationModule\\Helpers\\JsonHelper(), process])",
      "            - register('gravatar', [Crm\\UsersModule\\Helpers\\GravatarHelper(), process])",
      "            - register('userLabel', [Crm\\UsersModule\\Helpers\\UserLabelHelper(), process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: inlineObjectCallable(
          source,
          "Crm\\ApplicationModule\\Helpers\\ActiveLabelHelper",
          "process",
        ),
        name: "activeLabel",
        offset: offsetOf(source, "activeLabel"),
      },
      {
        callable: inlineObjectCallable(
          source,
          "Crm\\ApplicationModule\\Helpers\\DiffHelper",
          "process",
          offsetOf(source, "diff"),
        ),
        name: "diff",
        offset: offsetOf(source, "diff"),
      },
      {
        callable: inlineObjectCallable(
          source,
          "Crm\\ApplicationModule\\Helpers\\JsonHelper",
          "process",
          offsetOf(source, "json"),
        ),
        name: "json",
        offset: offsetOf(source, "json"),
      },
      {
        callable: inlineObjectCallable(
          source,
          "Crm\\UsersModule\\Helpers\\GravatarHelper",
          "process",
          offsetOf(source, "gravatar"),
        ),
        name: "gravatar",
        offset: offsetOf(source, "gravatar"),
      },
      {
        callable: inlineObjectCallable(
          source,
          "Crm\\UsersModule\\Helpers\\UserLabelHelper",
          "process",
          offsetOf(source, "userLabel"),
        ),
        name: "userLabel",
        offset: offsetOf(source, "userLabel"),
      },
    ]);
  });

  it("extracts addFilter() names from any service setup", () => {
    const source = [
      "services:",
      "    latte.latteFactory:",
      "        setup:",
      "            - addFilter('money', [@moneyHelper, format])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: callable(source, "moneyHelper", "format"),
        name: "money",
        offset: offsetOf(source, "money"),
      },
    ]);
  });

  it("extracts @self filter callables from setup methods", () => {
    const source = [
      "services:",
      "    latte.latteFactory:",
      "        class: App\\Latte\\LatteFactory",
      "        setup:",
      "            - addFilter('money', [@self, format])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: {
          ...callable(source, "self", "format"),
          serviceClassName: "App\\Latte\\LatteFactory",
        },
        name: "money",
        offset: offsetOf(source, "money"),
      },
    ]);
  });

  it("resolves @self filter callables from factory and class-key services", () => {
    const source = [
      "services:",
      "    factoryFilter:",
      "        factory: App\\Latte\\FactoryFilter",
      "        setup:",
      "            - addFilter('factoryMoney', [@self, format])",
      "    App\\Latte\\KeyFilter:",
      "        setup:",
      "            - addFilter('keyMoney', [@self, format])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: {
          ...callable(source, "self", "format", offsetOf(source, "factoryMoney")),
          serviceClassName: "App\\Latte\\FactoryFilter",
        },
        name: "factoryMoney",
        offset: offsetOf(source, "factoryMoney"),
      },
      {
        callable: {
          ...callable(source, "self", "format", offsetOf(source, "keyMoney")),
          serviceClassName: "App\\Latte\\KeyFilter",
        },
        name: "keyMoney",
        offset: offsetOf(source, "keyMoney"),
      },
    ]);
  });

  it("does not extract register() under a service unrelated to filters", () => {
    const source = [
      "services:",
      "    measurementManager:",
      "        setup:",
      "            - register(Crm\\UsersModule\\Measurements\\SignInMeasurement())",
      "    scenariosGenericEventsManager:",
      "        setup:",
      "            - register('generate_password_reset_url', Crm\\UsersModule\\Scenarios\\GeneratePasswordResetUrlGenericAction())",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([]);
  });

  it("keeps filter names but skips dynamic or invalid callables", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register('dynamicService', [$service, process])",
      "            - register('dynamicMethod', [@helper, %method%])",
      "            - register('numericMethod', [@helper, 123])",
      "            - register('classCallable', [Helper::class, process])",
      "            - register('shortClass', [Helper(), process])",
      "            - register('constructorArgument', [App\\Helper('value'), process])",
      "            - register('missingSegment', [App\\(), process])",
      "            - register('missingMethod', [App\\Helper(), ])",
      "            - register('trailingMember', [App\\Helper(), process::call])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      { name: "dynamicService", offset: offsetOf(source, "dynamicService") },
      { name: "dynamicMethod", offset: offsetOf(source, "dynamicMethod") },
      { name: "numericMethod", offset: offsetOf(source, "numericMethod") },
      { name: "classCallable", offset: offsetOf(source, "classCallable") },
      { name: "shortClass", offset: offsetOf(source, "shortClass") },
      {
        name: "constructorArgument",
        offset: offsetOf(source, "constructorArgument"),
      },
      { name: "missingSegment", offset: offsetOf(source, "missingSegment") },
      { name: "missingMethod", offset: offsetOf(source, "missingMethod") },
      { name: "trailingMember", offset: offsetOf(source, "trailingMember") },
    ]);
  });

  it("matches the filter service hint case-insensitively", () => {
    const source = [
      "services:",
      "    latte.FilterLoader:",
      "        setup:",
      "            - register('userDate', [@userDateHelper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: callable(source, "userDateHelper", "process"),
        name: "userDate",
        offset: offsetOf(source, "userDate"),
      },
    ]);
  });

  it("skips non-literal first arguments", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register(@nafaInvoiceProvider)",
      "            - register(Crm\\InvoiceModule\\Helpers\\PriceHelper())",
      "            - register(%filterName%, [@helper, process])",
      "            - addFilter(@dynamicName, [@helper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([]);
  });

  it("does not extract register() from an anonymous service without a name", () => {
    const source = [
      "services:",
      "    - factory: App\\Latte\\FilterLoader",
      "      setup:",
      "          - register('anonymous', [@helper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([]);
  });

  it("handles quoting and comment edge cases", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register('it''s', [@helper, process]) # trailing comment",
      "            - register(\"with # hash\", [@helper, process])",
      "            # - register('commentedOut', [@helper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: callable(source, "helper", "process", offsetOf(source, "it''s")),
        name: "it's",
        offset: offsetOf(source, "it''s"),
      },
      {
        callable: callable(source, "helper", "process", offsetOf(source, "with # hash")),
        name: "with # hash",
        offset: offsetOf(source, "with # hash"),
      },
    ]);
  });

  it("ignores unterminated and empty string literals", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register('', [@helper, process])",
      "            - register('broken",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([]);
  });

  it("extracts register() names from an inline setup list", () => {
    const source = [
      "services:",
      "    filterLoader: {setup: [register('inline', [@helper, process])]}",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      {
        callable: callable(source, "helper", "process"),
        name: "inline",
        offset: offsetOf(source, "inline"),
      },
    ]);
  });
});
