"""team.py on small synthetic squads where the right answer can be worked out by hand.

The default squad (tests/team_data.py), every player 2 points per gameweek except WeakMid (0.5):
best XI = GK 2 + ten outfield players at 2 = 22, plus the captain's 2 again = 24 per gameweek.
WeakMid is on the bench (twelve outfield players score 2, only ten fit).
"""

from __future__ import annotations

import itertools
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scout_iq import team  # noqa: E402
from team_data import GAMEWEEKS, universe  # noqa: E402


def _pool(extra=None, squad=None):
    players, by_gw, ids = universe(extra, squad)
    return team.build_pool(players, by_gw, GAMEWEEKS), ids


def _names(pool, ids):
    return [pool.info.at[e, "web_name"] for e in ids]


# ---- rules -----------------------------------------------------------------------------

def test_valid_squad_and_every_rule_violation():
    pool, ids = _pool(extra=[(40, "Gk3", "GK", 3, 4.0, [1, 1]), (41, "Def5", "DEF", 3, 4.0, [1, 1]),
                             (42, "Def6", "DEF", 3, 4.0, [1, 1]), (43, "Def7", "DEF", 3, 4.0, [1, 1])])
    assert team.validate_squad(pool.info, ids) == []
    assert "A squad has 15 players, not 14." in team.validate_squad(pool.info, ids[:-1])
    three_gk = [40 if e == 10 else e for e in ids]
    errs = team.validate_squad(pool.info, three_gk)
    assert "2 GK needed, the squad has 3." in errs and "5 DEF needed, the squad has 4." in errs
    five_from_t3 = [41 if e == 11 else 42 if e == 12 else 43 if e == 13 else e for e in ids]  # + Def0, Mid0
    assert "At most 3 players per club: 5 from T3." in team.validate_squad(pool.info, five_from_t3)
    assert "The same player is in the squad twice." in team.validate_squad(pool.info, ids[:-1] + [ids[0]])
    assert "Unknown player id(s): 999." in team.validate_squad(pool.info, ids[:-1] + [999])


def test_hits():
    assert team.hits(1, 1) == 0 and team.hits(2, 1) == 4 and team.hits(3, 0) == 12 and team.hits(1, 5) == 0


# ---- best XI ---------------------------------------------------------------------------

def test_best_xi_by_hand():
    pool, ids = _pool()
    pos = pool.info.loc[ids, "position"].tolist()
    xi = team.best_xi(ids, pos, [float(x) for x in pool.xpts[pool.rows(ids), 0]])
    assert len(xi.starters) == 11 and 24 not in xi.starters        # WeakMid benched
    assert xi.points == pytest.approx(24.0)
    assert xi.bench[0] == 2                                           # reserve GK first on the bench
    assert xi.bench[-1] == 24                                         # then by expected points
    assert xi.captain != xi.vice_captain and {xi.captain, xi.vice_captain} <= set(xi.starters)


def test_best_xi_matches_brute_force_and_obeys_formation_rules():
    rng = np.random.default_rng(0)
    pos = ["GK"] * 2 + ["DEF"] * 5 + ["MID"] * 5 + ["FWD"] * 3
    ids = list(range(100, 115))
    for _ in range(200):
        x = rng.gamma(2.0, 1.5, size=15).round(2).tolist()
        xi = team.best_xi(ids, pos, x)
        p = {e: pos[ids.index(e)] for e in xi.starters}
        counts = {k: list(p.values()).count(k) for k in team.SQUAD_SHAPE}
        assert len(xi.starters) == 11 and counts["GK"] == 1
        assert counts["DEF"] >= 3 and counts["MID"] >= 2 and counts["FWD"] >= 1
        # Brute force: every choice of 10 outfield players that satisfies the minimums.
        gk = max(x[0], x[1])
        brute = max(sum(x[i] for i in c) for c in itertools.combinations(range(2, 15), 10)
                    if sum(2 <= i < 7 for i in c) >= 3 and sum(7 <= i < 12 for i in c) >= 2
                    and sum(i >= 12 for i in c) >= 1)
        best_in_xi = max(x[ids.index(e)] for e in xi.starters)
        assert xi.points == pytest.approx(gk + brute + best_in_xi)
        assert x[ids.index(xi.captain)] == pytest.approx(max(x))     # captain = best player
        X = np.array(x)[:, None]
        assert team.squad_points(X, np.array(pos))[0] == pytest.approx(xi.points)


