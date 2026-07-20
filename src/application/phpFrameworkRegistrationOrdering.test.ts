import { describe, expect, it } from "vitest";
import {
  byRegistrationOrder,
  orderPhpFrameworkRegistrationsByPriority,
} from "./phpFrameworkRegistrationOrdering";

describe("orderPhpFrameworkRegistrationsByPriority", () => {
  it("orders by priority descending treating missing priority as zero", () => {
    const ordered = orderPhpFrameworkRegistrationsByPriority([
      { id: "low", priority: -1 },
      { id: "default" },
      { id: "high", priority: 5 },
    ]);

    expect(ordered.map((registration) => registration.id)).toEqual([
      "high",
      "default",
      "low",
    ]);
  });

  it("breaks priority ties by registration order by default", () => {
    const ordered = orderPhpFrameworkRegistrationsByPriority([
      { id: "second", priority: 1 },
      { id: "third", priority: 1 },
      { id: "first", priority: 2 },
    ]);

    expect(ordered.map((registration) => registration.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("applies a caller-provided tiebreak before registration order", () => {
    const ordered = orderPhpFrameworkRegistrationsByPriority(
      [
        { id: "zeta", priority: 1 },
        { id: "alpha", priority: 1 },
      ],
      (left, right) =>
        left.registration.id.localeCompare(right.registration.id) ||
        byRegistrationOrder(left, right),
    );

    expect(ordered.map((registration) => registration.id)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("does not mutate the input registrations", () => {
    const registrations = [
      { id: "b", priority: 1 },
      { id: "a", priority: 2 },
    ];

    orderPhpFrameworkRegistrationsByPriority(registrations);

    expect(registrations.map((registration) => registration.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
