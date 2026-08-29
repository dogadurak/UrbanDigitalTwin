"""Resolve the commit that produced a result.

Every experiment output and every saved model records a git SHA. Until now that
SHA was the string ``"unknown"``: the service container has no ``git`` binary,
``subprocess`` failed, and the failure was swallowed. Results were therefore not
traceable to the code that produced them -- which is the one property a
reproducibility claim rests on.

Rather than install git into the image, this reads the repository's own files.
``.git/HEAD`` is either a detached SHA or a ref pointing at a file under
``.git/refs``; when a repository has been packed, the ref lives in
``.git/packed-refs`` instead. All three cases are handled, and the source of the
answer is reported so a reader knows whether it came from the environment, the
working tree, or nowhere.
"""

from __future__ import annotations

import os
import subprocess

#: Candidate repository roots, in order. The container mounts ai-service at
#: /app, so the repository .git is mounted separately at /repo/.git.
CANDIDATE_GIT_DIRS = ("/repo/.git", "/app/.git", ".git", "../.git", "../../.git")


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return None


def _from_git_dir(git_dir):
    head = _read(os.path.join(git_dir, "HEAD"))
    if not head:
        return None
    if not head.startswith("ref:"):
        return head if len(head) >= 7 else None

    ref = head[4:].strip()
    direct = _read(os.path.join(git_dir, ref))
    if direct:
        return direct

    # Packed repository: the ref lives in packed-refs.
    packed = _read(os.path.join(git_dir, "packed-refs"))
    if packed:
        for line in packed.splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[1].strip() == ref:
                return parts[0].strip()
    return None


def git_sha(short=False):
    """Best available commit SHA, or ``"unknown"``."""
    sha = os.environ.get("GIT_SHA")

    if not sha:
        try:
            sha = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True, timeout=5
            ).strip()
        except Exception:
            sha = None

    if not sha:
        for git_dir in CANDIDATE_GIT_DIRS:
            if os.path.isdir(git_dir):
                sha = _from_git_dir(git_dir)
                if sha:
                    break

    if not sha:
        return "unknown"
    return sha[:8] if short else sha


def provenance():
    """A small block to embed in any result file."""
    sha = git_sha()
    if os.environ.get("GIT_SHA"):
        source = "GIT_SHA environment variable"
    elif sha != "unknown":
        source = "repository files"
    else:
        source = "unavailable"
    return {
        "git_sha": sha,
        "git_sha_source": source,
        "traceable": sha != "unknown",
    }
