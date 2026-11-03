# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Audits a Python repository against the builder-skills standard.

uv as the package and Python manager (pyproject.toml, a committed uv.lock, .python-version), Ruff as formatter and
linter (pinned in uv.lock, run only from .venv), a pre-commit hook turned on by scripts/setup.sh that formats staged
files and never commits unstaged edits, and CI that refuses unformatted code. Checks behaviour, not file names: any
hook manager passes if it does the right thing in a fresh copy.

    uv run audit.py <repo> [--ref <rev> | --working-tree] [--no-behavior] [--json]

Every check reads one snapshot of the repository, in a temporary directory: the committed HEAD by default, another
commit with --ref (e.g. origin/main), or with --working-tree the files on disk (tracked and untracked, not ignored).
The repository itself is never touched. Exit 1 if any check fails, 2 on bad usage.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

checks: list[dict[str, str]] = []


def add(id: str, status: str, detail: str, fix: str | None = None) -> None:
    checks.append({"id": id, "status": status, "detail": detail, **({"fix": fix} if fix else {})})


def run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None, stdin: str | None = None):
    return subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, input=stdin, capture_output=True, text=True)


def git(cwd: Path, *args: str):
    return run(["git", *args], cwd)


parser = argparse.ArgumentParser(description="Audit a Python repository against the builder-skills standard")
parser.add_argument("repo")
where = parser.add_mutually_exclusive_group()
where.add_argument("--ref")
where.add_argument("--working-tree", action="store_true")
parser.add_argument("--no-behavior", action="store_true")
parser.add_argument("--json", action="store_true")
opts = parser.parse_args()

root = git(Path(opts.repo), "rev-parse", "--show-toplevel")
if root.returncode != 0:
    print(f"{opts.repo} is not a git repository", file=sys.stderr)
    sys.exit(2)
source = Path(root.stdout.strip())
tmp = Path(tempfile.mkdtemp(prefix="audit-py-"))
top = tmp / "repo"


def snapshot() -> str:
    """Copies what is audited into `top`, as a one-commit repository; returns what it is, for the report."""
    top.mkdir()
    if opts.working_tree:
        files = git(source, "ls-files", "-co", "--exclude-standard").stdout.splitlines()
        for f in files:
            if (source / f).is_file():  # deleted on disk, not yet staged: skip
                (top / f).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source / f, top / f)
        label = "working tree"
    else:
        rev = opts.ref or "HEAD"
        sha = git(source, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}")
        if sha.returncode != 0:
            print(f"{rev} is not a commit in {source}", file=sys.stderr)
            shutil.rmtree(tmp, ignore_errors=True)
            sys.exit(2)
        archive = subprocess.run(["git", "-C", str(source), "archive", sha.stdout.strip()], capture_output=True)
        subprocess.run(["tar", "-x", "-C", str(top)], input=archive.stdout, check=True)
        label = f"{rev} ({sha.stdout.strip()[:7]})"
    git(top, "init", "-q")
    for k, v in [("user.email", "audit@example.com"), ("user.name", "audit"), ("commit.gpgsign", "false")]:
        git(top, "config", k, v)
    git(top, "add", "-A")
    git(top, "commit", "-q", "--no-verify", "-m", "audited snapshot")
    return label


audited = snapshot()
tracked = set(git(top, "ls-files").stdout.splitlines())


def text_of(f: str) -> str:
    try:
        return (top / f).read_text()
    except (OSError, UnicodeDecodeError):
        return ""


def code(t: str) -> str:
    """Shell and YAML comments mention tools without running them."""
    return "\n".join(line for line in t.splitlines() if not line.lstrip().startswith("#"))


def report():
    shutil.rmtree(tmp, ignore_errors=True)
    failed = sum(c["status"] == "fail" for c in checks)
    if opts.json:
        print(json.dumps({"repo": str(source), "audited": audited, "failed": failed, "checks": checks}, indent=2))
    else:
        print(f"python-repo-standard audit: {source} at {audited}")
        for c in checks:
            fix = f"\n     fix: {c['fix']}" if c.get("fix") and c["status"] != "pass" else ""
            print(f"{c['status'].upper():4} {c['id']}: {c['detail']}{fix}")
        print(f"\n{failed} check(s) failed" if failed else "\nall required checks pass")
    sys.exit(1 if failed else 0)


# --- project and package manager: uv ------------------------------------------------------------------------------
# Without a pyproject.toml every other check still runs (on empty settings), so the report lists all the gaps.
pyproject: dict = {}
if "pyproject.toml" not in tracked:
    add(
        "py.pyproject",
        "fail",
        "no pyproject.toml at the repository root",
        "uv init --bare (or copy assets/pyproject.toml); uv add -r requirements.in to bring the dependencies over",
    )
