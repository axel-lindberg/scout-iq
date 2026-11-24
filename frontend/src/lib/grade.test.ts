import { describe, expect, it } from "vitest";
import { gradeCuts, gradeOf } from "./grade";

describe("xPts grade", () => {
  // 1 ... 21 in contention, plus reserves on 0 and 0.3 that don't move the cut-offs.
  const xs = [...Array.from({ length: 21 }, (_, i) => i + 1), 0, 0, 0.3];

  it("cuts at the 98th, 80th, 30th and 10th percentile of players in contention", () => {
    expect(gradeCuts(xs)).toEqual([20, 17, 7, 3]);
  });

  it("grades top 2% very good down to bottom 10% (and blanks) very poor", () => {
    const cuts = gradeCuts(xs) ?? [];
    expect([21, 20, 19, 17, 16, 7, 6, 3, 2, 0].map((x) => gradeOf(x, cuts))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("doesn't grade with too few players to compare", () => {
    expect(gradeCuts([5, 6, 7])).toBeNull();
  });
});
