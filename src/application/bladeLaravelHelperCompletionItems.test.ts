import { describe, expect, it, vi } from "vitest";
import {
  bladeLaravelHelperNameCompletions,
  provideBladeLaravelHelperCompletionItems,
} from "./bladeLaravelHelperCompletionItems";

describe("blade Laravel helper completion items", () => {
  it("filters helper-name completions by prefix", () => {
    expect(
      bladeLaravelHelperNameCompletions("ro", {
        replaceEnd: 10,
        replaceStart: 8,
      }),
    ).toEqual([
      expect.objectContaining({
        insertText: "route()",
        kind: "helper",
        label: "route",
      }),
    ]);
  });

  it("uses route-relative insert text for dotted prefixes", async () => {
    const completions = await provideBladeLaravelHelperCompletionItems(
      { kind: "route", prefix: "admin." },
      20,
      {
        collectPhpLaravelConfigTargets: vi.fn(async () => []),
        collectPhpLaravelNamedRouteTargets: vi.fn(async () => [
          {
            name: "admin.users.index",
            relativePath: "routes/web.php",
          },
        ]),
        collectPhpLaravelTranslationTargets: vi.fn(async () => []),
        currentDocumentContent: "{{ route('admin.') }}",
        currentDocumentPath: "/workspace/resources/views/users.blade.php",
        isRequestedRootActive: () => true,
      },
    );

    expect(completions).toEqual([
      expect.objectContaining({
        insertText: "users.index",
        kind: "helper",
        label: "admin.users.index",
      }),
    ]);
  });

  it("drops async helper results after the requested root becomes stale", async () => {
    const completions = await provideBladeLaravelHelperCompletionItems(
      { kind: "config", prefix: "app" },
      10,
      {
        collectPhpLaravelConfigTargets: vi.fn(async () => [
          {
            key: "app.name",
            path: "/workspace/config/app.php",
            position: { column: 10, lineNumber: 1 },
            relativePath: "config/app.php",
          },
        ]),
        collectPhpLaravelNamedRouteTargets: vi.fn(async () => []),
        collectPhpLaravelTranslationTargets: vi.fn(async () => []),
        currentDocumentContent: "",
        currentDocumentPath: "",
        isRequestedRootActive: () => false,
      },
    );

    expect(completions).toEqual([]);
  });
});
