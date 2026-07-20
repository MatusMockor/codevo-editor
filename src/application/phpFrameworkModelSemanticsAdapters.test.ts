import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { phpFrameworkModelSourceSemanticsAdapter } from "./phpFrameworkModelSemanticsAdapters";

const APPLICATION_ROOT = fileURLToPath(new URL("./", import.meta.url));
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

const MORPH_MAP_SOURCE = `<?php
namespace App\\Providers;

use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'post' => Post::class,
        ]);
    }
}
`;

const EXPLICIT_TABLE_CANDIDATE = {
  className: "App\\Models\\Account",
  path: "/workspace/app/Models/Account.php",
  position: { column: 1, lineNumber: 3 },
  source: `<?php
namespace App\\Models;
class Account extends Model
{
    protected $table = 'users';
}
`,
};

describe("phpFrameworkModelSourceSemanticsAdapter", () => {
  it("resolves morph map entries through the Laravel adapter when eloquent model semantics are supported", () => {
    const adapter = phpFrameworkModelSourceSemanticsAdapter(LARAVEL_RUNTIME);

    expect(adapter.morphMapEntriesFromSource(MORPH_MAP_SOURCE)).toEqual([
      { alias: "post", modelClassName: "App\\Models\\Post" },
    ]);
  });

  it("resolves model sources for a table name through the Laravel adapter", () => {
    const adapter = phpFrameworkModelSourceSemanticsAdapter(LARAVEL_RUNTIME);

    expect(
      adapter.modelSourcesForTableName("users", [EXPLICIT_TABLE_CANDIDATE]),
    ).toEqual([EXPLICIT_TABLE_CANDIDATE]);
  });

  it("returns empty results when no provider supports eloquent model semantics", () => {
    const adapter = phpFrameworkModelSourceSemanticsAdapter(GENERIC_RUNTIME);

    expect(adapter.morphMapEntriesFromSource(MORPH_MAP_SOURCE)).toEqual([]);
    expect(
      adapter.modelSourcesForTableName("users", [EXPLICIT_TABLE_CANDIDATE]),
    ).toEqual([]);
  });
});

describe("generic model hooks stay framework neutral", () => {
  const genericHookFiles = [
    "usePhpFrameworkModelSemantics.ts",
    "usePhpFrameworkModelNavigationTargets.ts",
    "usePhpFrameworkMorphMapResolver.ts",
  ];

  it.each(genericHookFiles)(
    "%s does not import the Laravel domain module or Laravel hooks",
    (fileName) => {
      const source = readFileSync(join(APPLICATION_ROOT, fileName), "utf8");

      expect(source).not.toMatch(/from\s+"\.\.\/domain\/phpFrameworkLaravel"/);
      expect(source).not.toMatch(/from\s+"\.\/usePhpLaravel[A-Za-z]*"/);
    },
  );

  it("keeps the public model semantics contract free of Laravel-named members", () => {
    const source = readFileSync(
      join(APPLICATION_ROOT, "usePhpFrameworkModelSemantics.ts"),
      "utf8",
    );
    const contract = /export interface PhpFrameworkModelSemantics \{[\s\S]*?\n\}/.exec(
      source,
    );

    expect(contract).not.toBeNull();
    expect(contract?.[0]).not.toMatch(/Eloquent|Laravel/);
  });
});