else:
    try:
        pyproject = tomllib.loads(text_of("pyproject.toml"))
    except tomllib.TOMLDecodeError as e:
        add("py.pyproject", "fail", f"pyproject.toml does not parse: {e}")

if "uv.lock" in tracked:
    add("pm.lockfile", "pass", "uv.lock is committed")
else:
    add("pm.lockfile", "fail", "no committed uv.lock", "uv lock, then commit uv.lock")
others = [f for f in ("poetry.lock", "Pipfile", "Pipfile.lock", "pdm.lock") if f in tracked]
if others:
    add(
        "pm.single",
        "fail",
        f"other package managers' files are committed: {', '.join(others)}",
        "uv is the package manager: move the dependencies to pyproject.toml, git rm these",
    )
# requirements files are fine only as an export of uv.lock (a Dockerfile may install from one).
reqs = [f for f in tracked if re.fullmatch(r"(.*/)?requirements[\w.-]*\.(txt|in)", f)]
hand = [
    f
    for f in reqs
    if not text_of(f).startswith("# This file was autogenerated by uv via the following command:\n#    uv export")
]
if hand:
    add(
        "pm.requirements",
        "fail",
        f"requirements files not exported from uv.lock: {', '.join(sorted(hand))}",
        "dependencies live in pyproject.toml; if a Dockerfile needs a file, generate it:"
        " uv export --locked --no-dev -o requirements.txt",
    )
if ".python-version" in tracked:
    add("py.version", "pass", f".python-version pins {text_of('.python-version').strip()}")
else:
    add("py.version", "fail", "no committed .python-version", "uv python pin <version>, then commit .python-version")
if not (pyproject.get("project") or {}).get("requires-python"):
    add("py.requires-python", "warn", "[project] has no requires-python", 'requires-python = ">=<the pinned version>"')

# --- Ruff ---------------------------------------------------------------------------------------------------------
groups = pyproject.get("dependency-groups") or {}
dev = [d for g in groups.values() for d in g if isinstance(d, str)]
dev += [d for d in ((pyproject.get("tool") or {}).get("uv") or {}).get("dev-dependencies", []) if isinstance(d, str)]
ruff_pin = next((d for d in dev if re.match(r"ruff\b", d)), None)
if ruff_pin and re.fullmatch(r"ruff==\d+\.\d+\.\d+", ruff_pin.replace(" ", "")):
    add("ruff.dependency", "pass", f"{ruff_pin} in a dependency group")
elif ruff_pin:
    add("ruff.dependency", "fail", f"{ruff_pin}: not an exact version", "uv add --dev ruff==<version>")
else:
    add("ruff.dependency", "fail", "ruff is not a dev dependency", "uv add --dev ruff==<version>")
loose = [d for d in [*((pyproject.get("project") or {}).get("dependencies") or []), *dev] if "==" not in d]
if loose:
    add(
        "deps.exact",
        "warn",
        f"{len(loose)} dependencies without an exact pin (e.g. {', '.join(loose[:3])})",
        "uv.lock pins them; pin in pyproject too when the version matters (uv add <pkg>==<version>)",
    )
ruff_cfg = "ruff.toml" in tracked or ".ruff.toml" in tracked or "ruff" in (pyproject.get("tool") or {})
add(
    "ruff.config",
    "pass" if ruff_cfg else "warn",
    "Ruff configured (line length, rules)" if ruff_cfg else "no [tool.ruff] or ruff.toml: Ruff's defaults apply",
    "copy [tool.ruff] from assets/pyproject.toml",
)
for f in ("black", "isort", "flake8", "autopep8", "yapf"):
    if any(re.match(rf"{f}\b", d) for d in dev):
        add(
            "ruff.single",
            "warn",
            f"also depends on {f}",
            "Ruff formats and lints: remove it once Ruff covers the same files",
        )

hook_files = [f for f in tracked if f.startswith((".githooks/", ".husky/"))]
ci_files = sorted(f for f in tracked if re.fullmatch(r"\.github/workflows/[^/]+\.ya?ml", f))
invocations = [
    (f, code(text_of(f)))
    for f in [*hook_files, *ci_files, ".pre-commit-config.yaml", "lefthook.yml", "Makefile", "scripts/setup.sh"]
    if f in tracked
]
downloaders = [f for f, t in invocations if re.search(r"\b(uvx|uv tool run|pipx run)\b[^\n]*\bruff\b", t)]
if downloaders:
    add(
        "ruff.no-download",
        "fail",
        f"runs Ruff through a download runner in {', '.join(downloaders)}",
        "call the pinned Ruff through scripts/ruff.sh (assets/scripts/ruff.sh)",
    )

