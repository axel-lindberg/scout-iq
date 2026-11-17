import {
  applyTransfer,
  cannotBuy,
  cannotSwap,
  draftFromLineup,
  fillAt,
  lineupOf,
  lineupPoints,
  removeAt,
  setCaptain,
  setVice,
  squadIds,
  swap,
  transferState,
  type PlanPlayer,
} from "./plan";

// GK 1-2, DEF 10-14, MID 20-24, FWD 30-32. XI 4-4-2 with 14, 24, 32 and GK 2 on the bench.
const POS: Record<number, string> = {};
for (const id of [1, 2]) POS[id] = "GK";
for (const id of [10, 11, 12, 13, 14, 60]) POS[id] = "DEF";
for (const id of [20, 21, 22, 23, 24, 50]) POS[id] = "MID";
for (const id of [30, 31, 32]) POS[id] = "FWD";
const pos = (id: number) => POS[id] ?? "MID";
const lineup = {
  starters: [1, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31],
  bench: [2, 24, 14, 32],
  captain: 30,
  vice: 31,
};
const ORIGINAL = [...lineup.starters, ...lineup.bench];
const price = (id: number) => (id === 50 ? 8.0 : id === 60 ? 6.0 : 5.0);

describe("plan", () => {
  it("round-trips a lineup and keeps the armband on xi slots", () => {
    const d = draftFromLineup(lineup, pos);
    expect(lineupOf(d)).toEqual(lineup);
    expect(d.xi[d.captain]?.id).toBe(30);
    // Bench 32 for 30 (forward for forward): the player coming on inherits the captaincy.
    const subbed = swap(d, { part: "xi", index: 9 }, { part: "bench", index: 3 });
    expect(lineupOf(subbed)).toMatchObject({
      captain: 32,
      bench: [2, 24, 14, 30],
    });
  });

  it("counts transfers against the original squad, so buying a player back is free", () => {
    const d = draftFromLineup(lineup, pos);
    const sold = removeAt(d, { part: "xi", index: 8 }); // MID 23 out
    expect(squadIds(sold)).toHaveLength(14);
    expect(transferState(ORIGINAL, 1.0, 1, squadIds(sold), price)).toMatchObject({ made: 0, freeLeft: 1, bank: 6.0 });

    const bought = fillAt(sold, { part: "xi", index: 8 }, 50); // 8.0 MID in
    expect(transferState(ORIGINAL, 1.0, 1, squadIds(bought), price)).toEqual({
      made: 1,
      freeLeft: 0,
      hits: 0,
      bank: -2.0,
      bankDelta: -3.0,
    });
    const back = fillAt(removeAt(bought, { part: "xi", index: 8 }), { part: "xi", index: 8 }, 23);
    expect(transferState(ORIGINAL, 1.0, 1, squadIds(back), price)).toMatchObject({
      made: 0,
      freeLeft: 1,
      hits: 0,
      bank: 1.0,
    });
  });

  it("charges 4 points per transfer beyond the free ones", () => {
    const ids = ORIGINAL.map((x) => (x === 23 ? 50 : x === 13 ? 60 : x));
    expect(transferState(ORIGINAL, 5, 1, ids, price)).toMatchObject({
      made: 2,
      freeLeft: 0,
      hits: 4,
    });
    expect(transferState(ORIGINAL, 5, 0, ids, price).hits).toBe(8);
    expect(transferState(ORIGINAL, 5, 2, ids, price).hits).toBe(0);
  });

  it("only allows substitutions that leave a legal formation", () => {
    const d = draftFromLineup(lineup, pos);
    const xi = (index: number) => ({ part: "xi" as const, index });
    const bench = (index: number) => ({ part: "bench" as const, index });
    expect(cannotSwap(d, xi(0), bench(0))).toBeNull(); // GK for GK
    expect(cannotSwap(d, xi(0), bench(1))).toBe("A goalkeeper can only swap with a goalkeeper.");
    expect(cannotSwap(d, xi(1), bench(3))).toBeNull(); // DEF off, FWD on: 3-4-3
    const threeAtBack = swap(d, xi(1), bench(3));
    expect(cannotSwap(threeAtBack, xi(2), bench(1))).toBe("At least 3 defenders must start.");
    expect(cannotSwap(d, xi(5), xi(6))).toBe("Pick a bench player to swap with.");
    expect(cannotSwap(d, bench(1), bench(3))).toBeNull(); // bench order
    expect(cannotSwap(removeAt(d, bench(1)), xi(5), bench(1))).toBe("Fill the empty slot first.");
  });

  it("scores the XI with the captain doubled, and moves the armband", () => {
    const x = (id: number) => (id === 30 ? 7 : id === 21 ? 5 : 2);
    const d = draftFromLineup(lineup, pos);
    expect(lineupPoints(d, x)).toBe(2 * 9 + 5 + 7 + 7);
    const palmer = setCaptain(d, 6); // id 21
    expect(lineupPoints(palmer, x)).toBe(2 * 9 + 5 + 7 + 5);
    const toVice = setCaptain(d, d.vice); // the vice becomes captain: the old captain becomes vice
    expect(lineupOf(toVice)).toMatchObject({ captain: 31, vice: 30 });
    expect(lineupOf(setVice(d, d.captain))).toMatchObject({
      captain: 31,
      vice: 30,
    });
    expect(lineupPoints(removeAt(d, { part: "xi", index: 9 }), x)).toBe(2 * 9 + 5); // empty captain slot: 0
  });

  it("checks the club limit and budget when buying", () => {
    const d = removeAt(draftFromLineup(lineup, pos), { part: "xi", index: 8 });
    const r = { part: "xi" as const, index: 8 };
    const p = (id: number, team: string, position = "MID", cost = 5): PlanPlayer => ({
      id,
      name: `P${id}`,
      team,
      position,
      price: cost,
      expected_points: [1],
    });
    const teamOf = (id: number) => (id === 20 || id === 21 || id === 22 ? "ARS" : "XXX");
    expect(cannotBuy(d, r, p(70, "ARS"), 5, teamOf)).toBe("3 from ARS");
    expect(cannotBuy(d, r, p(70, "CHE", "DEF"), 5, teamOf)).toBe("not a MID");
    expect(cannotBuy(d, r, p(20, "ARS"), 5, teamOf)).toBe("in your squad");
    expect(cannotBuy(d, r, p(70, "CHE", "MID", 5.5), 5, teamOf)).toBe("£0.5m short");
    expect(cannotBuy(d, r, p(70, "CHE", "MID", 5.0), 5, teamOf)).toBeNull();
  });

  it("applies a suggested pair into the sold players' slots", () => {
    const d = draftFromLineup(lineup, pos);
    const next = applyTransfer(
      d,
      [23, 13],
      [
        { id: 60, position: "DEF" },
        { id: 50, position: "MID" },
      ],
    );
    expect(lineupOf(next)?.starters).toEqual([1, 10, 11, 12, 60, 20, 21, 22, 50, 30, 31]);
  });
});
