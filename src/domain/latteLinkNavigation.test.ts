import { describe, expect, it } from "vitest";
import {
  detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  netteRoutePresenterTargetsFromSource,
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  nettePresenterLinkCompletionContextAt,
  parseNetteLinkTarget,
} from "./latteLinkNavigation";
import type { NetteLinkTarget } from "./latteLinkNavigation";

/**
 * Offset of the FIRST occurrence of `needle`, advanced by `withinOffset`, so a
 * test can point at a precise cursor position.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

describe("parseNetteLinkTarget", () => {
  it("parses a bare relative action as same-presenter", () => {
    expect(parseNetteLinkTarget("show")).toEqual({
      absolute: false,
      action: "show",
      isSignal: false,
      module: null,
      presenter: null,
    });
  });

  it("parses Presenter:action", () => {
    expect(parseNetteLinkTarget("Product:show")).toEqual({
      absolute: false,
      action: "show",
      isSignal: false,
      module: null,
      presenter: "Product",
    });
  });

  it("defaults an empty action (Presenter:) to `default`", () => {
    expect(parseNetteLinkTarget("Product:")).toEqual({
      absolute: false,
      action: "default",
      isSignal: false,
      module: null,
      presenter: "Product",
    });
  });

  it("parses an absolute target with a module", () => {
    expect(parseNetteLinkTarget(":Admin:Product:show")).toEqual({
      absolute: true,
      action: "show",
      isSignal: false,
      module: "Admin",
      presenter: "Product",
    });
  });

  it("parses an absolute target with a nested module path", () => {
    expect(parseNetteLinkTarget(":Admin:Sales:Product:edit")).toEqual({
      absolute: true,
      action: "edit",
      isSignal: false,
      module: "Admin:Sales",
      presenter: "Product",
    });
  });

  it("parses an absolute target with a default action", () => {
    expect(parseNetteLinkTarget(":Front:Homepage:")).toEqual({
      absolute: true,
      action: "default",
      isSignal: false,
      module: "Front",
      presenter: "Homepage",
    });
  });

  it("treats `this` as the current-action marker", () => {
    expect(parseNetteLinkTarget("this")).toEqual({
      absolute: false,
      action: "this",
      isSignal: false,
      module: null,
      presenter: null,
    });
  });

  it("parses a bare signal target (delete!)", () => {
    expect(parseNetteLinkTarget("delete!")).toEqual({
      absolute: false,
      action: "delete",
      isSignal: true,
      module: null,
      presenter: null,
    });
  });

  it("parses a Presenter:signal! target", () => {
    expect(parseNetteLinkTarget("Product:delete!")).toEqual({
      absolute: false,
      action: "delete",
      isSignal: true,
      module: null,
      presenter: "Product",
    });
  });

  it("strips a #fragment from the destination", () => {
    expect(parseNetteLinkTarget("Product:show#reviews")).toEqual({
      absolute: false,
      action: "show",
      isSignal: false,
      module: null,
      presenter: "Product",
    });
  });

  it("strips a leading // absolute-URL marker", () => {
    expect(parseNetteLinkTarget("//Product:show")?.presenter).toBe("Product");
  });

  it("returns null for a dynamic ($var) target", () => {
    expect(parseNetteLinkTarget("$dest")).toBeNull();
    expect(parseNetteLinkTarget("Product:$action")).toBeNull();
  });

  it("returns null for an expression target", () => {
    expect(parseNetteLinkTarget("getLink()")).toBeNull();
    expect(parseNetteLinkTarget("$cond ? 'A:b' : 'C:d'")).toBeNull();
  });

  it("returns null for an empty / whitespace target", () => {
    expect(parseNetteLinkTarget("")).toBeNull();
    expect(parseNetteLinkTarget("   ")).toBeNull();
  });

  it("returns null for an absolute target with no presenter", () => {
    expect(parseNetteLinkTarget(":show")).toBeNull();
  });

  it("returns null for an empty presenter segment", () => {
    expect(parseNetteLinkTarget("Admin::show")).toBeNull();
  });

  it("returns null for an invalid action identifier", () => {
    expect(parseNetteLinkTarget("Product:sh-ow")).toBeNull();
  });
});

describe("nettePresenterActionMethodCandidates", () => {
  it("offers action* before render* for a normal action", () => {
    expect(nettePresenterActionMethodCandidates("show", false)).toEqual([
      "actionShow",
      "renderShow",
    ]);
  });

  it("offers a handle* method for a signal", () => {
    expect(nettePresenterActionMethodCandidates("delete", true)).toEqual([
      "handleDelete",
    ]);
  });

  it("handles the default action", () => {
    expect(nettePresenterActionMethodCandidates("default", false)).toEqual([
      "actionDefault",
      "renderDefault",
    ]);
  });

  it("preserves camel-case action names such as showBasic", () => {
    expect(nettePresenterActionMethodCandidates("showBasic", false)).toEqual([
      "actionShowBasic",
      "renderShowBasic",
    ]);
  });

  it("returns no candidates for the `this` marker", () => {
    expect(nettePresenterActionMethodCandidates("this", false)).toEqual([]);
  });

  it("returns no candidates for a blank action", () => {
    expect(nettePresenterActionMethodCandidates("", false)).toEqual([]);
  });
});

describe("nettePresenterClassCandidatePathsForLink", () => {
  const target = (over: Partial<NetteLinkTarget>): NetteLinkTarget => ({
    absolute: false,
    action: "show",
    isSignal: false,
    module: null,
    presenter: "Product",
    ...over,
  });

  it("maps a target to both conventions, modern first, from a modern template", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({}),
        "app/UI/Home/default.latte",
      ),
    ).toEqual([
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });

  it("orders classic first when the current file is classic", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({}),
        "app/Presenters/HomePresenter.php",
      ),
    ).toEqual([
      "app/Presenters/ProductPresenter.php",
      "app/UI/Product/ProductPresenter.php",
    ]);
  });

  it("maps a modular target to modern and classic module conventions", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ absolute: true, module: "Admin" }),
        "app/UI/Admin/Dashboard/default.latte",
      ),
    ).toEqual([
      "app/UI/Admin/Product/ProductPresenter.php",
      "app/AdminModule/presenters/ProductPresenter.php",
      "app/AdminModule/Presenters/ProductPresenter.php",
    ]);
  });

  it("resolves a relative target to the current presenter file", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ presenter: null }),
        "app/UI/Product/ProductPresenter.php",
      ),
    ).toEqual(["app/UI/Product/ProductPresenter.php"]);
  });

  it("resolves a relative target from the current template back to its presenter", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ presenter: null }),
        "app/UI/Product/show.latte",
      ),
    ).toEqual(["app/UI/Product/ProductPresenter.php"]);
  });

  it("resolves current-presenter shorthand from an ebox-style module presenter", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ action: "showBasic", presenter: null }),
        "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      ),
    ).toEqual([
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
    ]);
  });

  it("resolves a relative n:href action from a classic module partial to the current presenter", () => {
    const source = '<a n:href="default">Back</a>';
    const detection = detectLatteLinkAt(source, offsetOf(source, "default", 2));
    const parsed = parseNetteLinkTarget(detection?.target ?? "");

    expect(detection).toMatchObject({
      tag: "n:href",
      target: "default",
    });
    expect(parsed).toMatchObject({
      action: "default",
      isSignal: false,
      presenter: null,
    });
    expect(
      parsed &&
        nettePresenterClassCandidatePathsForLink(
          parsed,
          "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
        ),
    ).toEqual([
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/PartialsPresenter.php",
    ]);
  });

  it("keeps explicit presenter links inside the current classic module template base", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ action: "create", presenter: "ProductsAdmin" }),
        "app/modules/productsModule/templates/Home/default.latte",
      ),
    ).toEqual([
      "app/modules/productsModule/Presenters/ProductsAdminPresenter.php",
      "app/modules/productsModule/presenters/ProductsAdminPresenter.php",
      "app/modules/productsModule/ProductsAdminPresenter.php",
      "app/Presenters/ProductsAdminPresenter.php",
      "app/UI/ProductsAdmin/ProductsAdminPresenter.php",
    ]);
  });

  it("keeps explicit presenter links inside the current ebox-style module presenter base", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ action: "showBasic", presenter: "SubscriptionTypeGroupAdmin" }),
        "app/modules/efabricaSubscriptionsModule/Presenters/DashboardPresenter.php",
      ),
    ).toEqual([
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/modules/efabricaSubscriptionsModule/SubscriptionTypeGroupAdminPresenter.php",
      "app/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      "app/UI/SubscriptionTypeGroupAdmin/SubscriptionTypeGroupAdminPresenter.php",
    ]);
  });

  it("keeps relative target modules under the current ebox-style module presenter base", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: "Reports", presenter: "Overview" }),
        "app/modules/efabricaSubscriptionsModule/Presenters/DashboardPresenter.php",
      ),
    ).toEqual([
      "app/modules/efabricaSubscriptionsModule/ReportsModule/Presenters/OverviewPresenter.php",
      "app/modules/efabricaSubscriptionsModule/ReportsModule/presenters/OverviewPresenter.php",
      "app/modules/efabricaSubscriptionsModule/ReportsModule/OverviewPresenter.php",
      "app/ReportsModule/presenters/OverviewPresenter.php",
      "app/ReportsModule/Presenters/OverviewPresenter.php",
      "app/UI/Reports/Overview/OverviewPresenter.php",
    ]);
  });

  it("resolves absolute module links from ebox-style modules through app/modules/*Module", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({
          absolute: true,
          action: "Show",
          module: "Users",
          presenter: "UsersAdmin",
        }),
        "app/modules/profileModule/templates/ProfilesAdmin/update.latte",
      ),
    ).toEqual([
      "app/modules/usersModule/Presenters/UsersAdminPresenter.php",
      "app/modules/usersModule/presenters/UsersAdminPresenter.php",
      "app/modules/usersModule/UsersAdminPresenter.php",
      "app/UsersModule/presenters/UsersAdminPresenter.php",
      "app/UsersModule/Presenters/UsersAdminPresenter.php",
      "app/UI/Users/UsersAdmin/UsersAdminPresenter.php",
    ]);
  });

  it("does not treat an arbitrary templates directory as a classic module template base", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ presenter: "Product" }),
        "app/UI/Admin/templates/Home/default.latte",
      ),
    ).toEqual([
      "app/UI/Admin/Templates/Product/ProductPresenter.php",
      "app/AdminModule/TemplatesModule/presenters/ProductPresenter.php",
      "app/AdminModule/TemplatesModule/Presenters/ProductPresenter.php",
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });

  it("detects a non-standard app root from the current path", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({}),
        "src/UI/Home/default.latte",
      ),
    ).toEqual([
      "src/UI/Product/ProductPresenter.php",
      "src/Presenters/ProductPresenter.php",
    ]);
  });

  it("falls back to `app` when no convention marker is present", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(target({}), "weird/path.latte"),
    ).toEqual([
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });

  it("returns nothing for a relative target with an unusable current path", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ presenter: null }),
        "app/Model/Service.php",
      ),
    ).toEqual([]);
  });

  // Nette's Presenter::createRequest resolves a target WITHOUT a leading `:`
  // against the CURRENT module, not the app root. These cases pin that
  // module-aware resolution (module-aware candidate first, old/project-root
  // candidate kept after as a conservative fallback in case the path heuristic
  // misreads a non-modular project).
  it("prepends the current module to a relative target from a modern-module template", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: null }),
        "app/UI/Admin/Dashboard/default.latte",
      ),
    ).toEqual([
      "app/UI/Admin/Product/ProductPresenter.php",
      "app/AdminModule/presenters/ProductPresenter.php",
      "app/AdminModule/Presenters/ProductPresenter.php",
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });

  it("prepends the current module to a relative target from a classic-module presenter", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: null }),
        "app/AdminModule/presenters/DashboardPresenter.php",
      ),
    ).toEqual([
      "app/AdminModule/presenters/ProductPresenter.php",
      "app/AdminModule/Presenters/ProductPresenter.php",
      "app/UI/Admin/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
      "app/UI/Product/ProductPresenter.php",
    ]);
  });

  it("prepends the current module ahead of an explicit relative target module (Admin:Product from Front)", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: "Admin" }),
        "app/UI/Front/Dashboard/default.latte",
      ),
    ).toEqual([
      "app/UI/Front/Admin/Product/ProductPresenter.php",
      "app/FrontModule/AdminModule/presenters/ProductPresenter.php",
      "app/FrontModule/AdminModule/Presenters/ProductPresenter.php",
      "app/UI/Admin/Product/ProductPresenter.php",
      "app/AdminModule/presenters/ProductPresenter.php",
      "app/AdminModule/Presenters/ProductPresenter.php",
    ]);
  });

  it("does not prepend the current module to an absolute target (unchanged)", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ absolute: true, module: "Sales" }),
        "app/UI/Admin/Dashboard/default.latte",
      ),
    ).toEqual([
      "app/UI/Sales/Product/ProductPresenter.php",
      "app/SalesModule/presenters/ProductPresenter.php",
      "app/SalesModule/Presenters/ProductPresenter.php",
    ]);
  });

  it("keeps a nested current module together (Admin:Sales) when prepending", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: null }),
        "app/UI/Admin/Sales/Dashboard/default.latte",
      ),
    ).toEqual([
      "app/UI/Admin/Sales/Product/ProductPresenter.php",
      "app/AdminModule/SalesModule/presenters/ProductPresenter.php",
      "app/AdminModule/SalesModule/Presenters/ProductPresenter.php",
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });

  it("does not regress a non-modular project (no current module to prepend)", () => {
    expect(
      nettePresenterClassCandidatePathsForLink(
        target({ module: null }),
        "app/UI/Product/OtherPresenter.php",
      ),
    ).toEqual([
      "app/UI/Product/ProductPresenter.php",
      "app/Presenters/ProductPresenter.php",
    ]);
  });
});

describe("detectLatteLinkAt", () => {
  it("detects a {link Presenter:action} target", () => {
    const source = "<a n:href=x>{link Product:show}</a>";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toEqual({
      tag: "link",
      target: "Product:show",
      targetStart: source.indexOf("Product:show"),
      targetEnd: source.indexOf("Product:show") + "Product:show".length,
    });
  });

  it("detects a {plink} target", () => {
    const source = "{plink Product:show}";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)?.tag).toBe("plink");
    expect(detectLatteLinkAt(source, offset)?.target).toBe("Product:show");
  });

  it("takes only the first {link} argument, ignoring trailing args", () => {
    const source = "{link Product:show, $id, page => 2}";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)?.target).toBe("Product:show");
    expect(detectLatteLinkAt(source, offset)?.targetEnd).toBe(
      source.indexOf("Product:show") + "Product:show".length,
    );
  });

  it("detects a quoted {link} literal", () => {
    const source = "{link 'Product:show'}";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toEqual({
      tag: "link",
      target: "Product:show",
      targetStart: source.indexOf("Product:show"),
      targetEnd: source.indexOf("Product:show") + "Product:show".length,
    });
  });

  it("detects an n:href attribute target", () => {
    const source = '<a n:href="Product:show">Go</a>';
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toEqual({
      tag: "n:href",
      target: "Product:show",
      targetStart: source.indexOf("Product:show"),
      targetEnd: source.indexOf("Product:show") + "Product:show".length,
    });
  });

  it("takes only the first n:href argument before a comma", () => {
    const source =
      '<a n:href="SubscriptionTypeGroupAdmin:showAddons, $subscriptionTypeGroup[\'id\']">Addons</a>';
    const target = "SubscriptionTypeGroupAdmin:showAddons";
    const offset = offsetOf(source, target, 2);

    expect(detectLatteLinkAt(source, offset)).toEqual({
      tag: "n:href",
      target,
      targetStart: source.indexOf(target),
      targetEnd: source.indexOf(target) + target.length,
    });
    expect(
      detectLatteLinkAt(source, offsetOf(source, "$subscriptionTypeGroup", 2)),
    ).toBeNull();
  });

  it("detects a single-quoted n:href target", () => {
    const source = "<a n:href='Product:show'>Go</a>";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)?.tag).toBe("n:href");
    expect(detectLatteLinkAt(source, offset)?.target).toBe("Product:show");
  });

  it("returns null on the tag name rather than the argument", () => {
    const source = "{link Product:show}";
    const offset = offsetOf(source, "link", 1);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null for a dynamic {link $dest}", () => {
    const source = "{link $dest}";
    const offset = offsetOf(source, "$dest", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null for a dynamic n:href value", () => {
    const source = '<a n:href="$link">Go</a>';
    const offset = offsetOf(source, "$link", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null inside a {* comment *}", () => {
    const source = "{* {link Product:show} *}";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null for an n:href inside a {* comment *}", () => {
    const source = '{* <a n:href="Product:show"> *}';
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is on n:href arguments, not the target", () => {
    const source = '<a n:href="Product:show $id">Go</a>';
    const offset = offsetOf(source, "$id", 1);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("returns null on a non-link tag", () => {
    const source = "{include 'menu.latte'}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });

  it("does not match a data-n:href attribute as an n:href target", () => {
    const source = '<a data-n:href="Product:show">Go</a>';
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectLatteLinkAt(source, offset)).toBeNull();
  });
});

describe("detectPhpPresenterLinkAt", () => {
  it("detects a $this->link('Presenter:action') call", () => {
    const source = "$url = $this->link('Product:show', $id);";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectPhpPresenterLinkAt(source, offset)).toEqual({
      call: "link",
      target: "Product:show",
      targetStart: source.indexOf("Product:show"),
      targetEnd: source.indexOf("Product:show") + "Product:show".length,
    });
  });

  it("detects a $this->redirect('Presenter:action') call", () => {
    const source = "$this->redirect('Product:default');";
    const offset = offsetOf(source, "Product:default", 2);

    expect(detectPhpPresenterLinkAt(source, offset)?.call).toBe("redirect");
    expect(detectPhpPresenterLinkAt(source, offset)?.target).toBe(
      "Product:default",
    );
  });

  it("detects a redirectPermanent call without matching plain redirect", () => {
    const source = "$this->redirectPermanent('Home:');";
    const offset = offsetOf(source, "Home:", 2);

    expect(detectPhpPresenterLinkAt(source, offset)?.call).toBe(
      "redirectPermanent",
    );
  });

  it("detects forward / lazyLink / isLinkCurrent / canonicalize", () => {
    for (const call of [
      "forward",
      "lazyLink",
      "isLinkCurrent",
      "canonicalize",
    ]) {
      const source = `$this->${call}('Product:show');`;
      const offset = offsetOf(source, "Product:show", 2);

      expect(detectPhpPresenterLinkAt(source, offset)?.call).toBe(call);
    }
  });

  it("does not match a lookalike method (linkGenerator)", () => {
    const source = "$this->linkGenerator('Product:show');";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectPhpPresenterLinkAt(source, offset)).toBeNull();
  });

  it("returns null for a dynamic first argument", () => {
    const source = "$this->link($destination);";
    const offset = offsetOf(source, "$destination", 2);

    expect(detectPhpPresenterLinkAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is outside the literal", () => {
    const source = "$this->link('Product:show', $id);";
    const offset = offsetOf(source, "$id", 1);

    expect(detectPhpPresenterLinkAt(source, offset)).toBeNull();
  });

  // Documented gap (see the PHP_LINK_CALL / firstStringLiteralArgument
  // comments): the legacy `redirect(302, 'Presenter:action')` HTTP-code
  // overload is intentionally NOT detected. It is a deprecated Nette form,
  // and requiring the first argument to be the string literal keeps this
  // module simple and conservative rather than argument-position-aware.
  it("does not detect a legacy redirect(code, target) call", () => {
    const source = "$this->redirect(302, 'Product:show');";
    const offset = offsetOf(source, "Product:show", 2);

    expect(detectPhpPresenterLinkAt(source, offset)).toBeNull();
  });
});

describe("nettePresenterLinkCompletionContextAt", () => {
  it("offers a Latte {link} completion for a partial target", () => {
    const source = "{link Prod}";
    const offset = offsetOf(source, "Prod") + "Prod".length;

    expect(nettePresenterLinkCompletionContextAt(source, offset, "latte")).toEqual({
      prefix: "Prod",
      replaceStart: source.indexOf("Prod"),
      replaceEnd: source.indexOf("Prod") + "Prod".length,
    });
  });

  it("offers an empty-prefix {link} completion right after the tag", () => {
    const source = "{link }";
    const offset = offsetOf(source, "}");

    expect(nettePresenterLinkCompletionContextAt(source, offset, "latte")).toEqual({
      prefix: "",
      replaceStart: offset,
      replaceEnd: offset,
    });
  });

  it("offers an n:href completion for a partial target", () => {
    const source = '<a n:href="Prod">';
    const offset = offsetOf(source, "Prod") + "Prod".length;

    expect(nettePresenterLinkCompletionContextAt(source, offset, "latte")).toEqual({
      prefix: "Prod",
      replaceStart: source.indexOf("Prod"),
      replaceEnd: source.indexOf("Prod") + "Prod".length,
    });
  });

  it("scopes an n:href completion to the first token only", () => {
    const source = '<a n:href="Product:sh $id">';
    const offset = offsetOf(source, "Product:sh") + "Product:sh".length;

    expect(nettePresenterLinkCompletionContextAt(source, offset, "latte")).toEqual({
      prefix: "Product:sh",
      replaceStart: source.indexOf("Product:sh"),
      replaceEnd: source.indexOf("Product:sh") + "Product:sh".length,
    });
  });

  it("offers a PHP link completion for a partial literal", () => {
    const source = "$this->link('Prod');";
    const offset = offsetOf(source, "Prod") + "Prod".length;

    expect(nettePresenterLinkCompletionContextAt(source, offset, "php")).toEqual({
      prefix: "Prod",
      replaceStart: source.indexOf("Prod"),
      replaceEnd: source.indexOf("Prod") + "Prod".length,
    });
  });

  it("offers an empty-prefix PHP completion right after the quote", () => {
    const source = "$this->link('');";
    const offset = offsetOf(source, "''") + 1;

    expect(nettePresenterLinkCompletionContextAt(source, offset, "php")).toEqual({
      prefix: "",
      replaceStart: offset,
      replaceEnd: offset,
    });
  });

  it("does not offer completion inside a data-n:href attribute", () => {
    const source = '<a data-n:href="Prod">';
    const offset = offsetOf(source, "Prod") + "Prod".length;

    expect(
      nettePresenterLinkCompletionContextAt(source, offset, "latte"),
    ).toBeNull();
  });

  it("returns null when the Latte cursor is not in a link context", () => {
    const source = "{include 'menu.latte'}";
    const offset = offsetOf(source, "menu", 2);

    expect(
      nettePresenterLinkCompletionContextAt(source, offset, "latte"),
    ).toBeNull();
  });

  it("returns null when the PHP cursor is not in a link call", () => {
    const source = "$this->products->get('id');";
    const offset = offsetOf(source, "id", 1);

    expect(
      nettePresenterLinkCompletionContextAt(source, offset, "php"),
    ).toBeNull();
  });
});

describe("netteRoutePresenterTargetsFromSource", () => {
  it("extracts static presenter defaults from Nette Route constructors", () => {
    const source = `<?php
use Nette\\Application\\Routers\\Route;

$router[] = new Route('/product/<id>', 'Product:show');
$router[] = new Route('/admin', ':Admin:Dashboard:');
$router[] = new Route('/dynamic', $defaults);
`;

    expect(netteRoutePresenterTargetsFromSource(source)).toEqual([
      { target: "Admin:Dashboard:default" },
      { target: "Product:show" },
    ]);
  });

  it("extracts presenter/action array defaults and ignores dynamic entries", () => {
    const source = `<?php
$router[] = new \\Nette\\Application\\Routers\\Route('/orders', [
    'presenter' => 'Order',
    'action' => 'list',
]);
$router[] = new Route('/home', ['presenter' => 'Homepage']);
$router[] = new Route('/bad', ['presenter' => $presenter, 'action' => 'show']);
`;

    expect(netteRoutePresenterTargetsFromSource(source)).toEqual([
      { target: "Homepage:default" },
      { target: "Order:list" },
    ]);
  });
});

describe("hang safety", () => {
  it("handles empty sources and out-of-range offsets", () => {
    expect(detectLatteLinkAt("", 0)).toBeNull();
    expect(detectPhpPresenterLinkAt("", 0)).toBeNull();
    expect(nettePresenterLinkCompletionContextAt("", 0, "latte")).toBeNull();
    expect(detectLatteLinkAt("{link Product:show}", -5)).toBeNull();
    expect(detectLatteLinkAt("{link Product:show}", 9999)).toBeNull();
  });

  it("handles an unterminated {link tag", () => {
    const source = "{link Product:show";
    const offset = offsetOf(source, "Product:show", 2);

    expect(() => detectLatteLinkAt(source, offset)).not.toThrow();
    expect(detectLatteLinkAt(source, offset)?.target).toBe("Product:show");
  });

  it("handles an unterminated n:href attribute", () => {
    const source = '<a n:href="Product:show';
    const offset = offsetOf(source, "Product:show", 2);

    expect(() => detectLatteLinkAt(source, offset)).not.toThrow();
  });

  it("stays linear on a large document (latte)", () => {
    const source = `${"x".repeat(200000)}{link Product:show}`;
    const offset = source.indexOf("Product:show") + 2;

    const started = Date.now();
    const result = detectLatteLinkAt(source, offset);
    const elapsed = Date.now() - started;

    expect(result?.target).toBe("Product:show");
    expect(elapsed).toBeLessThan(1000);
  });

  it("stays linear on a large document (php)", () => {
    const source = `${"x".repeat(200000)}$this->link('Product:show');`;
    const offset = source.indexOf("Product:show") + 2;

    const started = Date.now();
    const result = detectPhpPresenterLinkAt(source, offset);
    const elapsed = Date.now() - started;

    expect(result?.target).toBe("Product:show");
    expect(elapsed).toBeLessThan(1000);
  });
});
