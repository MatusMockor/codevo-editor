import { describe, expect, it } from "vitest";
import { latteFilterRegistrationsFromSource } from "./latteFilterRegistrations";

function offsetOf(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index;
}

describe("latteFilterRegistrationsFromSource", () => {
  it("extracts register() names with offsets under a filterLoader service", () => {
    const source = [
      "services:",
      "    filterLoader:",
      "        setup:",
      "            - register('gravatar', [Crm\\UsersModule\\Helpers\\GravatarHelper(), process])",
      "            - register('userLabel', [@userLabelHelper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      { name: "gravatar", offset: offsetOf(source, "gravatar") },
      { name: "userLabel", offset: offsetOf(source, "userLabel") },
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
      { name: "money", offset: offsetOf(source, "money") },
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

  it("matches the filter service hint case-insensitively", () => {
    const source = [
      "services:",
      "    latte.FilterLoader:",
      "        setup:",
      "            - register('userDate', [@userDateHelper, process])",
      "",
    ].join("\n");

    expect(latteFilterRegistrationsFromSource(source)).toEqual([
      { name: "userDate", offset: offsetOf(source, "userDate") },
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
      { name: "it's", offset: offsetOf(source, "it''s") },
      { name: "with # hash", offset: offsetOf(source, "with # hash") },
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
      { name: "inline", offset: offsetOf(source, "inline") },
    ]);
  });
});
