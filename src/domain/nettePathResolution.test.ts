import { describe, expect, it } from "vitest";
import {
  latteLayoutCandidatePaths,
  latteViewNameFromAction,
  presenterCandidatePathsForTemplate,
  presenterTemplateCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "./nettePathResolution";

describe("resolveLatteTemplateCandidatePaths", () => {
  it("resolves a same-directory include relative to the current template", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "menu.latte",
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/Product/menu.latte"]);
  });

  it("resolves a subdirectory include path", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "parts/menu.latte",
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/Product/parts/menu.latte"]);
  });

  it("resolves a parent-directory include with ..", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "../shared/menu.latte",
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/shared/menu.latte"]);
  });

  it("appends a .latte extension when the include omits it", () => {
    expect(
      resolveLatteTemplateCandidatePaths("menu", "app/UI/Product/show.latte"),
    ).toEqual(["app/UI/Product/menu.latte"]);
  });

  it("treats a leading slash as workspace-root relative", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "/app/UI/shared/menu.latte",
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/shared/menu.latte"]);
  });

  it("collapses redundant current-directory segments", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "./menu.latte",
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/Product/menu.latte"]);
  });

  it("returns no candidates when the include escapes the workspace root", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "../../../../etc/passwd.latte",
        "app/UI/show.latte",
      ),
    ).toEqual([]);
  });

  it("returns no candidates for a blank include", () => {
    expect(
      resolveLatteTemplateCandidatePaths("   ", "app/UI/show.latte"),
    ).toEqual([]);
  });

  it("returns no candidates for a namespaced include", () => {
    expect(
      resolveLatteTemplateCandidatePaths("pkg::menu.latte", "app/UI/show.latte"),
    ).toEqual([]);
  });

  it("normalizes backslashes in the current template path", () => {
    expect(
      resolveLatteTemplateCandidatePaths(
        "menu.latte",
        "app\\UI\\Product\\show.latte",
      ),
    ).toEqual(["app/UI/Product/menu.latte"]);
  });
});

describe("latteViewNameFromAction", () => {
  it("strips a render prefix and lowercases the first letter", () => {
    expect(latteViewNameFromAction("renderShow")).toBe("show");
  });

  it("strips an action prefix", () => {
    expect(latteViewNameFromAction("actionDefault")).toBe("default");
  });

  it("keeps a multi-word view name after the prefix", () => {
    expect(latteViewNameFromAction("renderProductList")).toBe("productList");
  });

  it("uses a bare view name unchanged", () => {
    expect(latteViewNameFromAction("show")).toBe("show");
  });

  it("does not strip a prefix that is not followed by an uppercase letter", () => {
    expect(latteViewNameFromAction("renderer")).toBe("renderer");
  });

  it("defaults to the default view for a blank action", () => {
    expect(latteViewNameFromAction("")).toBe("default");
    expect(latteViewNameFromAction("   ")).toBe("default");
  });
});

describe("presenterTemplateCandidatePaths", () => {
  it("maps a modern UI presenter to a sibling template and classic fallbacks", () => {
    expect(
      presenterTemplateCandidatePaths(
        "app/UI/Product/ProductPresenter.php",
        "renderShow",
      ),
    ).toEqual([
      "app/UI/Product/show.latte",
      "app/UI/Product/templates/Product/show.latte",
      "app/UI/Product/templates/Product.show.latte",
    ]);
  });

  it("maps a classic Presenters presenter to templates subfolder and dotted forms", () => {
    expect(
      presenterTemplateCandidatePaths(
        "app/Presenters/ProductPresenter.php",
        "renderShow",
      ),
    ).toEqual([
      "app/Presenters/show.latte",
      "app/Presenters/templates/Product/show.latte",
      "app/Presenters/templates/Product.show.latte",
    ]);
  });

  it("uses the default view when the action is blank", () => {
    expect(
      presenterTemplateCandidatePaths("app/UI/Home/HomePresenter.php", ""),
    ).toEqual([
      "app/UI/Home/default.latte",
      "app/UI/Home/templates/Home/default.latte",
      "app/UI/Home/templates/Home.default.latte",
    ]);
  });

  it("returns no candidates when the file is not a presenter class", () => {
    expect(
      presenterTemplateCandidatePaths("app/UI/Product/Helper.php", "renderShow"),
    ).toEqual([]);
  });

  it("returns no candidates for an unusable view name", () => {
    expect(
      presenterTemplateCandidatePaths(
        "app/UI/Product/ProductPresenter.php",
        "render Show",
      ),
    ).toEqual([]);
  });
});

describe("latteLayoutCandidatePaths", () => {
  it("walks up from a modern template directory to the workspace root", () => {
    expect(latteLayoutCandidatePaths("app/UI/Product/show.latte")).toEqual([
      "app/UI/Product/@layout.latte",
      "app/UI/@layout.latte",
      "app/@layout.latte",
      "@layout.latte",
    ]);
  });

  it("walks up from a classic templates subfolder", () => {
    expect(
      latteLayoutCandidatePaths("app/Presenters/templates/Product/show.latte"),
    ).toEqual([
      "app/Presenters/templates/Product/@layout.latte",
      "app/Presenters/templates/@layout.latte",
      "app/Presenters/@layout.latte",
      "app/@layout.latte",
      "@layout.latte",
    ]);
  });

  it("returns a single root candidate for a top-level template", () => {
    expect(latteLayoutCandidatePaths("show.latte")).toEqual(["@layout.latte"]);
  });

  it("returns no candidates for a blank template path", () => {
    expect(latteLayoutCandidatePaths("   ")).toEqual([]);
  });
});

describe("presenterCandidatePathsForTemplate", () => {
  it("maps a modern sibling template back to its presenter", () => {
    expect(
      presenterCandidatePathsForTemplate("app/UI/Product/show.latte"),
    ).toContain("app/UI/Product/ProductPresenter.php");
  });

  it("maps a classic subfolder template back to its presenter", () => {
    expect(
      presenterCandidatePathsForTemplate(
        "app/Presenters/templates/Product/show.latte",
      ),
    ).toContain("app/Presenters/ProductPresenter.php");
  });

  it("maps a classic module partial back to its presenter", () => {
    expect(
      presenterCandidatePathsForTemplate(
        "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
      ),
    ).toEqual([
      "app/modules/efabricaSubscriptionsModule/presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/PartialsPresenter.php",
    ]);
  });

  it("maps a classic dotted template back to its presenter", () => {
    expect(
      presenterCandidatePathsForTemplate(
        "app/Presenters/templates/Product.show.latte",
      ),
    ).toContain("app/Presenters/ProductPresenter.php");
  });

  it("does not offer a dead TemplatesPresenter as the first candidate for a classic dotted template (F8)", () => {
    const candidates = presenterCandidatePathsForTemplate(
      "app/Presenters/templates/Product.show.latte",
    );

    expect(candidates).not.toContain(
      "app/Presenters/templates/TemplatesPresenter.php",
    );
    expect(candidates[0]).toBe("app/Presenters/ProductPresenter.php");
  });

  it("returns no candidates for a non-latte file", () => {
    expect(presenterCandidatePathsForTemplate("app/UI/Product/show.php")).toEqual(
      [],
    );
  });

  it("returns no candidates for a blank path", () => {
    expect(presenterCandidatePathsForTemplate("")).toEqual([]);
  });
});
