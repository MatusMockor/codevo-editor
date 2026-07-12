import { describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import { navigateToArtisanController } from "./artisanRouteNavigation";

function methodSymbol(
  path: string,
  containerName = "App\\Http\\Controllers\\UserController",
): ProjectSymbolSearchResult {
  return {
    column: 7,
    containerName,
    fullyQualifiedName: `${containerName}\\show`,
    kind: "method",
    lineNumber: 23,
    name: "show",
    path,
    relativePath: path.replace("/workspace/", ""),
  };
}

describe("navigateToArtisanController", () => {
  it("opens the best indexed method in the requested controller", async () => {
    const searchProjectSymbols = vi.fn(async () => [
      methodSymbol("/workspace/active.php"),
      methodSymbol("/workspace/UserController.php"),
      methodSymbol(
        "/workspace/OtherController.php",
        "App\\Http\\Controllers\\OtherController",
      ),
    ]);
    const openNavigationTarget = vi.fn(async () => true);

    const opened = await navigateToArtisanController(
      {
        activePath: "/workspace/active.php",
        currentRootPath: () => "/workspace",
        openNavigationTarget,
        projectSymbolSearch: { searchProjectSymbols },
        rootPath: "/workspace",
        setMessage: vi.fn(),
      },
      {
        className: "App\\Http\\Controllers\\UserController",
        methodName: "show",
      },
    );

    expect(opened).toBe(true);
    expect(searchProjectSymbols).toHaveBeenCalledExactlyOnceWith(
      "/workspace",
      "show",
      50,
    );
    expect(openNavigationTarget).toHaveBeenCalledExactlyOnceWith(
      "/workspace/UserController.php",
      { column: 7, lineNumber: 23 },
      "show()",
    );
  });

  it("drops symbol results after the workspace root changes", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();

    const opened = await navigateToArtisanController(
      {
        activePath: "",
        currentRootPath: () => "/other",
        openNavigationTarget,
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async () => [
            methodSymbol("/workspace/UserController.php"),
          ]),
        },
        rootPath: "/workspace",
        setMessage,
      },
      {
        className: "App\\Http\\Controllers\\UserController",
        methodName: "show",
      },
    );

    expect(opened).toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
  });

  it("surfaces a missing indexed method", async () => {
    const setMessage = vi.fn();

    const opened = await navigateToArtisanController(
      {
        activePath: "",
        currentRootPath: () => "/workspace",
        openNavigationTarget: vi.fn(async () => true),
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async () => []),
        },
        rootPath: "/workspace",
        setMessage,
      },
      {
        className: "App\\Http\\Controllers\\UserController",
        methodName: "show",
      },
    );

    expect(opened).toBe(false);
    expect(setMessage).toHaveBeenCalledExactlyOnceWith(
      "Route target App\\Http\\Controllers\\UserController@show was not indexed.",
    );
  });
});
