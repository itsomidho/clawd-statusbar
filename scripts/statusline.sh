#!/usr/bin/env bash
# Claude Code status line: model, context, usage limits, repo/branch, git state,
# MR/pipeline, and CPU/memory when high.
# Reads the session JSON on stdin. Needs bash, jq and git; gh or glab for
# the MR/pipeline status. Works on Linux and macOS.

input=$(cat)
j() { jq -r "$1 // empty" <<<"$input" 2>/dev/null; }

R=$'\e[0m'; DIM=$'\e[2m'; B=$'\e[1m'
CY=$'\e[36m'; MG=$'\e[35m'; BL=$'\e[34m'; GR=$'\e[32m'; YL=$'\e[33m'; RD=$'\e[31m'
SEP="  ${DIM}·${R}  "

# Green under 50, yellow from 50, red from 80
pct_color() { local p=${1%.*}; ((p >= 80)) && echo "$RD" || { ((p >= 50)) && echo "$YL" || echo "$GR"; }; }

# Label + bold value
kv() { printf '%s %s%s%s' "$1" "$B" "$2" "$R"; }

# Label, 8-cell meter, bold percent
meter() {
  local p=${2%.*} c n i fill="" rest=""; ((p > 100)) && p=100; ((p < 0)) && p=0
  c=$(pct_color "$p"); n=$(( (p * 8 + 50) / 100 ))
  for ((i = 0; i < 8; i++)); do ((i < n)) && fill+="━" || rest+="━"; done
  printf '%s %s%s%s%s%s %s%s%s%%%s' "$1" "$c" "$fill" "$R" "$DIM" "$rest" "$R" "$B$c" "$p" "$R"
}

# Seconds -> 1d 2h / 2h 05m / 4m
dur() {
  local s=$1 d h m; ((s < 0)) && s=0
  d=$((s / 86400)); h=$((s % 86400 / 3600)); m=$((s % 3600 / 60))
  if ((d > 0)); then echo "${d}d ${h}h"; elif ((h > 0)); then printf '%dh %02dm' "$h" "$m"; else echo "${m}m"; fi
}

# The last answer of a slow command (a network call), kept in $1; once it is $2
# seconds old the command runs again in the background for a later draw, so the
# bar never waits on it. Empty until the first answer lands.
CACHE_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
cached() {
  local file=$1 max=$2 age; shift 2
  age=$(( $(date +%s) - $(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo 0) ))
  if ((age >= max)); then
    touch "$file" 2>/dev/null
    (out=$("$@" 2>/dev/null); printf '%s' "$out" > "$file") </dev/null >/dev/null 2>&1 &
    disown
  fi
  [[ -r $file ]] && cat "$file"
}