def test_double_and_blank_gameweeks_in_the_xi():
    # Fwd0 blanks in GW 11 (0) and has a double in GW 12 (9 = two fixtures).
    squad = universe()[2]
    rows = [(e, *r) for e, r in zip(squad, [("Gk1", "GK", 1, 5.0, [2, 2]), ("Gk2", "GK", 2, 4.0, [2, 2])]
                                     + [(f"Def{i}", "DEF", 3 + i, 5.0, [2, 2]) for i in range(5)]
                                     + [(f"Mid{i}", "MID", 3 + i, 6.0, [2, 2]) for i in range(5)]
                                     + [("Fwd0", "FWD", 9, 6.0, [0, 9]), ("Fwd1", "FWD", 10, 6.0, [2, 2]),
                                        ("Fwd2", "FWD", 11, 6.0, [2, 2])])]
    pool, ids = _pool(squad=rows)
    a = team.analyze_squad(pool, ids, bank=0.0, free_transfers=1)
    assert 30 not in a["lineup"].starters                             # blank -> benched in GW 11
    assert 30 in a["lineups"][1].starters and a["lineups"][1].captain == 30   # double -> starts, captain
    assert [lu.points for lu in a["lineups"]] == pytest.approx(a["squad_points_per_gw"])
    assert a["squad_points_per_gw"][0] == pytest.approx(24.0)
    assert a["squad_points_per_gw"][1] == pytest.approx(2 + 9 * 2 + 9 + 9)   # starts and captains in GW 12
    fwd0 = next(p for p in a["players"] if p["element"] == 30)
    assert fwd0["xpts"] == [0.0, 9.0] and fwd0["xpts_total"] == 9.0


# ---- transfers -------------------------------------------------------------------------

BUYS = [
    (50, "GoodMid", "MID", 20, 6.0, [6, 6]),     # affordable for WeakMid (6.0)
    (51, "StarMid", "MID", 21, 9.0, [8, 8]),     # better but costs 3.0 more
    (52, "StarFwd", "FWD", 22, 12.0, [10, 10]),  # needs bank 6.0 for a 6.0 forward
]


def test_best_single_transfer_by_hand():
    # Selling WeakMid (bench, 0.5) for GoodMid (6): GoodMid starts and captains.
    # Per gameweek: 2 + 9 x 2 + 6 = 26, plus captain 6 = 32 -> gain 32 - 24 = 8. Over 2 GWs: 16.
    # Selling a 2-point midfielder instead gains the same (WeakMid stays benched, bench points
    # count for nothing), so ties go to selling the player with fewer expected points.
    pool, ids = _pool(extra=BUYS)
    s = team.suggest_transfers(pool, ids, bank=0.0, free_transfers=1, pairs=False)["singles"]
    best = s[0]
    assert best["out"] == [24] and best["in"] == [50]
    assert best["per_gw"].tolist() == pytest.approx([8.0, 8.0])
    assert best["gain"] == pytest.approx(16.0) and best["hits"] == 0 and best["net_gain"] == pytest.approx(16.0)
    assert best["bank_after"] == pytest.approx(0.0)
    assert all(51 not in c["in"] and 52 not in c["in"] for c in s)   # over budget


def test_budget_includes_the_outgoing_price_and_the_bank():
    pool, ids = _pool(extra=BUYS)
    # Bank 6.0: StarFwd (12.0) for a 6.0 forward. 2 + 9 x 2 + 10 = 30, + captain 10 = 40 -> 16 per GW.
    best = team.suggest_transfers(pool, ids, bank=6.0, free_transfers=1, pairs=False)["singles"][0]
    assert best["in"] == [52] and best["out"][0] in (30, 31, 32)
    assert best["gain"] == pytest.approx(32.0) and best["bank_after"] == pytest.approx(0.0)
    # 0.1 short: not allowed.
    s = team.suggest_transfers(pool, ids, bank=5.9, free_transfers=1, pairs=False)["singles"]
    assert all(52 not in c["in"] for c in s)


