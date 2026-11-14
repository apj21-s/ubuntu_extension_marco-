#!/usr/bin/env python3
"""Work out who made each feature and write FEATURES.md + features.tsv.

    python3 tools/features.py           rewrite FEATURES.md and features.tsv
    python3 tools/features.py --check   exit 1 if they are out of date (writes nothing)

Owner of each installable piece, first rule that applies:
  1. a line in tools/owners-override.txt
  2. an extension folder ending in "@<name>" where <name> is in tools/authors.txt
  3. a system step in system/install-system.sh: whoever first committed its title
  4. whoever first committed the file (files not committed yet: the current git user)
Git names/emails are turned into short names with tools/authors.txt.

features.tsv is what ./install.sh --only / --skip reads; FEATURES.md is for people.
Runs by itself from the pre-commit hook and from a GitHub Action on every push.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SYSTEM_SCRIPT = "system/install-system.sh"
STEP_RE = re.compile(r'^if part "([^"]+)"; then')


def git(*args):
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True,
                          text=True, check=True).stdout


def load_authors():
    names = {}
    for line in (REPO / "tools/authors.txt").read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        short, ids = line.split(":", 1)
        short = short.strip()
        names[short.lower()] = short
        for i in ids.split(","):
            if i.strip():
                names[i.strip().lower()] = short
    return names


AUTHORS = load_authors()


def short_name(name, email=""):
    for key in (email.lower(), name.lower()):
        if key in AUTHORS:
            return AUTHORS[key]
    return re.sub(r"[^a-z0-9._-]", "-", name.lower()) or "unknown"


def load_overrides():
    out = {}
    p = REPO / "tools/owners-override.txt"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                key, _, owner = line.rpartition(" ")
                if key.strip():
                    out[key.strip()] = owner.strip()
    return out


def first_authors():
    """path -> (name, email) of the commit that first added it."""
    first = {}
    log = git("log", "--reverse", "--no-renames", "--diff-filter=A", "--name-only",
              "--format=\x01%an\x02%ae")
    who = ("unknown", "")
    for line in log.splitlines():
        if line.startswith("\x01"):
            who = tuple(line[1:].split("\x02", 1))
        elif line and line not in first:
            first[line] = who
    return first


def me():
    try:
        return git("config", "user.name").strip(), git("config", "user.email").strip()
    except subprocess.CalledProcessError:
        return "unknown", ""


FIRST = first_authors()
ME = me()
ORDER = {p: i for i, p in enumerate(FIRST)}
OVERRIDES = load_overrides()
FILES = sorted(f for f in git("ls-files", "--cached", "--others", "--exclude-standard").splitlines()
               if (REPO / f).exists())


def owner_of_files(paths):
    """Owner of a file, or of a folder = whoever added its earliest file."""
    known = [p for p in paths if p in FIRST]
    if known:
        return short_name(*FIRST[min(known, key=ORDER.get)])
    return short_name(*ME)


def owner(path, files):
    if path in OVERRIDES:
        return OVERRIDES[path]
    return owner_of_files(files)


def first_line(text):
    """Top comment or docstring of a script (nothing if it starts with code)."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        line = line.strip()
        if not line or line.startswith("#!"):
            continue
        if line.startswith("#"):
            return line.lstrip("#").strip().rstrip(".")
        if line.startswith(('"""', "'''")):
            rest = line[3:].strip() or (lines[i + 1].strip() if i + 1 < len(lines) else "")
            return rest.strip("\"'").rstrip(".")
        return ""
    return ""


# Short descriptions for features made of many small files.
FEATURE_DESC = {
    "ambient": "Ambient mode (Alt+Q): fullscreen looping video, also starts after 60 s idle unless music is playing",
    "quiet-startup": "Turns off start-up items that aren't needed (Orca, Evolution alarms, Geoclue demo, "
                     "file indexing, Ubuntu Pro/report pop-ups, SPICE agent)",
}


def describe(path):
    p = REPO / path
    try:
        if p.is_dir():
            meta = p / "metadata.json"
            return json.loads(meta.read_text()).get("description", "").split("\n")[0] if meta.exists() else ""
        text = p.read_text(errors="replace")
    except (OSError, ValueError):
        return ""
    if path.endswith((".service", ".timer", ".path")):
        m = re.search(r"^Description=(.*)$", text, re.M)
        return m.group(1).strip() if m else ""
    if path.endswith(".desktop"):
        m = re.search(r"^Comment=(.*)$", text, re.M) or re.search(r"^Name=(.*)$", text, re.M)
        return m.group(1).strip() if m else ""
    return first_line(text)


def stem(name):
    name = name.split("@", 1)[0]
    return re.sub(r"\.(desktop|service|timer|path|sh|py)$", "", name)


