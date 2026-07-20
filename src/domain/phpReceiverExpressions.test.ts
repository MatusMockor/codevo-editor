import { describe, expect, it } from "vitest";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
  phpSimpleVariableName,
} from "./phpReceiverExpressions";

const receiverChainPattern = new RegExp(
  `^${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*$`,
);

describe("phpReceiverExpressions", () => {
  it("normalizes PHP receiver operators without changing argument strings", () => {
    expect(
      phpNormalizeReceiverExpression(
        " Album :: query() -> whereNull('parent id') -> first() ",
      ),
    ).toBe("Album::query()->whereNull('parent id')->first()");
    expect(
      phpNormalizeReceiverExpression(
        " $user ? -> profile ?-> getName('display name') ",
      ),
    ).toBe("$user?->profile?->getName('display name')");
  });

  it("extracts simple variable receivers only", () => {
    expect(phpSimpleVariableName("$request")).toBe("request");
    expect(phpSimpleVariableName("$query->whereNull('parent_id')")).toBeNull();
    expect(phpSimpleVariableName("$user?->profile")).toBeNull();
  });

  it.each([
    "factory(Service::class)",
    "factory(Service::class)->build()",
    "Factory::create(Service::class)",
    "Factory::instance()->build(Service::class)",
    "$factory->build(Service::class)",
    "$this->factory()->build(Service::class)",
  ])("matches generic PHP receiver chain %s", (expression) => {
    expect(receiverChainPattern.test(expression)).toBe(true);
  });

  it.each([
    "app(Service::class)",
    "resolve(Service::class)",
    "make(Service::class)",
    "app()->make(Service::class)",
    "Container::make(Service::class)",
    "Container::getInstance()->make(Service::class)",
  ])("treats helper-shaped receiver %s as generic PHP syntax", (expression) => {
    expect(receiverChainPattern.test(expression)).toBe(true);
  });
});
