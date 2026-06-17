import { describe, expect, it } from "vitest";
import {
  phpClassPathCandidates,
  phpIdentifierContextAt,
  phpLaravelRequestMethodDefinition,
  phpMethodPosition,
  phpNamedTypePosition,
  phpParameterTypeForVariable,
  resolvePhpClassName,
} from "./phpNavigation";
import type { PhpProjectDescriptor } from "./workspace";

describe("phpNavigation", () => {
  const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;
use Illuminate\\Foundation\\Http\\FormRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->input('originalComment', '');
    }
}
`;

  it("detects a PHP method call under the cursor", () => {
    expect(
      phpIdentifierContextAt(controllerSource, {
        column: 20,
        lineNumber: 11,
      }),
    ).toEqual({
      kind: "methodCall",
      methodName: "input",
      variableName: "request",
    });
  });

  it("detects Laravel route action strings as controller methods", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;
use App\\Http\\Controllers\\communication\\ReactionController;

Route::post('/comments', [CommentController::class, 'store']);
Route::post('/reactions', [ReactionController::class, 'store']);
`;

    expect(
      phpIdentifierContextAt(routeSource, {
        column: 54,
        lineNumber: 5,
      }),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "store",
    });
  });

  it("resolves imports and typed request parameters", () => {
    expect(resolvePhpClassName(controllerSource, "StoreCommentRequest")).toBe(
      "App\\Http\\Request\\AiHub\\StoreCommentRequest",
    );
    expect(resolvePhpClassName(controllerSource, "FormRequest")).toBe(
      "Illuminate\\Foundation\\Http\\FormRequest",
    );
    expect(
      phpParameterTypeForVariable(
        controllerSource,
        {
          column: 20,
          lineNumber: 11,
        },
        "request",
      ),
    ).toBe("StoreCommentRequest");
  });

  it("maps Composer PSR-4 roots to project and vendor class files", () => {
    expect(
      phpClassPathCandidates(
        "/workspace",
        phpProjectDescriptor(),
        "App\\Http\\Request\\AiHub\\StoreCommentRequest",
      ),
    ).toContain("/workspace/app/Http/Request/AiHub/StoreCommentRequest.php");
    expect(
      phpClassPathCandidates(
        "/workspace",
        phpProjectDescriptor(),
        "Illuminate\\Foundation\\Http\\FormRequest",
      ),
    ).toContain(
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php",
    );
  });

  it("maps Laravel request helper methods to their trait definitions", () => {
    expect(
      phpLaravelRequestMethodDefinition(
        "App\\Http\\Request\\AiHub\\StoreCommentRequest",
        "input",
      ),
    ).toEqual({
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName: "input",
    });
  });

  it("finds named type and method positions in source files", () => {
    expect(
      phpNamedTypePosition("<?php\nclass FormRequest {}\n", "FormRequest"),
    ).toEqual({
      column: 7,
      lineNumber: 2,
    });
    expect(
      phpMethodPosition(
        "<?php\ntrait InteractsWithInput {\n    public function input() {}\n}\n",
        "input",
      ),
    ).toEqual({
      column: 21,
      lineNumber: 3,
    });
  });
});

function phpProjectDescriptor(): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "laravel/laravel",
    packages: [
      {
        classmapRoots: [],
        dev: false,
        installPath: "../laravel/framework",
        name: "laravel/framework",
        packageType: "library",
        psr4Roots: [
          {
            dev: false,
            namespace: "Illuminate\\",
            paths: ["src/Illuminate/"],
          },
        ],
        version: "13.0.0",
      },
    ],
    psr4Roots: [
      {
        dev: false,
        namespace: "App\\",
        paths: ["app/"],
      },
    ],
  };
}
