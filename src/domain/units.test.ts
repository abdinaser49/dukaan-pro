import { describe, expect, it } from "vitest";
import { convertQuantityToBase, formatWeightGrams } from "./units";

describe("Somali weight-unit conversions", () => {
  it("keeps Tumin and Rubac as distinct sizes", () => {
    expect(convertQuantityToBase(1, 125)).toBe("125");
    expect(convertQuantityToBase(1, 250)).toBe("250");
    expect(convertQuantityToBase(1, 500)).toBe("500");
    expect(convertQuantityToBase(1, 1000)).toBe("1000");
  });

  it("converts the required partial-sale examples exactly", () => {
    expect(convertQuantityToBase(5, 125)).toBe("625");
    expect(convertQuantityToBase(3, 250)).toBe("750");
    expect(convertQuantityToBase(0.125, 1000)).toBe("125");
  });

  it("renders human-readable remaining stock", () => {
    expect(formatWeightGrams(25000)).toBe("25 KG");
    expect(formatWeightGrams(24375)).toBe("24 KG + 3 Tumin");
    expect(formatWeightGrams(24250)).toBe("24 KG + 1 Rubac");
    expect(formatWeightGrams(24500)).toBe("24 KG + 2 Rubac");
  });

  it("rejects invalid quantities instead of silently coercing them", () => {
    expect(() => convertQuantityToBase(-1, 125)).toThrow();
    expect(() => convertQuantityToBase("1.1234567", 125)).toThrow();
  });
});
