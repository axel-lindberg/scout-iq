import { describe, expect, it } from "vitest";
import { gradeCuts, gradeOf } from "./grade";

describe("xPts grade", () => {
  // 1.0 ... 10.0 in contention, plus reserves on 0 and 0.3 that don't move the cut-offs.
  const xs = [...Array.from({ length: 10 }, (_, i) => i + 1), 0, 0, 0.3];

  it("cuts at the 90th, 70th, 30th and 10th percentile of players in contention", () => {
    expect(gradeCuts(xs)).toEqual([9, 7, 3, 1]);
  });

  it("grades top 10% very good down to bottom 10% (and blanks) very poor", () => {
    const cuts = gradeCuts(xs) ?? [];
    expect([10, 9, 8, 7, 5, 3, 2, 1, 0.5, 0].map((x) => gradeOf(x, cuts))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("doesn't grade with too few players to compare", () => {
    expect(gradeCuts([5, 6, 7])).toBeNull();
  });
});
