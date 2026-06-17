import { describe, expect, it } from "vitest";
import { phpImplementationGutterTargets } from "./phpImplementationGutterTargets";

describe("phpImplementationGutterTargets", () => {
  it("finds methods declared inside PHP interfaces", () => {
    expect(
      phpImplementationGutterTargets(`<?php

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
      phpImplementationGutterTargets(`<?php

final class SearchService
{
    public function search(): void {}
}
`),
    ).toEqual([]);
  });
});