def test_hit_is_subtracted():
    pool, ids = _pool(extra=BUYS)
    best = team.suggest_transfers(pool, ids, bank=0.0, free_transfers=0, pairs=False)["singles"][0]
    assert best["hits"] == 4 and best["net_gain"] == pytest.approx(16.0 - 4)


def test_club_limit_respected():
    # Def0 and Mid0 play for T3; T3Def replaces Def1, so the squad has 3 from T3. T3Star (a T3
    # midfielder) can then only come in for a T3 player: Mid0.
    pool, ids = _pool(extra=[(53, "T3Star", "MID", 3, 6.0, [7, 7]), (54, "T3Def", "DEF", 3, 5.0, [2, 2])])
    squad = [54 if e == 11 else e for e in ids]
    assert team.validate_squad(pool.info, squad) == []
    s = team.suggest_transfers(pool, squad, bank=0.0, free_transfers=1, top_n=100, pairs=False)["singles"]
    assert [c["out"] for c in s if c["in"] == [53]] == [[20]]             # Mid0 only, not WeakMid
    assert all(c["in"][0] not in squad for c in s)                         # never buy someone already owned
    assert all(pool.info.at[c["in"][0], "position"] == pool.info.at[c["out"][0], "position"] for c in s)


def test_pair_downgrade_to_afford_an_upgrade():
    # StarMid (9.0, 8 pts) is 3.0 too expensive for WeakMid. Selling Def0 (5.0, 2 pts, would be
    # benched) for CheapDef (2.0, 2 pts) frees exactly 3.0. Pair gain per GW: StarMid starts and
    # captains: 2 + 9 x 2 + 8 + 8 = 36 vs 24 -> 12 per GW, 24 over 2 GWs, better than GoodMid's 16.
    pool, ids = _pool(extra=BUYS + [(55, "CheapDef", "DEF", 23, 2.0, [2, 2])])
    res = team.suggest_transfers(pool, ids, bank=0.0, free_transfers=2, pairs=True)
    best = res["pairs"][0]
    assert sorted(best["in"]) == [51, 55] and 24 in best["out"]
    assert best["gain"] == pytest.approx(24.0) and best["hits"] == 0
    assert best["bank_after"] == pytest.approx(0.0)
    # With one free transfer the pair costs a 4-point hit.
    res1 = team.suggest_transfers(pool, ids, bank=0.0, free_transfers=1, pairs=True)
    assert res1["pairs"][0]["hits"] == 4 and res1["pairs"][0]["net_gain"] == pytest.approx(20.0)


def test_analysis_flags_weak_and_unavailable_players_and_is_deterministic():
    squad = [(e, *r) for e, r in zip(universe()[2], [("Gk1", "GK", 1, 5.0, [2, 2]), ("Gk2", "GK", 2, 4.0, [2, 2])]
                                     + [(f"Def{i}", "DEF", 3 + i, 5.0, [2, 2]) for i in range(5)]
                                     + [(f"Mid{i}", "MID", 3 + i, 6.0, [2, 2]) for i in range(4)]
                                     + [("WeakMid", "MID", 8, 6.0, [0.5, 0.5])]
                                     + [(f"Fwd{i}", "FWD", 9 + i, 6.0, [2, 2]) for i in range(3)])]
    squad[3] = (11, "Hurt", "DEF", 4, 5.0, [0, 0], "i", 0, "Knee injury - Unknown return date")
    pool, ids = _pool(squad=squad, extra=BUYS)
    a = team.analyze_squad(pool, ids, bank=0.0, free_transfers=1)
    assert a["weakest"][0] == 11                                      # injured first
    assert 24 in a["weakest"]                                         # lowest expected points
    hurt = next(p for p in a["players"] if p["element"] == 11)
    assert hurt["flag"] == "out" and not hurt["in_xi"]
    b = team.analyze_squad(pool, ids, bank=0.0, free_transfers=1)
    assert [c["in"] for c in a["singles"]] == [c["in"] for c in b["singles"]]
    assert a["lineup"] == b["lineup"]
