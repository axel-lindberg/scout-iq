"""Chat with the scout-iq agent in the terminal.

    python scripts/ask.py                          # interactive
    python scripts/ask.py "Who should I captain?"  # one question

Needs OPENAI_API_KEY (in the environment or a .env file). Set LANGSMITH_TRACING=true and
LANGSMITH_API_KEY to see every step in LangSmith.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dotenv import load_dotenv  # noqa: E402
from openai import OpenAI  # noqa: E402

from scout_iq.agent import ScoutAgent  # noqa: E402
from scout_iq.news import NewsIndex  # noqa: E402
from scout_iq.tools import ScoutTools  # noqa: E402
from scout_iq.upcoming import predict_next_gameweek  # noqa: E402


def main(argv: list[str]) -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    client = OpenAI()
    print("Loading data and predicting the next gameweek...")
    up = predict_next_gameweek()
    news = NewsIndex.build(up.players, client)
    agent = ScoutAgent(ScoutTools(up, news), client)
    print(f"scout-iq ready: {up.season} gameweek {up.gameweek} (first kickoff {up.deadline:%a %d %b %H:%M} UTC)\n")

    questions = [" ".join(argv)] if argv else None
    while True:
        q = questions.pop(0) if questions else input("You: ").strip()
        if not q or q.lower() in {"quit", "exit"}:
            break
        answer = agent.ask(q)
        tools_used = ", ".join(f"{t['tool']}({', '.join(f'{k}={v}' for k, v in t['args'].items())})"
                               for t in agent.trace)
        if tools_used:
            print(f"  [tools: {tools_used}]")
        print(f"\nscout-iq: {answer}\n")
        if argv:
            break


if __name__ == "__main__":
    main(sys.argv[1:])
