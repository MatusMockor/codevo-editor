import { describe, expect, it } from "vitest";
import {
  detectLaravelRouteModelBindingAt,
  laravelRouteParameterModelShortName,
  phpModelNamespacePrefixes,
} from "./laravelRouteModelBinding";

function offsetInside(source: string, needle: string, within: string): number {
  const tokenStart = source.indexOf(within);

  if (tokenStart < 0) {
    throw new Error(`Missing token: ${within}`);
  }

  const relative = within.indexOf(needle);

  if (relative < 0) {
    throw new Error(`Missing needle ${needle} in ${within}`);
  }

  return tokenStart + relative + 1;
}

describe("laravelRouteParameterModelShortName", () => {
  it("studly-cases a singular parameter name", () => {
    expect(laravelRouteParameterModelShortName("user")).toBe("User");
  });

  it("keeps the plural form unchanged (Laravel does not singularise)", () => {
    expect(laravelRouteParameterModelShortName("users")).toBe("Users");
  });

  it("studly-cases a camelCase parameter name", () => {
    expect(laravelRouteParameterModelShortName("blogPost")).toBe("BlogPost");
  });

  it("studly-cases snake_case segments", () => {
    expect(laravelRouteParameterModelShortName("blog_post")).toBe("BlogPost");
  });

  it("returns null for empty or non-identifier names", () => {
    expect(laravelRouteParameterModelShortName("")).toBeNull();
    expect(laravelRouteParameterModelShortName("_")).toBeNull();
    expect(laravelRouteParameterModelShortName("123")).toBeNull();
  });
});

describe("phpModelNamespacePrefixes", () => {
  it("derives modern and legacy prefixes from the app PSR-4 root", () => {
    expect(
      phpModelNamespacePrefixes({
        psr4Roots: [{ namespace: "App\\", paths: ["app/"] }],
      }),
    ).toEqual(["App\\Models\\", "App\\"]);
  });

  it("honours a custom app root namespace", () => {
    expect(
      phpModelNamespacePrefixes({
        psr4Roots: [{ namespace: "Acme\\", paths: ["app/"] }],
      }),
    ).toEqual(["Acme\\Models\\", "Acme\\", "App\\Models\\", "App\\"]);
  });

  it("falls back to the Laravel defaults without an app PSR-4 root", () => {
    expect(phpModelNamespacePrefixes({ psr4Roots: [] })).toEqual([
      "App\\Models\\",
      "App\\",
    ]);
    expect(phpModelNamespacePrefixes(null)).toEqual(["App\\Models\\", "App\\"]);
  });
});

describe("detectLaravelRouteModelBindingAt", () => {
  it("detects a parameter inside a Route::get URI string", () => {
    const source = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "user", "{user}"),
    );

    expect(result).not.toBeNull();
    expect(result?.parameterName).toBe("user");
    expect(result?.modelShortName).toBe("User");
  });

  it("detects a camelCase parameter and studly-cases the model", () => {
    const source = `<?php
Route::get('/posts/{blogPost}', 'PostController@show');
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "blogPost", "{blogPost}"),
    );

    expect(result?.modelShortName).toBe("BlogPost");
  });

  it("strips the custom-key suffix and binds the parameter name", () => {
    const source = `<?php
Route::get('/users/{user:slug}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "user", "{user:slug}"),
    );

    expect(result?.parameterName).toBe("user");
    expect(result?.modelShortName).toBe("User");
  });

  it("strips the optional marker and binds the parameter name", () => {
    const source = `<?php
Route::get('/users/{user?}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "user", "{user?}"),
    );

    expect(result?.modelShortName).toBe("User");
  });

  it("detects parameters across multiple URI methods", () => {
    for (const method of ["post", "put", "patch", "delete", "any", "options"]) {
      const source = `<?php
Route::${method}('/users/{user}', [UserController::class, 'update']);
`;

      const result = detectLaravelRouteModelBindingAt(
        source,
        offsetInside(source, "user", "{user}"),
      );

      expect(result?.modelShortName).toBe("User");
    }
  });

  it("returns null when the cursor is on the static URI text, not the parameter", () => {
    const source = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "users", "/users/"),
    );

    expect(result).toBeNull();
  });

  it("returns null when the cursor sits on the custom-key field, not the name", () => {
    const source = `<?php
Route::get('/users/{user:slug}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "slug", "{user:slug}"),
    );

    expect(result).toBeNull();
  });

  it("returns null when the literal is not the first Route argument", () => {
    const source = `<?php
Route::get('/users', [UserController::class, 'index'])->name('{user}');
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "user", "{user}"),
    );

    expect(result).toBeNull();
  });

  it("returns null for non-Route calls containing a brace literal", () => {
    const source = `<?php
$value = config('/users/{user}');
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      offsetInside(source, "user", "{user}"),
    );

    expect(result).toBeNull();
  });

  it("returns null outside any string literal", () => {
    const source = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;

    const result = detectLaravelRouteModelBindingAt(
      source,
      source.indexOf("Route") + 1,
    );

    expect(result).toBeNull();
  });
});
