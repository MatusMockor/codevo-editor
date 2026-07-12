import { describe, expect, it } from "vitest";
import {
  bladeReferenceCandidateWorkspacePaths,
  detectBladeReferenceAt,
} from "./bladeNavigation";
import { phpLaravelFrameworkProvider } from "./phpFrameworkLaravelProvider";
import {
  isValidLaravelLivewireComponentName,
  phpLaravelLivewireCandidateRelativePaths,
  phpLaravelLivewireStudlySegment,
} from "./phpLaravelLivewire";

describe("phpLaravelLivewire", () => {
  it("validates simple, dashed, and dotted nested component names", () => {
    expect(isValidLaravelLivewireComponentName("counter")).toBe(true);
    expect(isValidLaravelLivewireComponentName("user-profile")).toBe(true);
    expect(isValidLaravelLivewireComponentName("admin.user-profile")).toBe(true);
  });

  it("rejects invalid characters and empty component names", () => {
    expect(isValidLaravelLivewireComponentName("user profile")).toBe(false);
    expect(isValidLaravelLivewireComponentName("admin/user-profile")).toBe(false);
    expect(isValidLaravelLivewireComponentName("UserProfile")).toBe(false);
    expect(isValidLaravelLivewireComponentName(".counter")).toBe(false);
    expect(isValidLaravelLivewireComponentName("counter.")).toBe(false);
    expect(isValidLaravelLivewireComponentName("")).toBe(false);
  });

  it("converts kebab-case segments to StudlyCase", () => {
    expect(phpLaravelLivewireStudlySegment("counter")).toBe("Counter");
    expect(phpLaravelLivewireStudlySegment("user-profile")).toBe("UserProfile");
  });

  it("generates new and legacy class candidates in probe order", () => {
    expect(
      phpLaravelLivewireCandidateRelativePaths("admin.user-profile"),
    ).toEqual([
      "app/Livewire/Admin/UserProfile.php",
      "app/Http/Livewire/Admin/UserProfile.php",
    ]);
  });

  it("returns no class candidates for an invalid name", () => {
    expect(phpLaravelLivewireCandidateRelativePaths("admin/UserProfile")).toEqual(
      [],
    );
  });

  it("detects and resolves an @livewire literal through the Laravel provider", () => {
    const source = "@livewire('admin.user-profile')";
    const reference = detectBladeReferenceAt(
      source,
      source.indexOf("admin.user-profile") + 2,
    );

    expect(reference).toMatchObject({
      kind: "livewire",
      name: "admin.user-profile",
    });
    expect(
      phpLaravelFrameworkProvider.livewire?.resolveLiteralTarget?.({
        literal: reference?.name ?? "",
      }),
    ).toEqual({
      relativeFilePaths: [
        "app/Livewire/Admin/UserProfile.php",
        "app/Http/Livewire/Admin/UserProfile.php",
      ],
    });
  });

  it("detects self-closing Livewire tags and tags with attributes", () => {
    const selfClosing = "<livewire:counter />";
    const withAttributes =
      "<livewire:admin.user-profile :user=\"$user\">";
    const nestedReference = detectBladeReferenceAt(
      withAttributes,
      withAttributes.indexOf("admin.user-profile") + 2,
    );

    expect(
      detectBladeReferenceAt(selfClosing, selfClosing.indexOf("counter") + 2),
    ).toMatchObject({ kind: "livewire", name: "counter" });
    expect(nestedReference).toMatchObject({
      kind: "livewire",
      name: "admin.user-profile",
    });
    expect(
      nestedReference
        ? bladeReferenceCandidateWorkspacePaths("/workspace", nestedReference)
        : [],
    ).toEqual([
      {
        path: "/workspace/app/Livewire/Admin/UserProfile.php",
        relativePath: "app/Livewire/Admin/UserProfile.php",
      },
      {
        path: "/workspace/app/Http/Livewire/Admin/UserProfile.php",
        relativePath: "app/Http/Livewire/Admin/UserProfile.php",
      },
    ]);
  });

  it("does not detect a Livewire tag inside a Blade comment", () => {
    const source = "{{-- <livewire:counter /> --}}";

    expect(
      detectBladeReferenceAt(source, source.indexOf("counter") + 2),
    ).toBeNull();
  });
});
