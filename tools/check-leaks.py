#!/usr/bin/python3 -I
"""Block anything private from entering this public repo.

  python3 tools/check-leaks.py            scan every tracked + new file
  python3 tools/check-leaks.py --staged   scan only what is about to be committed (git hook)

Fails (exit 1) on: home-folder paths, e-mail addresses, MAC addresses, private
keys, API tokens, passwords, private IPs, location data, wallpaper/video files,
and any word listed in ~/.config/ubuntu_extension_marco/private-words (kept
only on your laptop - put your real name, e-mails, college name there).
Your git e-mail is added to that list automatically.
"""
import os
import re
import subprocess
import sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or "."
THIRD_PARTY = "extensions/third-party/"   # upstream code: only the strict checks apply
SELF = "tools/check-leaks.py"
# Files whose job is to list the blocked setting names (only the "OWN" checks are skipped).
LISTS_BLOCKED_NAMES = {"tools/export-settings.py"}
MY_HOME = re.compile(re.escape(os.path.expanduser("~").rstrip("/") + "/"))

# Checked in every file, including upstream extensions.
STRICT = {
    "home folder path": re.compile(r"/home/(?!user\b|USER\b|<)[a-z_][a-z0-9_-]*/"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "API token": re.compile(r"\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|gho_[A-Za-z0-9]{30,}|"
                            r"sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}|"
                            r"AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})"),
    "Wi-Fi/VPN secret": re.compile(r"^\s*(psk|wep-key\d?|password|passwd|secret|private-key)\s*=\s*\S", re.I | re.M),
}
# Checked in our own files (not upstream code, which has authors' e-mails etc.).
OWN = {
    "e-mail address": re.compile(r"[A-Za-z0-9._%+-]+@(?:gmail|yahoo|outlook|hotmail|proton|icloud|[a-z0-9-]+\.(?:ac|edu))\.[a-z.]{2,}", re.I),
    "MAC address": re.compile(r"\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b"),
    "private IP": re.compile(r"\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b"),
    "file:// home path": re.compile(r"file:///home/"),
    "location data": re.compile(r"world-clocks|location-data|\bAsia/|\bEurope/|\bAmerica/"),
    "Wi-Fi certificate settings": re.compile(r"nm-applet/eap"),
    "recent-folder history": re.compile(r"last-folder-path|last-save-directory|recently-used|playback-history"),
}
BLOCKED_FILES = re.compile(r"(\.mp4|\.mkv|\.webm|\.nmconnection|\.ovpn|\.pem|\.p12|\.key|/background(\.\w+)?|"
                           r"(^|/)\.env[^/]*|local\.conf|private-words)$", re.I)


def private_words():
    words = []
    path = os.path.expanduser("~/.config/ubuntu_extension_marco/private-words")
    if os.path.exists(path):
        words += [w.strip() for w in open(path) if w.strip() and not w.startswith("#")]
    for scope in ("--global", "--system"):
        email = subprocess.run(["git", "config", scope, "user.email"], capture_output=True, text=True).stdout.strip()
        if email and not email.endswith("users.noreply.github.com"):
            words.append(email)
    return [re.compile(re.escape(w), re.I) for w in words]


def files(staged):
    if staged:
        out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
                             capture_output=True, text=True, cwd=ROOT).stdout
    else:
        out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                             capture_output=True, text=True, cwd=ROOT).stdout
    return [f for f in out.split("\0") if f]


def read(path, staged):
    if staged:
        r = subprocess.run(["git", "show", f":{path}"], capture_output=True, cwd=ROOT)
        data = r.stdout
    else:
        try:
            data = open(os.path.join(ROOT, path), "rb").read()
        except OSError:
            return None
    if b"\0" in data[:8000]:
        return None  # binary
    return data.decode("utf-8", "replace")


def main():
    staged = "--staged" in sys.argv
    words = private_words()
    problems = []
    for path in files(staged):
        if path == SELF:
            continue
        if BLOCKED_FILES.search(path):
            problems.append((path, 0, "file type that must never be published"))
            continue
        text = read(path, staged)
        if text is None:
            continue
        checks = dict(STRICT)
        if path.startswith(THIRD_PARTY):
            # Upstream files may contain their authors' own paths; only yours is a leak.
            checks["home folder path"] = MY_HOME
        elif path not in LISTS_BLOCKED_NAMES:
            checks.update(OWN)
        for n, line in enumerate(text.splitlines(), 1):
            for name, rx in checks.items():
                if rx.search(line):
                    problems.append((path, n, name))
            for rx in words:
                if rx.search(line):
                    problems.append((path, n, "private word"))
    if problems:
        print("LEAK CHECK FAILED - nothing was committed. Fix these first:")
        for path, n, name in problems[:60]:
            print(f"  {path}:{n}: {name}")
        if len(problems) > 60:
            print(f"  ... and {len(problems) - 60} more")
        sys.exit(1)
    print(f"leak check passed ({'staged files' if staged else 'all files'})")


if __name__ == "__main__":
    main()
