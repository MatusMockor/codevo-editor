import { describe, expect, it } from "vitest";
import {
  isUsableLaravelAuthGuardName,
  phpLaravelAuthGuardCompletionInsertText,
  phpLaravelAuthGuardConfigKey,
  phpLaravelAuthGuardNameFromConfigKey,
  phpLaravelAuthGuardReferenceContextAt,
} from "./phpLaravelAuth";

describe("phpLaravelAuth", () => {
  it("detects supported Laravel Auth guard strings", () => {
    const samples = [
      ["Auth::guard('admin')", "Auth::guard"],
      ["Auth::shouldUse('admin')", "Auth::shouldUse"],
      ["Auth::setDefaultDriver('admin')", "Auth::setDefaultDriver"],
      ["Auth::guard(name: 'admin')", "Auth::guard"],
      ["Auth::shouldUse(name: 'admin')", "Auth::shouldUse"],
      ["Auth::setDefaultDriver(name: 'admin')", "Auth::setDefaultDriver"],
      ["auth('admin')", "auth"],
      ["auth(guard: 'admin')", "auth"],
      ["auth()->guard('admin')", "auth()->guard"],
      ["auth()->guard(name: 'admin')", "auth()->guard"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelAuthGuardReferenceContextAt(
          source,
          positionAfter(source, "admin"),
        ),
      ).toMatchObject({
        call,
        guardName: "admin",
        prefix: "admin",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-auth calls", () => {
    const secondArgument = `<?php\n\nAuth::guard(null, 'admin');\n`;
    const wrongStaticArgument = `<?php\n\nAuth::guard(guard: 'admin');\n`;
    const wrongHelperArgument = `<?php\n\nauth(name: 'admin');\n`;
    const customDriver = `<?php\n\nAuth::viaRequest('admin', fn () => null);\n`;
    const routeMiddleware = `<?php\n\nRoute::get('/admin')->middleware('auth:admin');\n`;
    const interpolated = `<?php\n\nAuth::guard("ad$min");\n`;
    const invalid = `<?php\n\nAuth::guard('admin/web');\n`;
    const wrongFacade = `<?php\n\nCache::store('admin');\n`;
    const wrongHelperMember = `<?php\n\n$manager->auth('admin');\n`;

    expect(
      phpLaravelAuthGuardReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongStaticArgument,
        positionAfter(wrongStaticArgument, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongHelperArgument,
        positionAfter(wrongHelperArgument, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        customDriver,
        positionAfter(customDriver, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        routeMiddleware,
        positionAfter(routeMiddleware, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "ad"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        invalid,
        positionAfter(invalid, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongFacade,
        positionAfter(wrongFacade, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongHelperMember,
        positionAfter(wrongHelperMember, "admin"),
      ),
    ).toBeNull();
  });

  it("maps guard names to auth config keys", () => {
    expect(phpLaravelAuthGuardConfigKey("admin")).toBe("auth.guards.admin");
    expect(phpLaravelAuthGuardNameFromConfigKey("auth.guards.web")).toBe("web");
    expect(phpLaravelAuthGuardNameFromConfigKey("auth.guards.admin.driver")).toBe(
      null,
    );
    expect(phpLaravelAuthGuardNameFromConfigKey("auth.providers.users")).toBe(
      null,
    );
    expect(isUsableLaravelAuthGuardName("admin-web")).toBe(true);
    expect(isUsableLaravelAuthGuardName("admin/web")).toBe(false);
  });

  it("uses whole guard-name insert text", () => {
    expect(phpLaravelAuthGuardCompletionInsertText("admin")).toBe("admin");
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