if not re.search(r"^/?\.venv/?$", text_of(".gitignore"), re.M):
    add("gitignore.venv", "fail", ".venv is not in .gitignore", "add .venv to .gitignore")

# --- CI -----------------------------------------------------------------------------------------------------------
ci = "\n".join(code(text_of(f)) for f in ci_files)
if not ci_files:
    add("ci.workflow", "fail", "no .github/workflows/*.yml", "copy assets/ci.yml")
else:
    other = re.search(r"\b(pip install|pip-sync|poetry install|pipenv install|uv pip install)\b[^\n]*", ci)
    if other:
        add(
            "ci.locked-install",
            "fail",
            f"CI installs with {other.group(0).strip()}",
            "uv sync --locked, everywhere CI installs",
        )
    elif re.search(r"\buv sync\b[^\n]*--locked", ci):
        add("ci.locked-install", "pass", "CI installs with uv sync --locked")
    elif re.search(r"\buv sync\b[^\n]*--frozen", ci):
        # --frozen installs from uv.lock without checking it: a pyproject change missing from the lock goes unnoticed.
        add(
            "ci.locked-install",
            "fail",
            "CI installs with uv sync --frozen, which never checks that uv.lock matches pyproject.toml",
            "uv sync --locked",
        )
    else:
        add("ci.locked-install", "fail", "CI never installs with uv sync --locked", "a run step: uv sync --locked")
    lines = ci.splitlines()
    fmt = any(re.search(r"\bruff(\.sh)?\s+format\b.*--check", s) for s in lines)
    lint = any(re.search(r"\bruff(\.sh)?\s+check\b", s) and "--fix" not in s for s in lines)
    add(
        "ci.format-check",
        "pass" if fmt else "fail",
        "CI runs ruff format --check" if fmt else "CI never runs ruff format --check",
        "sh scripts/ruff.sh format --check .",
    )
    add(
        "ci.lint",
        "pass" if lint else "fail",
        "CI runs ruff check (no --fix)" if lint else "CI never runs ruff check without --fix",
        "sh scripts/ruff.sh check .",
    )
    if not re.search(r"\bpytest\b|\bunittest\b", ci):
        add("ci.tests", "warn", "CI runs no tests", "uv run --locked pytest")


# --- behaviour in a fresh copy --------------------------------------------------------------------------------------
def behaviour() -> None:
    # A fake `ruff` first on PATH: if anything runs it, the repo would run whatever Ruff a machine happens to have.
    fake = tmp / "fake-bin"
    marker = tmp / "fake-ruff-ran"
    fake.mkdir()
    (fake / "ruff").write_text(f'#!/bin/sh\necho "$@" >> "{marker}"\nexit 0\n')
    (fake / "ruff").chmod(0o755)
    env = {"PATH": f"{fake}:{os.environ['PATH']}"}

    if "scripts/setup.sh" not in tracked:
        add(
            "setup.script",
            "fail",
            "no scripts/setup.sh: nothing turns the hook on after a clone",
            "copy assets/scripts/setup.sh (uv sync --locked, then core.hooksPath) and name it in the README",
        )
        return
    setup = run(["sh", "scripts/setup.sh"], top, env)
    if setup.returncode != 0:
        tail = (setup.stderr.strip().splitlines() or [""])[-1]
        add(
            "setup.script",
            "fail",
            f"sh scripts/setup.sh failed: {tail}",
            "it must work in a fresh clone: uv sync --locked needs a uv.lock that matches pyproject.toml (uv lock)",
        )
        return
    add("setup.script", "pass", "sh scripts/setup.sh works in a fresh copy")
    if marker.exists():
        add("ruff.pinned-only", "fail", "setup ran a ruff found on PATH")
        marker.unlink()

    hooks_path = git(top, "config", "core.hooksPath").stdout.strip()
    hook = top / hooks_path / "pre-commit" if hooks_path else top / ".git/hooks/pre-commit"
    if not hook.exists():
        add(
            "hook.active",
            "fail",
            "after scripts/setup.sh there is no pre-commit hook",
            "setup.sh turns it on: git config core.hooksPath .githooks (or pre-commit install)",
        )
        return
    via = f"core.hooksPath {hooks_path}" if hooks_path else ".git/hooks/pre-commit"
    add("hook.active", "pass", f"scripts/setup.sh turns on a pre-commit hook ({via})")
    hook_cases(env, marker)


