import { describe, expect, it } from "vitest";
import {
  bladeLaravelReferenceDiagnostics,
  missingLaravelViewReferenceAt,
  phpLaravelReferenceDiagnostics,
} from "./laravelDiagnostics";

describe("laravelDiagnostics", () => {
  it("reports a missing PHP view reference when views are indexed", () => {
    const diagnostics = phpLaravelReferenceDiagnostics(
      "<?php\nreturn view('orders.show');\n",
      { viewNames: ["dashboard"] },
    );

    expect(diagnostics).toMatchObject([
      {
        code: "laravel.missingView",
        kind: "missing-view",
        line: 1,
        message: "No Laravel view named orders.show was found.",
        name: "orders.show",
        severity: "warning",
        source: "Laravel",
      },
    ]);
    expect(diagnostics[0]?.data).toEqual({
      kind: "missing-view",
      name: "orders.show",
      relativePath: "resources/views/orders/show.blade.php",
    });
  });

  it("skips fallback and existence-check view calls", () => {
    const diagnostics = phpLaravelReferenceDiagnostics(
      "<?php\nView::exists('missing');\nView::first(['also.missing']);\n",
      { viewNames: ["dashboard"] },
    );

    expect(diagnostics).toEqual([]);
  });

  it("reports missing Blade views only for concrete include and extends directives", () => {
    const diagnostics = bladeLaravelReferenceDiagnostics(
      "@extends('layouts.app')\n@include('partials.card')\n@includeIf('maybe')\n",
      { viewNames: ["layouts.admin"] },
    );

    expect(diagnostics.map((diagnostic) => diagnostic.name)).toEqual([
      "layouts.app",
      "partials.card",
    ]);
  });

  it("reports missing route and config keys when indexes are present", () => {
    const diagnostics = phpLaravelReferenceDiagnostics(
      "<?php\nroute('orders.show');\nconfig('mail.mailers.smtp');\n",
      {
        configKeys: ["mail.mailers.log"],
        routeNames: ["home"],
      },
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "laravel.missingRoute",
      "laravel.missingConfig",
    ]);
  });

  it("does not report nested config keys when the config file could not be indexed", () => {
    const diagnostics = phpLaravelReferenceDiagnostics(
      "<?php\nconfig('mail.mailers.smtp');\n",
      { configKeys: ["mail"] },
    );

    expect(diagnostics).toEqual([]);
  });

  it("resolves missing view references for create-view code actions", () => {
    expect(
      missingLaravelViewReferenceAt(
        "@include('partials.card')",
        "@include('partials.".length,
        "blade",
        ["dashboard"],
      ),
    ).toEqual({
      name: "partials.card",
      relativePath: "resources/views/partials/card.blade.php",
    });

    expect(
      missingLaravelViewReferenceAt(
        "<?php view('dashboard');",
        "<?php view('dash".length,
        "php",
        ["dashboard"],
      ),
    ).toBeNull();
  });
});
