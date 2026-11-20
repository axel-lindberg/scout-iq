"""Feedback on a 15-player FPL squad: best XI, captain, weakest players, transfer suggestions.

Deterministic Python on top of the model's per-gameweek expected points, never the LLM: the
answer must respect hard rules (formation, budget, club limit) and be the same every time.

Objective. A squad's value in one gameweek is the expected points of its best XI plus the
captain's expected points again (the captain scores double). Over a horizon it is the sum of the
gameweeks, picking the best XI each week. Bench points count for nothing.

Best XI. Exactly 1 GK, at least 3 DEF, 2 MID and 1 FWD, 11 players. Points add up, and the rules
only limit how many players come from each position, so for a formation like 4-4-2 the best XI is
simply the top 4 DEF, top 4 MID and top 2 FWD. There are only 8 legal formations, so try them all.
The squad's best player is always in the best XI (every formation takes the top player of each
position), so he is the captain.

Transfers. Swapping one player only changes one position group, and there are about 15 x 200
candidate swaps, so every legal single transfer is scored exactly. Pairs are too many to score
exactly (about 10^7), so each pair is first estimated as the sum of its two single-transfer gains,
then the best estimates are re-scored exactly.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass

import numpy as np
import pandas as pd

SQUAD_SHAPE = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
MAX_PER_CLUB = 3
HIT_COST = 4
FORMATIONS = [(d, m, f) for d in range(3, 6) for m in range(2, 6) for f in range(1, 4) if d + m + f == 10]
OUT_STATUSES = {"i", "s", "u", "n"}  # injured, suspended, unavailable, not in squad
PAIR_RESCORE = 60                     # pair candidates re-scored exactly


@dataclass
class Pool:
    """Every player we know, with expected points per gameweek (rows of `xpts`)."""
    info: pd.DataFrame      # index = element; position, team_id, price, ...
    xpts: np.ndarray        # (players, gameweeks), chance-of-playing adjusted
    gameweeks: list[int]

    def __post_init__(self):
        self.row = {int(e): i for i, e in enumerate(self.info.index)}

    def rows(self, elements) -> list[int]:
        return [self.row[int(e)] for e in elements]


def build_pool(players: pd.DataFrame, by_gw: pd.DataFrame, gameweeks: list[int]) -> Pool:
    """Pool from `Upcoming.players` and `Upcoming.by_gw`. Players without fixtures get 0s."""
    info = players.drop_duplicates("element").set_index("element").sort_index()
    wide = (by_gw.pivot_table(index="element", columns="GW", values="xpts_adjusted", aggfunc="sum")
            .reindex(index=info.index, columns=gameweeks).fillna(0.0))
    return Pool(info=info, xpts=wide.to_numpy(dtype=float), gameweeks=list(gameweeks))


# ---- rules ---------------------------------------------------------------------------------

def validate_squad(info: pd.DataFrame, elements: list[int]) -> list[str]:
    """Problems with a squad (empty list = valid): 15 different known players, 2/5/5/3, max 3 per club."""
    errors = []
    unknown = [e for e in elements if e not in info.index]
    if unknown:
        errors.append(f"Unknown player id(s): {', '.join(map(str, unknown))}.")
    if len(set(elements)) != len(elements):
        errors.append("The same player is in the squad twice.")
    if len(elements) != 15:
        errors.append(f"A squad has 15 players, not {len(elements)}.")
    known = info.loc[[e for e in dict.fromkeys(elements) if e in info.index]]
    counts = known["position"].value_counts()
    for pos, need in SQUAD_SHAPE.items():
        have = int(counts.get(pos, 0))
        if have != need:
            errors.append(f"{need} {pos} needed, the squad has {have}.")
    for team, n in known["team_id"].value_counts().items():
        if n > MAX_PER_CLUB:
            name = known.loc[known.team_id == team, "team_short"].iloc[0] if "team_short" in known else team
            errors.append(f"At most {MAX_PER_CLUB} players per club: {n} from {name}.")
    return errors


# ---- best XI -------------------------------------------------------------------------------

def squad_points(xpts: np.ndarray, positions: np.ndarray) -> np.ndarray:
    """Best-XI expected points (captain counted twice) per gameweek. xpts: (15, gameweeks)."""
    top = {}
    for pos in SQUAD_SHAPE:
        x = -np.sort(-xpts[positions == pos], axis=0)                 # best first, per gameweek
        top[pos] = np.vstack([np.zeros(xpts.shape[1]), np.cumsum(x, axis=0)])  # top[pos][k] = best k
    best = np.max([top["DEF"][d] + top["MID"][m] + top["FWD"][f] for d, m, f in FORMATIONS], axis=0)
    return top["GK"][1] + best + xpts.max(axis=0)   # the squad's best player is in the XI: captain


@dataclass
class Lineup:
    formation: str
    starters: list[int]      # elements, GK first then DEF, MID, FWD, each best first
    bench: list[int]         # GK first, then outfield by expected points (auto-sub order)
    captain: int
    vice_captain: int
    points: float            # XI + captain again


def best_xi(elements: list[int], positions: list[str], xpts: list[float]) -> Lineup:
    """Best XI for one gameweek. Ties are broken by element id, so the answer is deterministic."""
    order = {pos: sorted((i for i, p in enumerate(positions) if p == pos), key=lambda i: (-xpts[i], elements[i]))
             for pos in SQUAD_SHAPE}
    best = None
    for d, m, f in FORMATIONS:
        xi = order["GK"][:1] + order["DEF"][:d] + order["MID"][:m] + order["FWD"][:f]
        total = sum(xpts[i] for i in xi)
        if best is None or total > best[0] + 1e-9:
            best = (total, (d, m, f), xi)
    total, (d, m, f), xi = best
    ranked = sorted(xi, key=lambda i: (-xpts[i], elements[i]))
    rest = [i for i in range(len(elements)) if i not in xi]
    bench = [i for i in rest if positions[i] == "GK"] + sorted(
        (i for i in rest if positions[i] != "GK"), key=lambda i: (-xpts[i], elements[i]))
    return Lineup(formation=f"{d}-{m}-{f}", starters=[elements[i] for i in xi], bench=[elements[i] for i in bench],
                  captain=elements[ranked[0]], vice_captain=elements[ranked[1]],
                  points=float(total + xpts[ranked[0]]))


# ---- transfers -----------------------------------------------------------------------------

def hits(n_transfers: int, free_transfers: int) -> int:
    """Points deducted for n transfers: 4 for each one beyond the free ones."""
    return HIT_COST * max(0, n_transfers - free_transfers)


def _club_ok(team_counts: dict, out_teams: list, in_teams: list) -> bool:
    counts = dict(team_counts)
    for t in out_teams:
        counts[t] -= 1
    for t in in_teams:
        counts[t] = counts.get(t, 0) + 1
        if counts[t] > MAX_PER_CLUB:
            return False
    return True


def suggest_transfers(pool: Pool, squad: list[int], bank: float, free_transfers: int, top_n: int = 10,
                      pairs: bool = True, horizon: int | None = None) -> dict:
    """Best single transfers (and pairs) by expected-points gain over the horizon minus hits.

    Legal = same position, not already owned, affordable (bank + the outgoing players' prices,
    at today's prices) and at most 3 players per club afterwards.
    """
    g = horizon or len(pool.gameweeks)
    info = pool.info
    rows = pool.rows(squad)
    X = pool.xpts[rows, :g]
    positions = info.loc[squad, "position"].to_numpy()
    prices = info.loc[squad, "price"].to_numpy(dtype=float)
    teams = info.loc[squad, "team_id"].to_list()
    team_counts = pd.Series(teams).value_counts().to_dict()
    base = squad_points(X, positions)
    owned = set(squad)
    eps = 1e-6  # prices are in steps of 0.1: compare with a tolerance

    candidates = {pos: info.index[(info["position"] == pos) & ~info.index.isin(owned)].to_list()
                  for pos in SQUAD_SHAPE}
    single_gain: dict[int, list[tuple[float, int, np.ndarray]]] = {}   # out index -> [(gain, in, per-GW)]
    singles = []
    for i, out in enumerate(squad):
        opts = []
        for new in candidates[positions[i]]:
            Xn = X.copy()
            Xn[i] = pool.xpts[pool.row[new], :g]
            per_gw = squad_points(Xn, positions) - base
            opts.append((float(per_gw.sum()), new, per_gw))
            price_in = float(info.at[new, "price"])
            if price_in <= bank + prices[i] + eps and _club_ok(team_counts, [teams[i]], [info.at[new, "team_id"]]):
                singles.append({"out": [out], "in": [new], "per_gw": per_gw,
                                "bank_after": bank + prices[i] - price_in})
        single_gain[i] = opts

    res_pairs = []
    if pairs:
        res_pairs = _pairs(pool, squad, X, positions, prices, teams, team_counts, base, bank, single_gain, g)

    own_total = dict(zip(squad, X.sum(axis=1)))

    def finish(cands, n):
        out = []
        for c in cands:
            h = hits(len(c["out"]), free_transfers)
            gain = float(c["per_gw"].sum())
            out.append({**c, "gain": gain, "hits": h, "net_gain": gain - h})
        # Equal gains (common: bench points count for nothing) -> sell the weaker player first.
        out.sort(key=lambda c: (-round(c["net_gain"], 6), sum(own_total[e] for e in c["out"]),
                                sorted(c["out"]), sorted(c["in"])))
        return out[:n]

    return {"base_per_gw": base, "singles": finish(singles, top_n), "pairs": finish(res_pairs, max(3, top_n // 2))}


def _pairs(pool, squad, X, positions, prices, teams, team_counts, base, bank, single_gain, g) -> list[dict]:
    """Two transfers at once, e.g. downgrade one player to afford a better one elsewhere.

    Estimate every pair as gain(i -> j) + gain(k -> l), find the best estimates with a price-sorted
    running maximum, then score the top PAIR_RESCORE exactly (XI interactions make the sum inexact).
    """
    info = pool.info
    price = info["price"].astype(float)
    eps = 1e-6
    by_price = {}
    for k, opts in single_gain.items():
        s = sorted(opts, key=lambda o: price[o[1]])
        ps = [price[o[1]] for o in s]
        best, run = [], None                     # running best gain among players priced <= ps[n]
        for n, o in enumerate(s):
            if run is None or o[0] > s[run][0]:
                run = n
            best.append(run)
        by_price[k] = (s, ps, best)

    estimates = []
    n = len(squad)
    for i in range(n):
        for k in range(i + 1, n):
            budget = bank + prices[i] + prices[k]
            s, ps, best = by_price[k]
            for gain_j, j, _ in single_gain[i]:
                left = budget - price[j]
                idx = bisect.bisect_right(ps, left + eps) - 1
                if idx < 0:
                    continue
                gain_l, l, _ = s[best[idx]]
                if l == j:                       # same player twice: take the best other one
                    others = [o for o in s[:idx + 1] if o[1] != j]
                    if not others:
                        continue
                    gain_l, l, _ = max(others, key=lambda o: o[0])
                estimates.append((gain_j + gain_l, i, k, j, l))
    estimates.sort(key=lambda e: -e[0])

    out, seen = [], set()
    for _, i, k, j, l in estimates:
        if len(out) >= PAIR_RESCORE:
            break
        key = (i, k, frozenset((j, l)))
        if key in seen:
            continue
        seen.add(key)
        if not _club_ok(team_counts, [teams[i], teams[k]], [info.at[j, "team_id"], info.at[l, "team_id"]]):
            continue
        Xn = X.copy()
        Xn[i] = pool.xpts[pool.row[j], :g]
        Xn[k] = pool.xpts[pool.row[l], :g]
        per_gw = squad_points(Xn, positions) - base
        out.append({"out": [squad[i], squad[k]], "in": [j, l], "per_gw": per_gw,
                    "bank_after": bank + prices[i] + prices[k] - price[j] - price[l]})
    return out


# ---- the whole analysis --------------------------------------------------------------------

def chance_or_default(r: pd.Series) -> float:
    """FPL's chance of playing next gameweek; missing means 100 unless the player is out."""
    chance = r.get("chance_of_playing_next_round")
    if pd.isna(chance):
        return 0.0 if r.get("status") in OUT_STATUSES else 100.0
    return float(chance)


def availability_flag(r: pd.Series) -> str:
    """'out' (injured, suspended, left), 'doubtful' (< 100% chance) or 'fit'."""
    chance = r.get("chance_of_playing_next_round")
    if r.get("status") in OUT_STATUSES or chance == 0:
        return "out"
    if r.get("status") == "d" or (pd.notna(chance) and chance < 100):
        return "doubtful"
    return "fit"


def analyze_squad(pool: Pool, squad: list[int], bank: float, free_transfers: int, horizon: int | None = None,
                  top_n: int = 10, pairs: bool = True) -> dict:
    """Everything the My team page and the agent need, as plain data (element ids, floats)."""
    g = horizon or len(pool.gameweeks)
    gws = pool.gameweeks[:g]
    info = pool.info.loc[squad]
    X = pool.xpts[pool.rows(squad), :g]
    positions = info["position"].tolist()
    lineups = [best_xi(squad, positions, X[:, k].tolist()) for k in range(X.shape[1])]
    next_xi = lineups[0]
    sugg = suggest_transfers(pool, squad, bank, free_transfers, top_n=top_n, pairs=pairs, horizon=g)

    players = []
    for n, e in enumerate(squad):
        r = info.loc[e]
        players.append({
            "element": int(e), "xpts": [float(x) for x in X[n]], "xpts_total": float(X[n].sum()),
            "flag": availability_flag(r), "in_xi": e in next_xi.starters,
            "bench_order": next_xi.bench.index(e) + 1 if e in next_xi.bench else None,
            "is_captain": e == next_xi.captain, "is_vice_captain": e == next_xi.vice_captain,
        })
    by_total = sorted(players, key=lambda p: (p["xpts_total"], p["element"]))
    flagged = [p for p in players if p["flag"] != "fit"]
    weakest = list(dict.fromkeys([p["element"] for p in flagged if p["flag"] == "out"]
                                 + [p["element"] for p in by_total[:3]]
                                 + [p["element"] for p in flagged]))
    return {
        "gameweeks": gws, "players": players,
        "lineup": next_xi, "lineups": lineups, "squad_points_per_gw": [float(x) for x in sugg["base_per_gw"]],
        "weakest": weakest, "singles": sugg["singles"], "pairs": sugg["pairs"],
    }
