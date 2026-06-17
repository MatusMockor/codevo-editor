import { describe, expect, it } from "vitest";
import { phpImplementationCodeLensTargets } from "./phpImplementationCodeLenses";

describe("phpImplementationCodeLensTargets", () => {
  it("finds methods declared inside PHP interfaces", () => {
    expect(
      phpImplementationCodeLensTargets(`<?php

namespace App\\Contracts;

interface SearchRepository
{
    public function search(array $searchParams): LengthAwarePaginator;

    public function findOne(int $id): object;
}
`),
    ).toEqual([
      {
        methodName: "search",
        position: {
          column: 21,
          lineNumber: 7,
        },
      },
      {
        methodName: "findOne",
        position: {
          column: 21,
          lineNumber: 9,
        },
      },
    ]);
  });

  it("does not add implementation lenses for regular classes", () => {
    expect(
      phpImplementationCodeLensTargets(`<?php

final class SearchService
{
    public function search(): void {}
}
`),
    ).toEqual([]);
  });
});