def hook_cases(env: dict[str, str], marker: Path) -> None:
    ruff = top / ".venv/bin/ruff"
    if not ruff.exists():
        add("hook.cases", "warn", ".venv has no ruff after setup; hook behaviour not tested")
        return
    ugly = "probe   =  {  'value':1  }\n"
    existing = sorted({str(Path(f).parent) for f in tracked if f.endswith(".py")} | {".", "src"})

    def format_as(path: str) -> str:
        p = run([str(ruff), "format", f"--stdin-filename={path}", "-"], top, stdin=ugly)
        return p.stdout if p.returncode == 0 else ""

    probe_dir = next(
        (
            ("" if d == "." else f"{d}/")
            for d in existing
            if (out := format_as(f"{'' if d == '.' else d + '/'}audit_probe.py")) and out != ugly
        ),
        None,
    )
    if probe_dir is None:
        add("hook.cases", "warn", "the project's Ruff formats none of the probe paths; hook behaviour not tested")
        return
    expected = format_as(f"{probe_dir}audit_probe.py")
    unstaged = "# UNSTAGED EDIT\n"
    results: list[str] = []
    bad = False

    def write(f: str, s: str) -> None:
        (top / f).parent.mkdir(parents=True, exist_ok=True)
        (top / f).write_text(s)

    def commit():
        return run(["git", "commit", "-q", "-m", "audit probe"], top, env)

    def base(f: str) -> None:
        write(f, expected)
        git(top, "add", f)
        run(["git", "commit", "-q", "--no-verify", "-m", "base"], top)

    def head(f: str) -> str:
        return git(top, "show", f"HEAD:{f}").stdout

    def reset() -> None:
        git(top, "reset", "-q", "--hard", "HEAD")
        git(top, "clean", "-qfd", "--", probe_dir or ".")

    # 1. A staged, unformatted new file: the commit must end up formatted (or be refused).
    f1 = f"{probe_dir}audit_probe_a.py"
    write(f1, ugly)
    git(top, "add", f1)
    c1 = commit()
    if c1.returncode == 0 and head(f1) == expected:
        results.append("formats a staged file")
    elif c1.returncode == 0:
        bad = True
        results.append("COMMITTED AN UNFORMATTED FILE")
    else:
        results.append("refuses an unformatted file (does not format it: warn)")
    reset()

    # 2-4. Staged then edited again (new, modified, renamed file): the unstaged edit must never be committed.
    def am() -> str:
        f = f"{probe_dir}audit_probe_b.py"
        write(f, ugly)
        git(top, "add", f)
        write(f, ugly + unstaged)
        return f

    def mm() -> str:
        f = f"{probe_dir}audit_probe_c.py"
        base(f)
        write(f, ugly)
        git(top, "add", f)
        write(f, ugly + unstaged)
        return f

    def rm() -> str:
        f, g = f"{probe_dir}audit_probe_d.py", f"{probe_dir}audit_probe_e.py"
        base(f)
        git(top, "mv", f, g)
        write(g, ugly + unstaged)
        return g

    for name, setup in [
        ("AM (new file edited after staging)", am),
        ("MM (modified file edited after staging)", mm),
        ("RM (renamed file edited after staging)", rm),
    ]:
        f = setup()
        c = commit()
        if c.returncode == 0 and "UNSTAGED" in head(f):
            bad = True
            results.append(f"{name}: COMMITTED THE UNSTAGED EDIT")
        else:
            results.append(f"{name}: {'committed only the staged content' if c.returncode == 0 else 'refused'}")
        reset()

    # 5. A staged file plus an unrelated unstaged edit elsewhere: should commit, without that edit.
    f5, g5 = f"{probe_dir}audit_probe_f.py", f"{probe_dir}audit_probe_g.py"
    base(g5)
    write(f5, ugly)
    git(top, "add", f5)
    write(g5, expected + unstaged)
    c5 = commit()
    if c5.returncode == 0 and "UNSTAGED" in head(g5):
        bad = True
        results.append("unrelated unstaged file: COMMITTED IT")
    elif c5.returncode == 0:
        results.append("unrelated unstaged file: left out of the commit")
    else:
        results.append("unrelated unstaged file: commit refused (too strict: warn)")
    reset()

    if marker.exists():
        bad = True
        results.append("THE HOOK RAN A RUFF FROM PATH")
    warn_only = not bad and any("warn" in r for r in results)
    add(
        "hook.cases",
        "fail" if bad else "warn" if warn_only else "pass",
        "; ".join(results),
        "use a hook that refuses any staged path with unstaged edits before formatting (assets/.githooks/pre-commit)"
        if bad
        else None,
    )


if opts.no_behavior:
    add("behavior", "skip", "--no-behavior: setup and hook behaviour not tested")
else:
    behaviour()
report()
