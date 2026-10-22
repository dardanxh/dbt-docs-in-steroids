"""Deterministic redundancy finder: pairs of models that look like they do the
same job and could be merged into one reusable model.

Three signals, each a Jaccard similarity in 0..1:
- inputs:  overlap of the two models' direct upstream sets
- columns: overlap of their output column names (case-insensitive)
- sql:     overlap of 3-token shingles of their normalized SQL

The score is a weighted mean over the signals that are available (a model with
no known columns, or no SQL, just drops that signal). Candidates are only pairs
that share at least one direct input, which keeps this cheap on large projects.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

WEIGHTS = {"inputs": 0.35, "columns": 0.35, "sql": 0.30}
# A parent with more children than this (e.g. a giant raw source) is skipped as
# a candidate generator; pairs under it are still found via their other inputs.
MAX_BUCKET = 200

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/|\{#.*?#\}", re.S)
_TOKEN = re.compile(r"[a-z_][a-z0-9_]*|\d+|[^\s\w]")


@dataclass(frozen=True)
class ModelInput:
    id: str
    parents: frozenset[str]
    columns: frozenset[str]
    sql: str | None


@dataclass(frozen=True)
class Pair:
    a: str
    b: str
    score: float
    input_overlap: float
    column_overlap: float | None
    sql_similarity: float | None
    shared_inputs: int
    shared_columns: int
    direct_link: bool  # one of the two reads the other


def jaccard(x: frozenset[str], y: frozenset[str]) -> float:
    union = len(x | y)
    return len(x & y) / union if union else 0.0


def shingles(sql: str, k: int = 3) -> frozenset[str]:
    tokens = _TOKEN.findall(_COMMENTS.sub(" ", sql.lower()))
    return frozenset(" ".join(tokens[i : i + k]) for i in range(len(tokens) - k + 1))


def find_redundant(models: list[ModelInput], min_score: float = 0.5, limit: int = 50) -> list[Pair]:
    by_id = {m.id: m for m in models}
    sql_sets = {m.id: shingles(m.sql) for m in models if m.sql}

    buckets: dict[str, list[str]] = defaultdict(list)
    for m in models:
        for p in m.parents:
            buckets[p].append(m.id)
    candidates: set[tuple[str, str]] = set()
    for ids in buckets.values():
        if len(ids) > MAX_BUCKET:
            continue
        for x, y in combinations(sorted(ids), 2):
            candidates.add((x, y))

    pairs: list[Pair] = []
    for x, y in candidates:
        a, b = by_id[x], by_id[y]
        signals = {"inputs": jaccard(a.parents, b.parents)}
        col = jaccard(a.columns, b.columns) if a.columns and b.columns else None
        if col is not None:
            signals["columns"] = col
        sql = jaccard(sql_sets[x], sql_sets[y]) if x in sql_sets and y in sql_sets else None
        if sql is not None:
            signals["sql"] = sql
        total_w = sum(WEIGHTS[k] for k in signals)
        score = sum(WEIGHTS[k] * v for k, v in signals.items()) / total_w
        if score < min_score:
            continue
        pairs.append(
            Pair(
                a=x,
                b=y,
                score=round(score, 3),
                input_overlap=round(signals["inputs"], 3),
                column_overlap=None if col is None else round(col, 3),
                sql_similarity=None if sql is None else round(sql, 3),
                shared_inputs=len(a.parents & b.parents),
                shared_columns=len(a.columns & b.columns),
                direct_link=x in b.parents or y in a.parents,
            )
        )
    pairs.sort(key=lambda p: (-p.score, p.a, p.b))
    return pairs[:limit]
