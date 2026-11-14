# Owner filter shared by install.sh and system/install-system.sh (sourced, not run).
# Reads features.tsv (made by tools/features.py). Set ONLY / SKIP to comma lists of
# owners, e.g. ONLY=arco or SKIP=sagar. Both empty = install everything.
FEATURES_TSV="${FEATURES_TSV:-$(dirname "${BASH_SOURCE[0]}")/../features.tsv}"
ONLY="${ONLY:-}"; SKIP="${SKIP:-}"

owner_of() {  # owner_of KIND PATH -> owner name, or nothing if not listed
  [ -f "$FEATURES_TSV" ] || return 0
  awk -F'\t' -v k="$1" -v p="$2" '$2==k && $3==p {print $1; exit}' "$FEATURES_TSV"
}

wanted() {  # wanted KIND PATH -> 0 if it should be installed
  [ -z "$ONLY$SKIP" ] && return 0
  local o; o=$(owner_of "$1" "$2"); o=${o:-unknown}
  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$o,"*) ;; *) return 1 ;; esac; fi
  case ",$SKIP," in *",$o,"*) return 1 ;; esac
  return 0
}

# Parse --only / --skip out of "$@"; the other arguments end up in REST (an array).
parse_owner_args() {
  REST=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --only) ONLY=${2:?--only needs a name, e.g. --only arco}; shift 2 ;;
      --only=*) ONLY=${1#*=}; shift ;;
      --skip) SKIP=${2:?--skip needs a name, e.g. --skip sagar}; shift 2 ;;
      --skip=*) SKIP=${1#*=}; shift ;;
      *) REST+=("$1"); shift ;;
    esac
  done
  ONLY=${ONLY// /}; SKIP=${SKIP// /}
}

owner_args() {  # the --only/--skip flags to pass on to another script
  [ -n "$ONLY" ] && printf -- '--only\n%s\n' "$ONLY"
  [ -n "$SKIP" ] && printf -- '--skip\n%s\n' "$SKIP"
  return 0
}
