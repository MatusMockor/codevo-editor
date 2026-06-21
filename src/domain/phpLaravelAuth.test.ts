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
      ["$request->user('admin')", "request()->user"],
      ["$request->user(guard: 'admin')", "request()->user"],
      ["request()->user('admin')", "request()->user"],
      ["request()->user(guard: 'admin')", "request()->user"],
      ["Route::middleware('auth:admin')", "Route::middleware(auth)"],
      ["Route::middleware('guest:admin')", "Route::middleware(guest)"],
      [
        "Route::get('/secure')->middleware('auth:admin')",
        "Route::middleware(auth)",
      ],
      ["Route::middleware(['auth:admin'])", "Route::middleware(auth)"],
      ["Route::middleware(['auth:web,admin'])", "Route::middleware(auth)"],
      ["#[Auth('admin')]\nclass Controller {}", "#[Auth]"],
      [
        "#[\\Illuminate\\Container\\Attributes\\Auth(guard: 'admin')]\nclass Controller {}",
        "#[Auth]",
      ],
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
    const routeMiddlewareWithoutGuard = `<?php\n\nRoute::get('/admin')->middleware('auth');\n`;
    const invalidRouteMiddlewareGuard = `<?php\n\nRoute::get('/admin')->middleware('auth:admin/web');\n`;
    const genericRouteMiddleware = `<?php\n\n$router->middleware('auth:admin');\n`;
    const interpolated = `<?php\n\nAuth::guard("ad$min");\n`;
    const invalid = `<?php\n\nAuth::guard('admin/web');\n`;
    const wrongFacade = `<?php\n\nCache::store('admin');\n`;
    const wrongHelperMember = `<?php\n\n$manager->auth('admin');\n`;
    const genericUserMember = `<?php\n\n$userRepository->user('admin');\n`;
    const wrongRequestUserArgument = `<?php\n\n$request->user(name: 'admin');\n`;
    const wrongAttributeArgument = `<?php\n\n#[Auth(name: 'admin')]\nclass Controller {}\n`;
    const nestedAttributeCall = `<?php\n\n#[Example(Auth('admin'))]\nclass Controller {}\n`;

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
        routeMiddlewareWithoutGuard,
        positionAfter(routeMiddlewareWithoutGuard, "auth"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        invalidRouteMiddlewareGuard,
        positionAfter(invalidRouteMiddlewareGuard, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        genericRouteMiddleware,
        positionAfter(genericRouteMiddleware, "admin"),
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
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        genericUserMember,
        positionAfter(genericUserMember, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongRequestUserArgument,
        positionAfter(wrongRequestUserArgument, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        wrongAttributeArgument,
        positionAfter(wrongAttributeArgument, "admin"),
      ),
    ).toBeNull();
    expect(
      phpLaravelAuthGuardReferenceContextAt(
        nestedAttributeCall,
        positionAfter(nestedAttributeCall, "admin"),
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