# ---------- model, repo, time ----------
model=$(j '.model.display_name'); [[ -z $model ]] && model="Claude"
# $.session.model() answers the id (/model's own spelling): `claude-opus-5` is
# what arrives, `Opus 5` is what belongs on the bar.
if [[ $model == claude-* ]]; then
  m=${model#claude-}
  last=${m##*-}
  [[ ${#last} -ge 6 && $last != *[!0-9]* ]] && m=${m%-*}
  name=${m%%-*}; ver=${m#"$name"}; ver=${ver#-}; ver=${ver//-/.}
  model="${name^} ${ver}"; model=${model% }
fi
# The project the session belongs to (a shell cd doesn't move it); if that isn't
# a repo (a folder of several projects), fall back to the current directory.
root=$(j '.workspace.project_dir'); cur=$(j '.workspace.current_dir'); [[ -z $cur ]] && cur=$(j '.cwd')
cwd=${root:-${cur:-$PWD}}
if [[ -n $cur ]] && ! git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then cwd=$cur; fi

repo_part=""
if top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
  [[ -z $branch ]] && branch=$(git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  dirty=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  # Commits not yet pushed (↑) and not yet pulled (↓); nothing without an upstream.
  sync=""
  if read -r behind ahead < <(git -C "$cwd" --no-optional-locks rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null); then
    ((ahead > 0)) && sync+="↑${ahead}"
    ((behind > 0)) && sync+="${sync:+ }↓${behind}"
  fi
  stash=$(git -C "$cwd" --no-optional-locks rev-list --walk-reflogs --count refs/stash 2>/dev/null)
  # An operation git stopped partway (conflicts, `edit` in a rebase) is easy to
  # forget; the git dir is the worktree's own, so this is per checkout.
  gd=$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null)
  state=""
  if [[ -d $gd/rebase-merge ]]; then
    state="rebasing $(<"$gd/rebase-merge/msgnum")/$(<"$gd/rebase-merge/end")"
  elif [[ -d $gd/rebase-apply ]]; then
    state="rebasing $(<"$gd/rebase-apply/next")/$(<"$gd/rebase-apply/last")"
  elif [[ -f $gd/MERGE_HEAD ]]; then state="merging"
  elif [[ -f $gd/CHERRY_PICK_HEAD ]]; then state="cherry-picking"
  elif [[ -f $gd/REVERT_HEAD ]]; then state="reverting"
  elif [[ -f $gd/BISECT_LOG ]]; then state="bisecting"
  fi
  # A linked worktree, not the main checkout: name it, so edits land knowingly.
  worktree=""
  common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [[ -n $common && $gd != "$common" ]] && worktree=$(basename "$top")
  parent=$(basename "$(dirname "$top")")
  repo_part="${DIM}${parent}/${R}${B}${BL}$(basename "$top")${R}  ${MG}⎇ ${branch}${R}"
  ((dirty > 0)) && repo_part+=" ${YL}● ${dirty} changed${R}"
  [[ -n $sync ]] && repo_part+=" ${GR}${sync}${R}"
  ((${stash:-0} > 0)) && repo_part+=" ${DIM}≡${stash}${R}"
  [[ -n $worktree ]] && repo_part+=" ${CY}worktree ${worktree}${R}"
  [[ -n $state ]] && repo_part+=" ${B}${RD}⚠ ${state}${R}"
else
  repo_part="${B}${BL}${cwd/#$HOME/\~}${R}"
fi

# ---------- merge request / pipeline ----------
# The open MR (GitLab, !n) or PR (GitHub, #n) for the branch and its pipeline's
# result; with none open, the branch's latest pipeline as `CI`. Prints
# `<ok|fail|run|off> <label>`, or nothing when there is neither or the host
# can't be reached. GitLab's host is any origin that isn't github.com.
review_status() {
  local b=$1 n st label
  if [[ $(git remote get-url origin 2>/dev/null) == *github.com* ]]; then
    n=$(timeout 20 gh pr view "$b" --json number,state \
      --jq 'select(.state == "OPEN") | .number')
    if [[ -n $n ]]; then
      st=$(timeout 20 gh pr view "$b" --json statusCheckRollup --jq '[.statusCheckRollup[]
        | (.conclusion // .state // "") as $c | (.status // "COMPLETED") as $s
        | if ($c | test("FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED")) then "failed"
          elif $s != "COMPLETED" or $c == "PENDING" or $c == "EXPECTED" then "running"
          else "success" end]
        | if index("failed") then "failed" elif index("running") then "running"
          elif length > 0 then "success" else "" end')
    else
      st=$(timeout 20 gh run list -b "$b" -L 1 --json status,conclusion \
        --jq '.[0] | if . == null then "" elif .status != "completed" then "running"
          elif .conclusion == "success" then "success" else .conclusion end')
    fi
    label=${n:+#$n}
  else
    local ref; ref=$(jq -rn --arg b "$b" '$b | @uri')
    n=$(timeout 20 glab api "projects/:fullpath/merge_requests?source_branch=$ref&state=opened&per_page=1" \
      | jq -r '.[0].iid // empty')
    if [[ -n $n ]]; then
      st=$(timeout 20 glab api "projects/:fullpath/merge_requests/$n" | jq -r '.head_pipeline.status // empty')
    else
      st=$(timeout 20 glab api "projects/:fullpath/pipelines?ref=$ref&per_page=1" | jq -r '.[0].status // empty')
    fi
    label=${n:+!$n}
  fi
  [[ -z $n && -z $st ]] && return
  case $st in
    success) printf 'ok %s ✓' "${label:-CI}" ;;
    failed) printf 'fail %s ✗' "${label:-CI}" ;;
    running|pending|created|preparing|waiting_for_resource|scheduled) printf 'run %s ⏳' "${label:-CI}" ;;
    '') printf 'off %s' "$label" ;;
    *) printf 'off %s %s' "${label:-CI}" "${st//_/ }" ;;   # canceled, skipped, manual
  esac
}
review=""
if [[ -n ${top:-} && -n ${branch:-} ]]; then
  key=$(printf '%s' "$top:$branch" | cksum | cut -d' ' -f1)
  review=$(cd "$top" && cached "$CACHE_DIR/claude-statusline-review.$(id -u).$key" 60 review_status "$branch")
fi
if [[ -n $review ]]; then
  review_kind=${review%% *}; review_text=${review#* }
  case $review_kind in ok) c=$GR ;; fail) c=$RD ;; run) c=$YL ;; *) c=$DIM ;; esac
  repo_part+=" ${c}${review_text}${R}"
fi

# ---------- usage ----------
usage=()
line_usage=()
ctx=$(j '.context_window.used_percentage')
if [[ -n $ctx ]]; then
  # The tokens too: on a large window a small percent is still a lot.
  tok=$(j '.context_window.total_input_tokens'); tok=${tok%.*}
  ktok=""
  if [[ -n $tok ]]; then
    ((tok >= 1000000)) && ktok=$(awk -v t="$tok" 'BEGIN{printf "%.1fM", t/1000000}') || ktok="$((tok / 1000))k"
  fi
  usage+=("$(meter CTX "$ctx")${ktok:+ ${DIM}${ktok}${R}}")
  line_usage+=("figure	CTX ${ctx%.*}%${ktok:+ $ktok}")
fi
now=$(date +%s)
for win in "five_hour:5h limit" "seven_day:7d limit"; do
  key=${win%%:*}; label=${win##*:}
  p=$(j ".rate_limits.${key}.used_percentage")
  [[ -z $p ]] && continue
  # The 7d window is noise until it is half used.
  [[ $key == seven_day ]] && ((${p%.*} < 50)) && continue
  reset=$(j ".rate_limits.${key}.resets_at"); reset=${reset%.*}
  s=$(meter "$label" "$p")
  [[ -n $reset ]] && ((reset > now)) && s+=" ${DIM}↻${R} $(dur $((reset - now)))"
  usage+=("$s")
  s="${label%% *} ${p%.*}%"
  [[ -n $reset ]] && ((reset > now)) && s+=" ↻ $(dur $((reset - now)))"
  line_usage+=("figure	$s")
done

# ---------- CPU / memory ----------
cache="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/claude-statusline-cpu.$(id -u)"
cpu=""; mem=""
if [[ -r /proc/stat ]]; then
  # Diff against the previous sample; first run takes a quick 0.2s sample.
  read -r _ a b c d e f g h _ < /proc/stat
  busy=$((a + b + c + f + g + h)); total=$((busy + d + e))
  if [[ -r $cache ]]; then read -r pbusy ptotal < "$cache"; else
    pbusy=$busy; ptotal=$total; sleep 0.2
    read -r _ a b c d e f g h _ < /proc/stat
    busy=$((a + b + c + f + g + h)); total=$((busy + d + e))
  fi
  echo "$busy $total" > "$cache" 2>/dev/null
  dt=$((total - ptotal)); ((dt > 0)) && cpu=$(( 100 * (busy - pbusy) / dt ))
  mt=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  [[ -n $mt && -n $ma ]] && mem="$((mt - ma)) $mt"   # KiB
elif [[ $(uname) == Darwin ]]; then
  ncpu=$(sysctl -n hw.ncpu)
  cpu=$(ps -A -o %cpu= | awk -v n="$ncpu" '{s+=$1} END{printf "%d", s/n}')
  mt=$(( $(sysctl -n hw.memsize) / 1024 ))
  pg=$(sysctl -n hw.pagesize)
  used=$(vm_stat | awk -v pg="$pg" '/Pages active|Pages wired|occupied by compressor/{gsub(/\./,"",$NF); s+=$NF} END{printf "%d", s*pg/1024}')
  mem="$used $mt"
fi

# CPU and memory only once they are high enough to explain a slow run.
SYS_MIN=80
sys=(); line_sys=()
[[ -n $cpu ]] && ((cpu >= SYS_MIN)) && { sys+=("$(kv CPU "$(pct_color "$cpu")${cpu}%")"); line_sys+=("figure	CPU ${cpu}%"); }
if [[ -n $mem ]]; then
  read -r mu mt <<<"$mem"; mp=$((100 * mu / mt))
fi
if [[ -n $mem ]] && ((mp >= SYS_MIN)); then
  sys+=("$(kv RAM "$(pct_color "$mp")$(awk -v u="$mu" -v t="$mt" 'BEGIN{printf "%.1f / %.0f GB", u/1048576, t/1048576}')")")
  line_sys+=("figure	RAM ${mp}%")
fi

# ---------- output ----------
# STATUSLINE_LAYOUT=parts: the same figures plain, one per line, in reading
# order, for a caller that joins as many as its row holds and drops the rest.
# No escapes, and nothing cut: each part is printed whole as `kind<TAB>text`,
# the kind saying how to colour it. A blank line divides the groups, one line
# of the caller's each: the figures, then the project.
if [[ ${STATUSLINE_LAYOUT:-wide} == parts ]]; then
  line_repo=("path	${cwd/#$HOME/\~}")
  # Warnings right after the path, so a short line still has room for them.
  [[ -n ${state:-} ]] && line_repo+=("alert	⚠ ${state}")
  # The branch is its own part, whole: a caller short of room drops it rather
  # than printing half a name.
  if [[ -n ${top:-} ]]; then
    line_repo+=("branch	⎇ ${branch}")
    ((${dirty:-0} > 0)) && line_repo+=("dirty	●${dirty}")
    [[ -n $sync ]] && line_repo+=("sync	${sync}")
    [[ -n $review ]] && line_repo+=("review-${review_kind}	${review_text}")
    ((${stash:-0} > 0)) && line_repo+=("stash	≡${stash}")
    [[ -n $worktree ]] && line_repo+=("worktree	worktree ${worktree}")
  fi
  printf '%s\n' "model	◆ $model" "${line_usage[@]}" "${line_sys[@]}"
  printf '\n'
  printf '%s\n' "${line_repo[@]}"
  exit 0
fi

# A header line, then nested rows: repo, then usage.
join() { local out="" x; for x in "$@"; do [[ -n $out ]] && out+=$SEP; out+=$x; done; printf '%s' "$out"; }
rows=("$repo_part")
((${#usage[@]})) && rows+=("$(join "${usage[@]}")")
printf '%s\n' "$(join "${B}${CY}◆ ${model}${R}" "${sys[@]}")"
for i in "${!rows[@]}"; do
  ((i == ${#rows[@]} - 1)) && branch_glyph="└─" || branch_glyph="├─"
  printf '%s%s%s %s\n' "$DIM" "$branch_glyph" "$R" "${rows[$i]}"
done
exit 0
