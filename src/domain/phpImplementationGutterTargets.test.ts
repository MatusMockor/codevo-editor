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

  it("finds abstract methods declared inside abstract PHP classes", () => {
    expect(
      phpImplementationGutterTargets(`<?php

abstract class BaseRepository
{
    abstract protected function modelClass(): string;

    public function query(): Builder
    {
    }

    abstract public static function makeDefault(): self;
}
`),
    ).toEqual([
      {
        methodName: "modelClass",
        position: {
          column: 33,
          lineNumber: 5,
        },
      },
      {
        methodName: "makeDefault",
        position: {
          column: 37,
          lineNumber: 11,
        },
      },
    ]);
  });
});
