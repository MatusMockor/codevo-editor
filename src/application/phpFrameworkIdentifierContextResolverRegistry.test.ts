import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  resolvePhpIdentifierContextAt,
  type PhpFrameworkIdentifierContextContribution,
} from "./phpFrameworkIdentifierContextResolverRegistry";

const POSITION = { column: 4, lineNumber: 1 };

function provider(id: string): PhpFrameworkProvider {
  return { id };
}

describe("phpFrameworkIdentifierContextResolverRegistry", () => {
  it("keeps Laravel classification ahead of core PHP when Laravel is active", () => {
    const source = "Route::get('/', [ReportController::class, 'show']);";

    expect(
      resolvePhpIdentifierContextAt(
        source,
        { column: source.indexOf("show") + 4, lineNumber: 1 },
        [provider("laravel")],
      ),
    ).toEqual({
      className: "ReportController",
      kind: "laravelRouteActionMethod",
      methodName: "show",
    });
  });

  it.each([
    { label: "generic", providers: [] },
    { label: "Nette-only", providers: [provider("nette")] },
  ])(
    "does not invoke Laravel classification for $label providers",
    ({ providers }) => {
      const classify = vi.fn<() => PhpIdentifierContext | null>(() => ({
        kind: "laravelNamedRouteString",
        routeName: "dashboard",
      }));
      const registry: readonly PhpFrameworkIdentifierContextContribution[] = [
        { classify, providerId: "laravel" },
      ];

      expect(
        resolvePhpIdentifierContextAt(
          "DashboardService",
          POSITION,
          providers,
          registry,
        ),
      ).toEqual({ kind: "classIdentifier", name: "DashboardService" });
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("preserves contribution registry order with multiple active providers", () => {
    const firstContext: PhpIdentifierContext = {
      kind: "classIdentifier",
      name: "FirstProvider",
    };
    const first = vi.fn(() => firstContext);
    const second = vi.fn<() => PhpIdentifierContext | null>(() => ({
      kind: "classIdentifier",
      name: "SecondProvider",
    }));
    const registry: readonly PhpFrameworkIdentifierContextContribution[] = [
      { classify: first, providerId: "first" },
      { classify: second, providerId: "second" },
    ];

    expect(
      resolvePhpIdentifierContextAt(
        "Ignored",
        POSITION,
        [provider("second"), provider("first")],
        registry,
      ),
    ).toBe(firstContext);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("falls through not-applicable framework classifiers to core PHP", () => {
    const classify = vi.fn(() => null);

    expect(
      resolvePhpIdentifierContextAt(
        "$service->run()",
        { column: 13, lineNumber: 1 },
        [provider("custom")],
        [{ classify, providerId: "custom" }],
      ),
    ).toEqual({
      kind: "methodCall",
      methodName: "run",
      receiverExpression: "$service",
      variableName: "service",
    });
    expect(classify).toHaveBeenCalledOnce();
  });
});
