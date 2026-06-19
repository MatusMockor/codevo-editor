import { describe, expect, it } from "vitest";
import {
  isKnownPhpFrameworkStaticMethod,
  phpFrameworkProviderSignature,
  phpFrameworkMemberCompletionsFromSource,
  phpFrameworkProvidersForProject,
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";
import type { PhpProjectDescriptor } from "./workspace";

describe("phpFrameworkProviders", () => {
  it("exposes Laravel model attributes and relations through the framework seam", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class);
    }
}
`;

    expect(
      phpFrameworkMemberCompletionsFromSource(source, "Comment", [
        phpLaravelFrameworkProvider,
      ]),
    ).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "is_pinned",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("does not expose Laravel model attributes without the Laravel provider", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];
}
`;

    expect(phpFrameworkMemberCompletionsFromSource(source, "Comment", [])).toEqual(
      [],
    );
  });

  it("recognizes Laravel static builder methods only through the Laravel provider", () => {
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Album", "withRelations", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Album", "withRelations", []),
    ).toBe(false);
  });

  it("supports framework-specific providers without changing the core parser", () => {
    const netteProvider: PhpFrameworkProvider = {
      id: "nette",
      completions: {
        memberCompletionsFromSource: ({ declaringClassName }) => [
          {
            declaringClassName,
            kind: "property",
            name: "presenter",
            parameters: "",
            returnType: "Nette\\Application\\UI\\Presenter",
          },
        ],
      },
      diagnostics: {
        isKnownStaticMethod: ({ methodName }) => methodName === "whereMagic",
      },
    };

    expect(
      phpFrameworkMemberCompletionsFromSource("<?php", "Article", [
        netteProvider,
      ]),
    ).toEqual([
      {
        declaringClassName: "Article",
        kind: "property",
        name: "presenter",
        parameters: "",
        returnType: "Nette\\Application\\UI\\Presenter",
      },
    ]);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMagic", [
        netteProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMissing", [
        netteProvider,
      ]),
    ).toBe(false);
  });

  it("activates Laravel provider only for Laravel Composer projects", () => {
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "laravel/laravel",
          packages: [],
        }),
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "custom/api",
          packages: [{ name: "laravel/framework" }],
        }),
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "symfony/app",
          packages: [{ name: "symfony/framework-bundle" }],
        }),
      ),
    ).toEqual([]);
  });

  it("builds stable provider signatures for member caches", () => {
    expect(phpFrameworkProviderSignature([])).toBe("");
    expect(phpFrameworkProviderSignature([phpLaravelFrameworkProvider])).toBe(
      "laravel",
    );
  });
});

function phpProjectDescriptor(
  overrides: Omit<Partial<PhpProjectDescriptor>, "packages"> & {
    packages?: Array<{ name: string }>;
  } = {},
): PhpProjectDescriptor {
  const { packages = [], ...descriptorOverrides } = overrides;

  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: packages.map((composerPackage) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name: composerPackage.name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
    ...descriptorOverrides,
  };
}
