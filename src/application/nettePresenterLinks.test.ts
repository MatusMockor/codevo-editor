import { describe, expect, it } from "vitest";
import {
  nettePresenterLinkTargetsFromSource,
} from "./nettePresenterLinks";

describe("nettePresenterLinkTargetsFromSource", () => {
  it("extracts action, render, handle and route targets from presenter sources", () => {
    const source = `<?php
class ProductPresenter
{
    public function actionEdit(): void {}
    public function renderShow(): void {}
    public function handleDelete(): void {}
}

$router[] = new Route('/login', ['presenter' => 'Sign', 'action' => 'in']);
`;

    expect(nettePresenterLinkTargetsFromSource("/ws/app/ProductPresenter.php", source))
      .toEqual(["Product:edit", "Product:show", "Product:delete!", "Sign:in"]);
  });
});
