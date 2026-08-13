"""Lightweight dbt-Jinja resolver used ONLY when a node has no ``compiled_code``.

Manifests produced by ``dbt parse`` carry ``raw_code`` (with ``{{ ref() }}`` /
``{{ source() }}`` / ``{{ config() }}``) but no compiled SQL. Rather than require
users to run ``dbt compile``, we resolve the three constructs that map directly
onto known physical relations from the manifest, so plain-SQL models still get
column lineage with zero setup.

This is deliberately NOT a Jinja engine: models using custom macros, ``var()``,
``this``, or ``{% %}`` control flow are left with residual Jinja and reported as
uncovered (see column_lineage fallback ladder). Providing compiled artifacts is
the path to full coverage.
"""

from __future__ import annotations

import re

_REF_RE = re.compile(r"\{\{\-?\s*ref\s*\((.*?)\)\s*\-?\}\}", re.DOTALL)
_SOURCE_RE = re.compile(r"\{\{\-?\s*source\s*\((.*?)\)\s*\-?\}\}", re.DOTALL)
_STRING_ARG_RE = re.compile(r"""['"]([^'"]+)['"]""")
_CONFIG_START_RE = re.compile(r"\{\{\-?\s*config\s*\(")


def has_residual_jinja(sql: str) -> bool:
    return "{{" in sql or "{%" in sql


def render(raw_code: str, ref_relations: dict[str, str], source_relations: dict[tuple[str, str], str]) -> str:
    sql = _strip_config(raw_code)

    def ref_sub(match: re.Match[str]) -> str:
        args = _STRING_ARG_RE.findall(match.group(1))
        if not args:
            return match.group(0)
        return ref_relations.get(args[-1], match.group(0))  # last positional arg is the model name

    def source_sub(match: re.Match[str]) -> str:
        args = _STRING_ARG_RE.findall(match.group(1))
        if len(args) >= 2:
            return source_relations.get((args[0], args[1]), match.group(0))
        return match.group(0)

    sql = _REF_RE.sub(ref_sub, sql)
    sql = _SOURCE_RE.sub(source_sub, sql)
    return sql


def _strip_config(sql: str) -> str:
    """Remove ``{{ config(...) }}`` blocks, balancing nested parens so dict/list
    arguments don't trip a naive regex."""
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        match = _CONFIG_START_RE.match(sql, i)
        if match:
            j = match.end()
            depth = 1
            while j < n and depth > 0:
                if sql[j] == "(":
                    depth += 1
                elif sql[j] == ")":
                    depth -= 1
                j += 1
            closing = re.match(r"\s*\-?\}\}", sql[j:])
            if closing:
                j += closing.end()
            i = j
            continue
        out.append(sql[i])
        i += 1
    return "".join(out)
