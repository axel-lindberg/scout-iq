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

Rules:
- Base every recommendation on tool results. Never invent players, prices, fixtures or points.
- Expected points come from a LightGBM model trained on past seasons. They are averages with a lot
  of uncertainty (typical error is about 1.9 points per player per match), so present them as
  estimates, not certainties.
- The model does not read injury news. Check get_news or the chance_of_playing field for players
  you recommend, and say when availability changes the advice.
- Prefer expected_points_adjusted (expected points x chance of playing) when ranking.
- Be concise: lead with the recommendation, then 2-4 bullet points of reasons with numbers.
- If a tool reports a name as ambiguous, ask which player the user means. If a name is not
  found, say the player isn't in this season's squads; never substitute a similar name.
- If the user asks about something the tools can't answer, say so."""


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
        self.messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT.format(
            gw=tools.up.gameweek, season=tools.up.season)}]
        self.trace: list[dict] = []  # tool calls made in the last ask(), for display and tests
        self.ask = self._traceable(name="scout-iq ask", run_type="chain")(self.ask)
        self._run_tool = self._traceable(name="tool", run_type="tool")(self._run_tool)

    def _run_tool(self, name: str, args: dict) -> dict:
        return self.tools.call(name, args)

    def ask(self, question: str) -> str:
        self.trace = []
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
