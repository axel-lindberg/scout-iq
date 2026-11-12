"""Retrieval (the R in RAG) over FPL injury and availability news.

Each player with a news item becomes one short document. Documents are embedded once with
OpenAI embeddings and cached on disk; a question is embedded the same way and the most
similar documents (cosine similarity) are returned for the LLM to read.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .data import ROOT

CACHE_DIR = ROOT / "data" / "processed"
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")


def news_documents(players: pd.DataFrame) -> pd.DataFrame:
    """One document per player with non-empty news."""
    p = players[players["news"].str.strip() != ""].copy()
    added = pd.to_datetime(p["news_added"], utc=True, errors="coerce").dt.strftime("%Y-%m-%d")
    chance = p["chance_of_playing_next_round"].map(lambda c: "" if pd.isna(c) else f" Chance of playing: {int(c)}%.")
    p["text"] = (p["name"] + " (" + p["web_name"] + ", " + p["team_name"] + ", " + p["position"] + "): "
                 + p["news"].str.strip() + ". Status: " + p["status_text"] + "." + chance
                 + " Updated " + added.fillna("unknown") + ".")
    return p[["element", "web_name", "team_name", "text"]].reset_index(drop=True)


def _embed(client, texts: list[str]) -> np.ndarray:
    out = []
    for i in range(0, len(texts), 256):
        resp = client.embeddings.create(model=EMBED_MODEL, input=texts[i:i + 256])
        out.extend(d.embedding for d in resp.data)
    v = np.asarray(out, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)  # unit length -> dot product = cosine


@dataclass
class NewsIndex:
    docs: pd.DataFrame
    vectors: np.ndarray
    client: object

    @classmethod
    def build(cls, players: pd.DataFrame, client) -> "NewsIndex":
        docs = news_documents(players)
        key = hashlib.sha1(json.dumps([EMBED_MODEL, *docs["text"]]).encode()).hexdigest()[:12]
        cache = CACHE_DIR / f"news_index_{key}.npy"
        if cache.exists():
            vectors = np.load(cache)
        else:
            vectors = _embed(client, docs["text"].tolist()) if len(docs) else np.zeros((0, 1), np.float32)
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            np.save(cache, vectors)
        return cls(docs, vectors, client)

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        if len(self.docs) == 0:
            return []
        q = _embed(self.client, [query])[0]
        scores = self.vectors @ q
        best = np.argsort(-scores)[:top_k]
        return [{"text": self.docs.loc[i, "text"], "score": round(float(scores[i]), 3)} for i in best]
