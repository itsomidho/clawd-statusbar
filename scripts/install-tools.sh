#!/usr/bin/env bash
# Fetches the tools the status line leans on (jq; gh and glab for the MR and
# pipeline status) when they aren't on PATH, into a folder of the plugin's own:
# no sudo, no package manager. Each comes from its project's latest release and
# is checked against that release's SHA-256 sums before it is kept.
# Prints the names it installed, one per line; nothing when there was nothing
# to do. Linux and macOS, x86-64 and arm64.
set -u

BIN="${XDG_DATA_HOME:-$HOME/.local/share}/clawd-statusbar/bin"
PATH="$BIN:$PATH"
missing=()
for tool in jq gh glab; do command -v "$tool" >/dev/null 2>&1 || missing+=("$tool"); done
((${#missing[@]} == 0)) && exit 0

# A failed try waits a day before the next, so an offline machine isn't asked
# again every session.
STAMP="$BIN/../failed"
now=${EPOCHSECONDS:-$(date +%s)}
last=$(stat -c %Y "$STAMP" 2>/dev/null || stat -f %m "$STAMP" 2>/dev/null || echo 0)
((now - last < 86400)) && exit 0

command -v curl >/dev/null 2>&1 || { echo "curl is needed to fetch ${missing[*]}" >&2; exit 1; }
mkdir -p "$BIN" || exit 1
# One install at a time, when several sessions start together.
LOCK="$BIN/../lock"
mkdir "$LOCK" 2>/dev/null || exit 0
TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"; rmdir "$LOCK" 2>/dev/null' EXIT

case $(uname -s) in Linux) os=linux ;; Darwin) os=macos ;; *) echo "unsupported system" >&2; exit 1 ;; esac
case $(uname -m) in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; *) echo "unsupported machine" >&2; exit 1 ;; esac

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
get() { curl -fsSL --retry 2 --max-time 120 -o "$2" "$1"; }
# The tag a "latest" link redirects to.
latest() { curl -fsSI --max-time 20 "$1" | tr -d '\r' | sed -n 's/^[Ll]ocation: .*\///p' | tail -1; }

# Downloads $1 to $TMP/$2 and checks it against the line for $2 in the sums at $3.
fetch() {
  local url=$1 file=$2 sums=$3 want
  get "$url" "$TMP/$file" && get "$sums" "$TMP/sums" || return 1
  want=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$TMP/sums")
  [[ -n $want && $(sha256 "$TMP/$file") == "$want" ]] || { echo "$file: checksum mismatch" >&2; return 1; }
}

install_jq() {
  local tag file
  tag=$(latest https://github.com/jqlang/jq/releases/latest) && [[ -n $tag ]] || return 1
  file="jq-$os-$arch"
  fetch "https://github.com/jqlang/jq/releases/download/$tag/$file" "$file" \
    "https://github.com/jqlang/jq/releases/download/$tag/sha256sum.txt" || return 1
  install -m 755 "$TMP/$file" "$BIN/jq"
}

install_gh() {
  local tag ver file base
  tag=$(latest https://github.com/cli/cli/releases/latest) && [[ -n $tag ]] || return 1
  ver=${tag#v}
  base="https://github.com/cli/cli/releases/download/$tag"
  if [[ $os == linux ]]; then
    file="gh_${ver}_linux_$arch.tar.gz"
    fetch "$base/$file" "$file" "$base/gh_${ver}_checksums.txt" || return 1
    tar -xzf "$TMP/$file" -C "$TMP" || return 1
    install -m 755 "$TMP/gh_${ver}_linux_$arch/bin/gh" "$BIN/gh"
  else
    file="gh_${ver}_macOS_$arch.zip"
    fetch "$base/$file" "$file" "$base/gh_${ver}_checksums.txt" || return 1
    unzip -q "$TMP/$file" -d "$TMP" || return 1
    install -m 755 "$TMP/gh_${ver}_macOS_$arch/bin/gh" "$BIN/gh"
  fi
}

install_glab() {
  local tag ver file base
  tag=$(latest https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest) && [[ -n $tag ]] || return 1
  ver=${tag#v}
  base="https://gitlab.com/gitlab-org/cli/-/releases/$tag/downloads"
  file="glab_${ver}_$([[ $os == macos ]] && echo darwin || echo linux)_$arch.tar.gz"
  fetch "$base/$file" "$file" "$base/checksums.txt" || return 1
  mkdir -p "$TMP/glab" && tar -xzf "$TMP/$file" -C "$TMP/glab" || return 1
  install -m 755 "$TMP/glab/bin/glab" "$BIN/glab"
}

failed=0
for tool in "${missing[@]}"; do
  if "install_$tool"; then echo "$tool"; else echo "$tool: could not be installed" >&2; failed=1; fi
done
if ((failed)); then touch "$STAMP"; else rm -f "$STAMP"; fi
exit $failed
