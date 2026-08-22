"""Unit tests for git-based ownership (self-contained temp git repos)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.domain.ingestion import git_ownership


def _git(repo: Path, *args: str, author: str | None = None) -> None:
    env = None
    if author:
        name, email = author, f"{author.lower()}@example.com"
        env = {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
        }
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=_full_env(env))


def _full_env(extra: dict[str, str] | None) -> dict[str, str]:
    import os

    env = dict(os.environ)
    # Deterministic dates so "most recent" ordering is stable.
    env.setdefault("GIT_AUTHOR_DATE", "2020-01-01T00:00:00+00:00")
    env.setdefault("GIT_COMMITTER_DATE", "2020-01-01T00:00:00+00:00")
    if extra:
        env.update(extra)
    return env


def _commit(repo: Path, path: str, content: str, author: str, when: str) -> None:
    file = repo / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)
    _git(repo, "add", path, author=author)
    env = {"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when}
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", f"touch {path}"],
        check=True,
        capture_output=True,
        text=True,
        env=_full_env(
            {
                **env,
                "GIT_AUTHOR_NAME": author,
                "GIT_AUTHOR_EMAIL": f"{author.lower()}@example.com",
                "GIT_COMMITTER_NAME": author,
                "GIT_COMMITTER_EMAIL": f"{author.lower()}@example.com",
            }
        ),
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    return tmp_path


def test_owner_is_top_line_contributor(repo: Path) -> None:
    # Alice adds 5 lines, Bob later adds 1 line to the same file.
    _commit(repo, "models/foo.sql", "a\nb\nc\nd\ne\n", "Alice", "2021-01-01T00:00:00+00:00")
    _commit(repo, "models/foo.sql", "a\nb\nc\nd\ne\nf\n", "Bob", "2022-06-01T00:00:00+00:00")

    result = git_ownership.compute(str(repo))

    assert "models/foo.sql" in result
    info = result["models/foo.sql"]
    assert info.owner == "Alice"  # 5 lines vs 1
    assert info.contributor_count == 2
    assert 0.5 < info.owner_share <= 1.0
    # Bob's commit is newest → last touch.
    assert info.last_author == "Bob"
    assert info.last_modified_at is not None
    assert info.last_modified_at.year == 2022


def test_non_repo_and_empty_return_empty() -> None:
    assert git_ownership.compute("") == {}
    assert git_ownership.compute(None) == {}


def test_plain_directory_returns_empty(tmp_path: Path) -> None:
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "x.sql").write_text("select 1\n")
    assert git_ownership.compute(str(tmp_path)) == {}