def items():
    """(owner, kind, path, feature, description) for every installable piece."""
    rows = []
    tops = {}
    for f in FILES:
        parts = f.split("/")
        if parts[0] == "extensions" and len(parts) > 3:
            tops.setdefault("/".join(parts[:3]), []).append(f)
    for d, files in tops.items():
        kind = "extension" if d.startswith("extensions/custom/") else "third-party"
        uuid = d.rsplit("/", 1)[1]
        suffix = uuid.rsplit("@", 1)[1].lower() if "@" in uuid else ""
        if d in OVERRIDES:
            who = OVERRIDES[d]
        elif suffix in AUTHORS:
            who = AUTHORS[suffix]
        else:
            who = owner_of_files(files)
        rows.append((who, kind, d, stem(uuid), describe(d)))

    simple = [("bin/", "script"), ("applications/", "launcher"), ("systemd/user/", "service"),
              ("autostart/", "startup"), ("ambient/", "ambient"),
              ("config/nautilus-scripts/", "files-menu"), ("system/sudoers/", "sudo-rule")]
    for f in FILES:
        for prefix, kind in simple:
            rest = f[len(prefix):]
            if f.startswith(prefix) and rest and not rest.startswith("__"):
                if kind == "startup" and rest.startswith("disabled/"):
                    feat = "quiet-startup"
                elif kind == "startup" and "/" in rest:
                    continue
                elif kind == "ambient":
                    feat = "ambient"
                elif kind == "files-menu":
                    feat = "phone-drop"
                else:
                    feat = stem(rest)
                if kind == "service" and feat.endswith(("-save", "-restore", "-login")):
                    feat = feat.rsplit("-", 1)[0]
                rows.append((owner(f, [f]), kind, f, feat, describe(f)))
                break

    script = REPO / SYSTEM_SCRIPT
    if script.exists():
        for line in script.read_text().splitlines():
            m = STEP_RE.match(line)
            if not m:
                continue
            title = m.group(1)
            key = "step:" + title
            if key in OVERRIDES:
                who = OVERRIDES[key]
            else:
                log = git("log", "--reverse", "--format=%an\x02%ae", "-S", f'"{title}"', "--", SYSTEM_SCRIPT)
                first = log.splitlines()[0] if log.strip() else None
                who = short_name(*first.split("\x02", 1)) if first else short_name(*ME)
            rows.append((who, "system-step", title, "system", title))
    return sorted(rows, key=lambda r: (r[0], r[3], r[1], r[2]))


KIND_ORDER = ["extension", "third-party", "script", "launcher", "service", "startup",
              "ambient", "files-menu", "sudo-rule"]


def render_md(rows):
    owners = sorted({r[0] for r in rows})
    out = ["# Features by owner", "",
           "Generated by `tools/features.py` on every commit and push - do not edit by hand.",
           "Fix a wrong owner in `tools/owners-override.txt`; add new people to `tools/authors.txt`.",
           "",
           "Install only some people's features:",
           "",
           "```bash",
           "./install.sh --list            # who made what",
           "./install.sh --only arco       # only arco's features (+ the shared base)",
           "./install.sh --skip sagar      # everything except sagar's",
           "```",
           "",
           "The shared base (themes, cursor, sounds, desktop settings, packages, apps, .bashrc",
           "blocks) is always installed. Settings for extensions you skip stay harmlessly unused.",
           "",
           "| Owner | Features |", "|---|---|"]
    for o in owners:
        n = len({r[3] for r in rows if r[0] == o and r[1] not in ("third-party", "system-step")})
        t = len([r for r in rows if r[0] == o and r[1] == "third-party"])
        s = len([r for r in rows if r[0] == o and r[1] == "system-step"])
        out.append(f"| {o} | {n} features, {t} third-party extensions, {s} system steps |")
    for o in owners:
        mine = [r for r in rows if r[0] == o]
        out += ["", f"## {o}", ""]
        feats = {}
        for r in mine:
            if r[1] not in ("third-party", "system-step"):
                feats.setdefault(r[3], []).append(r)
        if feats:
            out += ["| Feature | What it does | Parts |", "|---|---|---|"]
            for name, parts in sorted(feats.items()):
                parts.sort(key=lambda r: (KIND_ORDER.index(r[1]), r[2]))
                desc = FEATURE_DESC.get(name) or next((r[4] for r in parts if r[4]), "")
                desc = desc.replace("|", "/")
                out.append(f"| **{name}** | {desc} | " + "<br>".join(f"`{r[2]}`" for r in parts) + " |")
        third = [r for r in mine if r[1] == "third-party"]
        if third:
            out += ["", "Third-party extensions added (made by others, chosen by " + o + "):", ""]
            out += [f"- `{r[2].rsplit('/', 1)[1]}`" + (f" - {r[4]}" if r[4] else "") for r in third]
        steps = [r for r in mine if r[1] == "system-step"]
        if steps:
            out += ["", "System steps (in `system/install-system.sh`):", ""]
            out += [f"- {r[2]}" for r in steps]
    return "\n".join(out) + "\n"


def render_tsv(rows):
    out = ["# owner\tkind\tpath\tfeature   (generated by tools/features.py)"]
    out += ["\t".join(r[:4]) for r in rows]
    return "\n".join(out) + "\n"


def main():
    rows = items()
    want = {"FEATURES.md": render_md(rows), "features.tsv": render_tsv(rows)}
    stale = [n for n, text in want.items()
             if not (REPO / n).exists() or (REPO / n).read_text() != text]
    if "--check" in sys.argv:
        if stale:
            print("out of date: " + ", ".join(stale) + " (run python3 tools/features.py)")
            return 1
        return 0
    for n in stale:
        (REPO / n).write_text(want[n])
    print(("updated " + ", ".join(stale)) if stale else "feature list already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
