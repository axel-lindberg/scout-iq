"""The LLM agent: OpenAI tool calling in a loop, with optional LangSmith tracing.

Loop: send the conversation + tool schemas to the model. If it asks for tools, run them,
append the results, and ask again. When it answers in plain text, we're done.
"""

from __future__ import annotations

import json
import os

from .tools import TOOL_SCHEMAS, ScoutTools

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
MAX_STEPS = 6

SYSTEM_PROMPT = """You are scout-iq, a Fantasy Premier League assistant for gameweek {gw} of {season}.
Predictions cover gameweeks {first_gw}-{last_gw} (the tools' horizon argument).

Rules:
- Base every recommendation on tool results. Never invent players, prices, fixtures or points.
- Expected points come from a LightGBM model trained on past seasons. They are averages with a lot
  of uncertainty (typical error is about 1.9 points per player per match), so present them as
  estimates, not certainties.
- Predictions further ahead are less certain: they use each player's form as of today and only
  change the fixture (opponent, home/away), so they miss future form, rotation and injuries. Weight
  the next gameweek most and say so when advice depends on gameweeks 2+ weeks away. A blank
  gameweek (no fixture) is 0 points; a double gameweek adds up both fixtures.
- For transfers and planning use horizon (e.g. 5); for captaincy and this week's team use the next
  gameweek.
- The model does not read injury news. Check get_news or the chance_of_playing field for players
  you recommend, and say when availability changes the advice.
- Prefer expected_points_adjusted (expected points x chance of playing) when ranking.
- Be concise: lead with the recommendation, then 2-4 bullet points of reasons with numbers.
- If a tool reports a name as ambiguous, ask which player the user means. If a name is not
  found, say the player isn't in this season's squads; never substitute a similar name.
- Questions about "my team", "my squad", "who should I sell/bench/captain from my team": call
  analyze_my_team. It returns the best XI, captain, weakest players and transfers that respect the
  budget, positions and the 3-per-club rule, with 4-point hits already subtracted. Recommend from
  its results; don't build your own XI or transfers. If it says no team is loaded, ask the user to
  load it on the My team page. Mention that selling prices may be lower than today's prices.
- If the user asks about something the tools can't answer, say so."""

TEAM_NOTE = ("The user has loaded their FPL team{name} in the app: {players}. Bank £{bank}m, {ft} free "
             "transfer(s). Use analyze_my_team for questions about it.")


def _maybe_trace(client):
    """Wrap the OpenAI client for LangSmith if tracing is configured; otherwise a no-op."""
    noop = lambda **kw: (lambda f: f)  # noqa: E731
    if os.getenv("LANGSMITH_TRACING", "").lower() == "true" and os.getenv("LANGSMITH_API_KEY"):
        try:
            from langsmith import traceable
            from langsmith.wrappers import wrap_openai
            return wrap_openai(client), traceable
        except Exception as e:  # tracing must never break the agent
            print(f"[scout-iq] LangSmith tracing disabled: {e}")
    return client, noop


class ScoutAgent:
    def __init__(self, tools: ScoutTools, client, model: str = MODEL):
        self.tools = tools
        self.client, self._traceable = _maybe_trace(client)
        self.model = model
        gws = tools.up.gameweeks or [tools.up.gameweek]
        self.messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT.format(
            gw=tools.up.gameweek, season=tools.up.season, first_gw=gws[0], last_gw=gws[-1])}]
        self.trace: list[dict] = []  # tool calls made in the last ask(), for display and tests
        self.team: dict | None = None  # the user's squad, sent by the app with each message
        self.ask = self._traceable(name="scout-iq ask", run_type="chain")(self.ask)
        self._run_tool = self._traceable(name="tool", run_type="tool")(self._run_tool)

    def _run_tool(self, name: str, args: dict) -> dict:
        return self.tools.call(name, args, team=self.team)

    def set_team(self, team: dict | None) -> None:
        """Remember the user's squad; tell the model once whenever it changes."""
        if team == self.team:
            return
        self.team = team
        if team is None:
            note = "The user has cleared their team; analyze_my_team won't work until they load one."
        else:
            info = self.tools.pool.info
            names = [info.at[e, "web_name"] if e in info.index else str(e) for e in team.get("player_ids", [])]
            name = f" \"{team['team_name']}\"" if team.get("team_name") else ""
            note = TEAM_NOTE.format(name=name, players=", ".join(names), bank=team.get("bank", 0.0),
                                    ft=team.get("free_transfers", 1))
        self.messages.append({"role": "system", "content": note})

    def ask(self, question: str, team: dict | None = None) -> str:
        self.trace = []
        if team is not None or self.team is not None:
            self.set_team(team)
        self.messages.append({"role": "user", "content": question})
        for _ in range(MAX_STEPS):
            resp = self.client.chat.completions.create(
                model=self.model, messages=self.messages, tools=TOOL_SCHEMAS, temperature=0.2)
            msg = resp.choices[0].message
            if not msg.tool_calls:
                self.messages.append({"role": "assistant", "content": msg.content})
                return msg.content
            self.messages.append({
                "role": "assistant", "content": msg.content,
                "tool_calls": [{"id": c.id, "type": "function",
                                "function": {"name": c.function.name, "arguments": c.function.arguments}}
                               for c in msg.tool_calls],
            })
            for call in msg.tool_calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = self._run_tool(call.function.name, args)
                self.trace.append({"tool": call.function.name, "args": args})
                self.messages.append({"role": "tool", "tool_call_id": call.id,
                                      "content": json.dumps(result, default=str)})
        answer = "I couldn't finish within the step limit. Try a narrower question."
        self.messages.append({"role": "assistant", "content": answer})
        return answer
