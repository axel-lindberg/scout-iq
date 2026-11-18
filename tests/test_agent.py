"""Agent, tools and retrieval tests. No network: OpenAI is replaced by small fakes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq.agent import ScoutAgent  # noqa: E402
from scout_iq.news import NewsIndex, news_documents  # noqa: E402
from scout_iq.tools import TOOL_SCHEMAS, ScoutTools  # noqa: E402
from scout_iq.upcoming import Upcoming  # noqa: E402


def _upcoming() -> Upcoming:
    rows = [
        # web_name, name, team, pos, price, xpts, chance, status, news
        ("Haaland", "Erling Haaland", "MCI", "FWD", 15.0, 6.0, 100, "available", ""),
        ("Saka", "Bukayo Saka", "ARS", "MID", 10.0, 5.0, 50, "doubtful", "Knock - 50% chance of playing"),
        ("Gabriel", "Gabriel dos Santos", "ARS", "DEF", 6.0, 4.0, 100, "available", ""),
        ("Injured", "Some Injured", "CHE", "MID", 7.0, 4.5, 0, "injured", "Hamstring - out for 6 weeks"),
    ]
    df = pd.DataFrame(rows, columns=["web_name", "name", "team_short", "position", "price", "xpts",
                                     "chance_of_playing", "status_text", "news"])
    df["element"] = range(1, len(df) + 1)
    df["team_name"] = df.team_short.map({"MCI": "Man City", "ARS": "Arsenal", "CHE": "Chelsea"})
    df["xpts_adjusted"] = df.xpts * df.chance_of_playing / 100
    df["fixtures"] = "XXX (H)"
    df["chance_of_playing_next_round"] = df.chance_of_playing
    df["news_added"] = "2026-10-12T15:00:00Z"
    for c in ("pts_last5", "mins_last3", "xgi_last5", "pts_season", "games"):
        df[c] = 1.0
    df = df.sort_values("xpts_adjusted", ascending=False).reset_index(drop=True)
    return Upcoming("2026-27", 7, pd.Timestamp("2026-10-17", tz="UTC"), df, df)


# ---- tools -------------------------------------------------------------------

def test_predictions_filter_and_rank():
    t = ScoutTools(_upcoming())
    names = [p["name"] for p in t.get_predictions()["players"]]
    assert names == ["Haaland", "Gabriel", "Saka"]           # ranked by adjusted xpts; injured hidden
    assert [p["name"] for p in t.get_predictions(position="def")["players"]] == ["Gabriel"]
    assert [p["name"] for p in t.get_predictions(max_price=9)["players"]] == ["Gabriel"]
    assert [p["name"] for p in t.get_predictions(team="Arsenal")["players"]] == ["Gabriel", "Saka"]
    assert "Injured" in [p["name"] for p in t.get_predictions(include_unavailable=True)["players"]]


def test_compare_players_fuzzy_names():
    t = ScoutTools(_upcoming())
    res = t.compare_players(["haland", "Bukayo Saka", "Nobody Atall"])
    assert [p["name"] for p in res["players"]] == ["Haaland", "Saka"]
    assert res["not_found"] == ["Nobody Atall"]


def test_name_matching_is_not_too_loose():
    up = _upcoming()
    extra = up.predictions.iloc[[2]].assign(web_name="Salia", name="Vakhtang Salia")
    extra2 = up.predictions.iloc[[2]].assign(web_name="Martinelli", name="Gabriel Martinelli")
    up.predictions = pd.concat([up.predictions, extra, extra2], ignore_index=True)
    t = ScoutTools(up)
    res = t.compare_players(["Salah", "Gabriel"])
    assert res["not_found"] == ["Salah"]                     # must not silently become "Salia"
    assert len(res["ambiguous"]["Gabriel"]) == 2              # two Gabriels -> ask the user


def test_bad_arguments_return_error_not_crash():
    t = ScoutTools(_upcoming())
    assert "error" in t.call("get_predictions", {"colour": "red"})
    assert "error" in t.call("no_such_tool", {})


# ---- retrieval ---------------------------------------------------------------

class FakeEmbeddings:
    """Bag-of-words 'embedding' so similarity is predictable without an API."""
    VOCAB = ["hamstring", "knock", "chance", "out", "arsenal", "chelsea"]

    def create(self, model, input):
        vecs = [[t.lower().count(w) + 0.01 for w in self.VOCAB] for t in input]
        return NS(data=[NS(embedding=v) for v in vecs])


def test_news_documents_and_search(tmp_path, monkeypatch):
    import scout_iq.news as news
    monkeypatch.setattr(news, "CACHE_DIR", tmp_path)
    up = _upcoming()
    docs = news_documents(up.players)
    assert len(docs) == 2                                     # only players with news
    idx = NewsIndex.build(up.players, NS(embeddings=FakeEmbeddings()))
    top = idx.search("hamstring injury", top_k=1)[0]["text"]
    assert "Some Injured" in top
    assert list(tmp_path.glob("news_index_*.npy"))            # embeddings cached


# ---- agent loop ----------------------------------------------------------------

def _tool_call(i, name, args):
    return NS(id=f"call_{i}", type="function", function=NS(name=name, arguments=json.dumps(args)))


class FakeChat:
    """Scripted model: first asks for a tool, then answers using what it got back."""

    def __init__(self):
        self.calls = []

    def create(self, model, messages, tools, temperature):
        self.calls.append(messages[:])
        tool_msgs = [m for m in messages if m["role"] == "tool"]
        if not tool_msgs:
            msg = NS(content=None, tool_calls=[_tool_call(1, "get_predictions", {"position": "FWD", "top_n": 1})])
        else:
            top = json.loads(tool_msgs[-1]["content"])["players"][0]["name"]
            msg = NS(content=f"Captain {top}.", tool_calls=None)
        return NS(choices=[NS(message=msg)])


def test_agent_runs_tool_then_answers():
    chat = FakeChat()
    agent = ScoutAgent(ScoutTools(_upcoming()), NS(chat=NS(completions=chat)))
    answer = agent.ask("Who should I captain?")
    assert answer == "Captain Haaland."
    assert agent.trace == [{"tool": "get_predictions", "args": {"position": "FWD", "top_n": 1}}]
    roles = [m["role"] for m in agent.messages]
    assert roles == ["system", "user", "assistant", "tool", "assistant"]
    assert "gameweek 7" in agent.messages[0]["content"]


def test_agent_stops_after_max_steps():
    class Loopy:
        def create(self, **kw):
            return NS(choices=[NS(message=NS(content=None, tool_calls=[_tool_call(1, "get_predictions", {})]))])
    agent = ScoutAgent(ScoutTools(_upcoming()), NS(chat=NS(completions=Loopy())))
    assert "step limit" in agent.ask("loop forever")


def test_system_prompt_names_the_horizon_and_its_uncertainty():
    up = _upcoming()
    up.gameweeks = [7, 8, 9, 10, 11]
    agent = ScoutAgent(ScoutTools(up), NS(chat=NS(completions=FakeChat())))
    prompt = agent.messages[0]["content"]
    assert "gameweeks 7-11" in prompt and "less certain" in prompt
    schema = next(t for t in TOOL_SCHEMAS if t["function"]["name"] == "get_predictions")
    assert "horizon" in schema["function"]["parameters"]["properties"]


# ---- my team ---------------------------------------------------------------------------

class TeamChat:
    """Scripted model: asks for analyze_my_team, then answers with the suggested sale and captain."""

    def __init__(self):
        self.calls = []

    def create(self, model, messages, tools, temperature):
        self.calls.append(messages[:])
        assert "analyze_my_team" in [t["function"]["name"] for t in tools]
        tool_msgs = [m for m in messages if m["role"] == "tool"]
        if not tool_msgs:
            return NS(choices=[NS(message=NS(content=None, tool_calls=[_tool_call(1, "analyze_my_team", {})]))])
        res = json.loads(tool_msgs[-1]["content"])
        if "error" in res:
            return NS(choices=[NS(message=NS(content=res["error"], tool_calls=None))])
        best = res["best_single_transfers"][0]
        return NS(choices=[NS(message=NS(
            content=f"Sell {best['sell'][0]} for {best['buy'][0]}. Captain {res['next_gameweek']['captain']}.",
            tool_calls=None))])


def test_agent_analyses_my_team_with_the_tool():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import team_data
    from test_team import BUYS
    up, ids = team_data.upcoming(extra=BUYS)
    chat = TeamChat()
    agent = ScoutAgent(ScoutTools(up), NS(chat=NS(completions=chat)))
    team = {"player_ids": ids, "bank": 0.0, "free_transfers": 1, "team_name": "Test FC"}
    answer = agent.ask("Who should I sell this week?", team=team)
    assert answer.startswith("Sell WeakMid for GoodMid (T20, £6.0m).")
    assert agent.trace == [{"tool": "analyze_my_team", "args": {}}]
    # The model was told once that a team is loaded, with the players' names.
    notes = [m["content"] for m in chat.calls[0] if m["role"] == "system"]
    assert len(notes) == 2 and '"Test FC"' in notes[1] and "WeakMid" in notes[1] and "1 free" in notes[1]
    tool_result = json.loads([m for m in agent.messages if m["role"] == "tool"][0]["content"])
    assert len(tool_result["next_gameweek"]["starting_xi"]) == 11
    assert tool_result["best_single_transfers"][0]["gain_per_gameweek"] == [8.0, 8.0]
    agent.ask("And again?", team=team)                     # same team: no second note
    assert sum(m["role"] == "system" for m in agent.messages) == 2


def test_agent_without_a_team_is_told_to_ask_for_one():
    agent = ScoutAgent(ScoutTools(_upcoming()), NS(chat=NS(completions=TeamChat())))
    assert "load their team on the My team page" in agent.ask("Who should I sell?")
