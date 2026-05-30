import { describe, expect, it } from "vitest";
import { rollHasScoreableDice, scoreDice } from "./scoring";

describe("scoreDice", () => {
  it("scores a single 1 as 100", () => {
    expect(scoreDice([1])).toEqual({ valid: true, score: 100 });
  });

  it("scores a single 5 as 50", () => {
    expect(scoreDice([5])).toEqual({ valid: true, score: 50 });
  });

  it("scores three 3s as 300", () => {
    expect(scoreDice([3, 3, 3]).score).toBe(300);
  });

  it("scores three 5s as 500, not 150", () => {
    expect(scoreDice([5, 5, 5]).score).toBe(500);
  });

  it("scores three 1s as 1000", () => {
    expect(scoreDice([1, 1, 1]).score).toBe(1000);
  });

  it("scores 3,3,3,5 as 350", () => {
    expect(scoreDice([3, 3, 3, 5]).score).toBe(350);
  });

  it("rejects unscored dice", () => {
    expect(scoreDice([1, 1, 1, 3])).toEqual({ valid: false, score: 0 });
  });

  it("scores a low straight as 500", () => {
    expect(scoreDice([1, 2, 3, 4, 5]).score).toBe(500);
  });

  it("scores a high straight as 750", () => {
    expect(scoreDice([2, 3, 4, 5, 6]).score).toBe(750);
  });

  it("scores a full straight as 1500", () => {
    expect(scoreDice([1, 2, 3, 4, 5, 6]).score).toBe(1500);
  });
});

describe("rollHasScoreableDice", () => {
  it("detects a non-scoring roll as a bust", () => {
    expect(rollHasScoreableDice([2, 3, 4, 6])).toBe(false);
  });
});
