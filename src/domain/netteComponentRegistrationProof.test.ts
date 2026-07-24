import { describe, expect, it } from "vitest";
import { netteAddComponentRegistrations } from "./netteComponents";
import { canProveNoUnresolvedNetteAddComponentCalls } from "./netteComponentRegistrationProof";

describe("canProveNoUnresolvedNetteAddComponentCalls", () => {
  it("accepts fully parsed literal calls irrespective of PHP method casing", () => {
    const source = "<?php class C { function x() { $this->addcomponent(new X, 'cart'); } }";

    expect(netteAddComponentRegistrations(source)).toHaveLength(1);
    expect(canProveNoUnresolvedNetteAddComponentCalls(source)).toBe(true);
  });

  it("rejects dynamic and named-argument calls", () => {
    expect(
      canProveNoUnresolvedNetteAddComponentCalls(
        "<?php class C { function x() { $this->addComponent($x, $name); } }",
      ),
    ).toBe(false);
    expect(
      canProveNoUnresolvedNetteAddComponentCalls(
        "<?php class C { function x() { $this->addComponent(name: 'cart', component: new X); } }",
      ),
    ).toBe(false);
  });

  it("ignores strings and comments", () => {
    expect(
      canProveNoUnresolvedNetteAddComponentCalls(
        "<?php class C { function x() { /* $this->addComponent($x, $name); */ } }",
      ),
    ).toBe(true);
  });
});
