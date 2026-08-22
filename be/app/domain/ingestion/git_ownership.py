"""Derive per-model ownership from git history.

For a project whose artifacts live in a git working tree, we attribute each
file's authorship to git actors by **total lines added** (``git log --numstat``
summed per author). The top contributor is the model's "owner". We also record
the most recent commit's author + date so the UI can flag stale models.

One subprocess for the whole project subtree (not per file — dbt projects have
hundreds of models). Degrades to an empty map for upload-mode projects (no repo)
or any git failure — ownership is best-effort metadata, never fatal to ingestion.
"""

from __future__ import annotations

import logging
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

_GIT_TIMEOUT_S = 120
# Record separator embedded in --format so commit headers are unambiguous even if
# an author name contains a tab. "C\t<author>\t<iso-date>" per commit.
_COMMIT_FORMAT = "C%x09%an%x09%aI"


@dataclass
class OwnershipInfo:
    owner: str  # top contributor by lines added
    owner_share: float  # owner's lines / total attributed lines, 0..1
    contributor_count: int
    last_author: str  # author of the most recent commit touching the file
    last_modified_at: datetime  # timestamp of that commit


def compute(source_ref: str | None) -> dict[str, OwnershipInfo]:
    """Map file path (relative to ``source_ref``) -> OwnershipInfo.

    Returns ``{}`` when ``source_ref`` is unset or not a git working tree.
    """
    if not source_ref:
        return {}

    prefix = _run(["rev-parse", "--show-prefix"], source_ref)
    if prefix is None:  # not a git repo / git unavailable
        return {}
    prefix = prefix.strip()

    # `-C source_ref ... -- .` limits history to this subtree; --numstat paths are
    # still repo-root-relative, so strip `prefix` to match dbt original_file_path.
    out = _run(
        ["log", "--no-merges", "-M", "--use-mailmap", "--numstat", f"--format={_COMMIT_FORMAT}", "--", "."],
        source_ref,
    )
    if not out:
        return {}

    lines_by_author: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    last_touch: dict[str, tuple[str, datetime]] = {}

    cur_author: str | None = None
    cur_date: datetime | None = None
    for line in out.splitlines():
        if line.startswith("C\t"):
            _, _, rest = line.partition("\t")
            author, _, iso = rest.partition("\t")
            cur_author = author
            cur_date = _parse_iso(iso)
            continue
        if not line or cur_author is None:
            continue
        added_s, _, tail = line.partition("\t")
        deleted_s, _, raw_path = tail.partition("\t")
        if not raw_path:
            continue
        path = _resolve_path(raw_path.strip())
        if prefix and path.startswith(prefix):
            path = path[len(prefix) :]
        added = _to_int(added_s)  # binary files show "-"; treated as 0
        lines_by_author[path][cur_author] += added
        # git log is newest-first, so the first commit we see for a path is latest.
        if path not in last_touch and cur_date is not None:
            last_touch[path] = (cur_author, cur_date)

    result: dict[str, OwnershipInfo] = {}
    for path, authors in lines_by_author.items():
        total = sum(authors.values())
        owner, owner_lines = max(authors.items(), key=lambda kv: kv[1])
        last = last_touch.get(path)
        if last is None:
            continue
        result[path] = OwnershipInfo(
            owner=owner,
            owner_share=(owner_lines / total) if total else 0.0,
            contributor_count=len(authors),
            last_author=last[0],
            last_modified_at=last[1],
        )
    return result


def _run(args: list[str], cwd: str) -> str | None:
    """Run `git -C <cwd> <args>`; return stdout, or None on any failure."""
    try:
        proc = subprocess.run(
            ["git", "-C", cwd, *args],
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.info("git ownership skipped for %s: %s", cwd, exc)
        return None
    if proc.returncode != 0:
        logger.info("git ownership skipped for %s: %s", cwd, proc.stderr.strip())
        return None
    return proc.stdout


def _resolve_path(raw: str) -> str:
    """Resolve a --numstat path, following rename arrows to the new path.

    Rename forms: ``old => new`` and ``pre/{old => new}/post``.
    """
    if "=>" not in raw:
        return raw
    if "{" in raw and "}" in raw:
        pre, _, rest = raw.partition("{")
        mid, _, post = rest.partition("}")
        _, _, new = mid.partition("=>")
        return f"{pre}{new.strip()}{post}".replace("//", "/")
    _, _, new = raw.partition("=>")
    return new.strip()


def _to_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _parse_iso(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        return None
