import { describe, expect, it } from "vitest";
import {
  bladeViewDataEntryFromSource,
  bladeViewVariableSightingsForView,
  bladeViewVariablesForViewFromEntries,
  mergeBladeViewVariableResolvedTypes,
} from "./bladeViewVariables";

const invoiceControllerSource = `<?php
use App\\Models\\Invoice;

class InvoiceController
{
    public function show(): mixed
    {
        $invoice = Invoice::findOrFail(1);

        return view('invoices.show', ['invoice' => $invoice]);
    }
}
`;

const draftControllerSource = `<?php
use App\\Billing\\Draft;

class DraftController
{
    public function show(): mixed
    {
        $invoice = Draft::findOrFail(1);

        return view('invoices.show', ['invoice' => $invoice]);
    }
}
`;

describe("bladeViewDataEntryFromSource", () => {
  it("captures the view data bindings of a controller source", () => {
    const entry = bladeViewDataEntryFromSource(invoiceControllerSource);

    expect(entry.source).toBe(invoiceControllerSource);
    expect(entry.bindings).toHaveLength(1);
    expect(entry.bindings[0]?.viewName).toBe("invoices.show");
  });
});

describe("bladeViewVariablesForViewFromEntries", () => {
  it("merges variables across entries sorted by name", () => {
    const otherControllerSource = `<?php

return view('invoices.show', ['company' => $company])
    ->with('total', $total);
`;
    const entries = [
      bladeViewDataEntryFromSource(invoiceControllerSource),
      bladeViewDataEntryFromSource(otherControllerSource),
    ];

    const variables = bladeViewVariablesForViewFromEntries(
      entries,
      "invoices.show",
    );

    expect(variables.map((variable) => variable.name)).toEqual([
      "$company",
      "$invoice",
      "$total",
    ]);
  });

  it("ignores bindings for other views", () => {
    const entries = [bladeViewDataEntryFromSource(invoiceControllerSource)];

    expect(bladeViewVariablesForViewFromEntries(entries, "invoices.index")).toEqual(
      [],
    );
  });

  it("keeps a display type hint agreed on by every sighting", () => {
    const entries = [
      bladeViewDataEntryFromSource(invoiceControllerSource),
      bladeViewDataEntryFromSource(invoiceControllerSource),
    ];

    const variables = bladeViewVariablesForViewFromEntries(
      entries,
      "invoices.show",
    );

    expect(variables).toHaveLength(1);
    expect(variables[0]?.typeHint).toBe("Invoice");
  });

  it("drops the display type hint when sightings disagree", () => {
    const entries = [
      bladeViewDataEntryFromSource(invoiceControllerSource),
      bladeViewDataEntryFromSource(draftControllerSource),
    ];

    const variables = bladeViewVariablesForViewFromEntries(
      entries,
      "invoices.show",
    );

    expect(variables).toHaveLength(1);
    expect(variables[0]?.name).toBe("$invoice");
    expect(variables[0]?.typeHint).toBeNull();
  });

  it("keeps the known display type hint when other sightings have none", () => {
    const untypedControllerSource = `<?php

return view('invoices.show', ['invoice' => $invoice]);
`;
    const entries = [
      bladeViewDataEntryFromSource(invoiceControllerSource),
      bladeViewDataEntryFromSource(untypedControllerSource),
    ];

    const variables = bladeViewVariablesForViewFromEntries(
      entries,
      "invoices.show",
    );

    expect(variables).toHaveLength(1);
    expect(variables[0]?.typeHint).toBe("Invoice");
  });
});

describe("bladeViewVariableSightingsForView", () => {
  it("returns each sighting of a view variable with its source", () => {
    const entries = [
      bladeViewDataEntryFromSource(invoiceControllerSource),
      bladeViewDataEntryFromSource(draftControllerSource),
    ];

    const sightings = bladeViewVariableSightingsForView(
      entries,
      "invoices.show",
      "$invoice",
    );

    expect(sightings).toHaveLength(2);
    expect(sightings[0]?.source).toBe(invoiceControllerSource);
    expect(sightings[1]?.source).toBe(draftControllerSource);
    expect(
      sightings.every((sighting) => sighting.variable.name === "$invoice"),
    ).toBe(true);
  });

  it("matches the variable name case-insensitively and ignores others", () => {
    const entries = [bladeViewDataEntryFromSource(invoiceControllerSource)];

    expect(
      bladeViewVariableSightingsForView(entries, "invoices.show", "$Invoice"),
    ).toHaveLength(1);
    expect(
      bladeViewVariableSightingsForView(entries, "invoices.show", "$other"),
    ).toEqual([]);
  });
});

describe("mergeBladeViewVariableResolvedTypes", () => {
  it("returns null when nothing resolved", () => {
    expect(mergeBladeViewVariableResolvedTypes([])).toBeNull();
    expect(mergeBladeViewVariableResolvedTypes([null, null])).toBeNull();
  });

  it("returns the single resolved type", () => {
    expect(
      mergeBladeViewVariableResolvedTypes(["App\\Models\\Invoice"]),
    ).toBe("App\\Models\\Invoice");
  });

  it("ignores unresolved sightings next to a resolved type", () => {
    expect(
      mergeBladeViewVariableResolvedTypes([null, "App\\Models\\Invoice", null]),
    ).toBe("App\\Models\\Invoice");
  });

  it("treats leading-backslash and case variants as the same type", () => {
    expect(
      mergeBladeViewVariableResolvedTypes([
        "App\\Models\\Invoice",
        "\\App\\Models\\Invoice",
        "app\\models\\invoice",
      ]),
    ).toBe("App\\Models\\Invoice");
  });

  it("returns null when sightings resolve to conflicting types", () => {
    expect(
      mergeBladeViewVariableResolvedTypes([
        "App\\Models\\Invoice",
        "App\\Billing\\Draft",
      ]),
    ).toBeNull();
  });
});
