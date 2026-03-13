#!/bin/bash
set -eo pipefail

# ── Parallel Speedrun via Git Worktrees (Sliding Window of 3) ────────────────
# Each issue gets an isolated worktree so multiple ggcoder instances build
# simultaneously. Ship phase runs sequentially from main checkout.
# Compatible with bash 3.2+ (no associative arrays).

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Per-user branch prefix (override via SHIPIT_USER env var)
_raw_user="${SHIPIT_USER:-$(git config user.name 2>/dev/null || echo user)}"
BRANCH_PREFIX="$(echo "$_raw_user" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
unset _raw_user
GH_USER=$(gh api user -q '.login' 2>/dev/null || true)

WORKTREE_BASE="$PROJECT_DIR/.gg/worktrees"
MAX_PARALLEL=${MAX_PARALLEL:-3}
LAUNCH_DELAY=${LAUNCH_DELAY:-30}

# ── Pin ggcoder version to prevent auto-update breaking --print/--max-turns ──
GGCODER_VERSION="4.2.17"
if [[ "$(ggcoder --version 2>/dev/null)" != "$GGCODER_VERSION" ]]; then
  echo "Pinning ggcoder to $GGCODER_VERSION (current: $(ggcoder --version 2>/dev/null || echo 'none'))..."
  npm install -g "@kenkaiiii/ggcoder@$GGCODER_VERSION" --silent 2>/dev/null || true
fi
mkdir -p "$HOME/.gg"
echo '{"lastCheckedAt":9999999999999,"lastSeenVersion":"'"$GGCODER_VERSION"'"}' > "$HOME/.gg/update-state.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── gh CLI wrapper with rate-limit retry ──────────────────────────────────────
gh_with_retry() {
  local max_retries=3
  local delay=60
  local attempt=1
  local rc=0
  local output=""
  local err_file
  err_file=$(mktemp)

  while [[ $attempt -le $max_retries ]]; do
    output=$(gh "$@" 2>"$err_file") && rc=0 || rc=$?

    if [[ $rc -ne 0 ]]; then
      local err_msg
      err_msg=$(cat "$err_file")
      if echo "$err_msg" | grep -qiE "rate limit|403|secondary rate limit|abuse detection|API rate limit"; then
        echo -e "${YELLOW}⚠ gh rate-limited (attempt $attempt/$max_retries) — waiting ${delay}s...${NC}" >&2
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
        continue
      fi
      cat "$err_file" >&2
      rm -f "$err_file"
      return $rc
    fi

    echo "$output"
    rm -f "$err_file"
    return 0
  done

  echo -e "${RED}✗ gh rate-limited after $max_retries retries — giving up${NC}" >&2
  rm -f "$err_file"
  return 1
}

# ── Parse issues (same 4 modes as speedrun) ──────────────────────────────────
ISSUES=()
LABEL="auto"

if [[ -z "$1" ]]; then
  while IFS= read -r num; do
    [[ -n "$num" ]] && ISSUES+=("$num")
  done < <(gh_with_retry issue list -l "$LABEL" --state open --json number -q '.[].number' | sort -n)
elif [[ "$1" == *,* ]]; then
  IFS=',' read -ra ISSUES <<< "$1"
elif [[ "$1" == *-* ]]; then
  range_start="${1%-*}"
  range_end="${1#*-}"
  while IFS= read -r num; do
    [[ "$num" -ge "$range_start" && "$num" -le "$range_end" ]] && ISSUES+=("$num")
  done < <(gh_with_retry issue list -l "$LABEL" --state open --json number -q '.[].number' | sort -n)
else
  ISSUES=("$1")
fi

# ── Retry-failed mode: find existing failed worktrees ─────────────────────────
RETRY_MODE=false
if [[ "$1" == "--retry-failed" ]]; then
  RETRY_MODE=true
  ISSUES=()
  if [[ -d "$WORKTREE_BASE" ]]; then
    for wt_dir in "$WORKTREE_BASE"/feature-*; do
      [[ -d "$wt_dir" ]] || continue
      issue_num=$(basename "$wt_dir" | sed 's/feature-//')
      ISSUES+=("$issue_num")
    done
  fi
  if [[ ${#ISSUES[@]} -gt 0 ]]; then
    echo -e "${YELLOW}Retry mode: found ${#ISSUES[@]} failed worktrees: ${ISSUES[*]}${NC}"
  fi
fi

if [[ ${#ISSUES[@]} -eq 0 ]]; then
  echo -e "${RED}No issues found${NC}"
  exit 1
fi

echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Parallel Speedrun (window=$MAX_PARALLEL)${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Issues:${NC} ${ISSUES[*]}"
echo ""

# ── Detect base branch ────────────────────────────────────────────────────────
cd "$PROJECT_DIR"
BASE_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
# Prefer 'dev' if it exists, otherwise use detected default
if git rev-parse --verify dev &>/dev/null; then
  BASE_BRANCH="dev"
fi

# ── Guard: main checkout must be clean ────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}Main checkout has uncommitted changes — commit or stash first${NC}"
  exit 1
fi

# Ensure we're on base branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "$BASE_BRANCH" ]]; then
  echo -e "${YELLOW}Switching to $BASE_BRANCH...${NC}"
  git checkout "$BASE_BRANCH"
fi
git pull --ff-only origin "$BASE_BRANCH" 2>/dev/null || true

# ── Worktree path helper ────────────────────────────────────────────────────
wt_path_for() { echo "$WORKTREE_BASE/feature-$1"; }

# ── Create worktrees ────────────────────────────────────────────────────────
mkdir -p "$WORKTREE_BASE"
VALID_ISSUES=()

for issue in "${ISSUES[@]}"; do
  wt_path=$(wt_path_for "$issue")
  branch="$BRANCH_PREFIX/feature-$issue"

  if [[ -d "$wt_path" ]]; then
    echo -e "${YELLOW}Worktree exists: $wt_path — reusing${NC}"
  else
    echo -e "${CYAN}Creating worktree: feature-$issue${NC}"
    git worktree add "$wt_path" -b "$branch" "$BASE_BRANCH" 2>/dev/null \
      || git worktree add "$wt_path" "$branch" 2>/dev/null \
      || { echo -e "${RED}Cannot create worktree for #$issue${NC}"; continue; }
  fi

  # Symlink .venv if it exists
  if [[ -d "$PROJECT_DIR/.venv" && ! -e "$wt_path/.venv" ]]; then
    ln -sf "$PROJECT_DIR/.venv" "$wt_path/.venv" 2>/dev/null || true
  fi

  VALID_ISSUES+=("$issue")
done

echo -e "${GREEN}${#VALID_ISSUES[@]} worktrees ready${NC}"
echo ""

# ── PID tracking (bash 3.2 compatible) ───────────────────────────────────────
PID_ISSUES=()
PID_VALUES=()
SUCCEEDED=()
FAILED=()
SKIPPED=()

active_count() { echo "${#PID_ISSUES[@]}"; }

# Launch a single issue in its worktree (background subshell)
launch_issue() {
  local issue=$1
  local wt_path
  wt_path=$(wt_path_for "$issue")
  local log_dir="$PROJECT_DIR/.gg/logs/feature-$issue"
  mkdir -p "$log_dir"

  echo -e "${BLUE}Launching issue #$issue in $wt_path${NC}"

  (
    # Claim issue — skip if assigned to someone else
    _assignees=$(gh issue view "$issue" --json assignees -q '.assignees[].login' 2>/dev/null || true)
    if [[ -n "$_assignees" && "$_assignees" != *"$GH_USER"* ]]; then
      echo "Skipping #$issue — assigned to $_assignees"
      touch "$log_dir/.skipped"
      exit 0
    fi
    [[ -z "$_assignees" && -n "$GH_USER" ]] && gh issue edit "$issue" --add-assignee "@me" 2>/dev/null || true
    sleep 5  # Throttle gh API calls between worktree launches

    export WORKTREE_PROJECT_DIR="$wt_path"
    if [[ -d "$wt_path/.venv" ]]; then
      export VIRTUAL_ENV="$wt_path/.venv"
      export PATH="$VIRTUAL_ENV/bin:$PATH"
    fi
    cd "$wt_path"
    # Use main project's run-feature.sh — WORKTREE_PROJECT_DIR overrides PROJECT_DIR inside
    "$PROJECT_DIR/scripts/run-feature.sh" --issue "$issue" --skip-ship
  ) > "$log_dir/parallel.log" 2>&1 &

  PID_ISSUES+=("$issue")
  PID_VALUES+=("$!")
}

# Check all PIDs, remove finished ones
check_done() {
  local new_issues=() new_pids=()
  local found_done=1
  local i

  for i in "${!PID_ISSUES[@]}"; do
    local issue="${PID_ISSUES[$i]}"
    local pid="${PID_VALUES[$i]}"

    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null
      local rc=$?
      if [[ $rc -eq 0 && -f "$PROJECT_DIR/.gg/logs/feature-$issue/.skipped" ]]; then
        echo -e "${YELLOW}Issue #$issue skipped (assigned to another user)${NC}"
        SKIPPED+=("$issue")
      elif [[ $rc -eq 0 ]]; then
        echo -e "${GREEN}Issue #$issue completed successfully${NC}"
        SUCCEEDED+=("$issue")
      else
        echo -e "${RED}Issue #$issue failed (exit $rc)${NC}"
        FAILED+=("$issue")
      fi
      found_done=0
    else
      new_issues+=("$issue")
      new_pids+=("$pid")
    fi
  done

  PID_ISSUES=("${new_issues[@]}")
  PID_VALUES=("${new_pids[@]}")
  return $found_done
}

# ── Sliding window ──────────────────────────────────────────────────────────
QUEUE_IDX=0

while [[ $QUEUE_IDX -lt ${#VALID_ISSUES[@]} && $(active_count) -lt $MAX_PARALLEL ]]; do
  launch_issue "${VALID_ISSUES[$QUEUE_IDX]}"
  QUEUE_IDX=$((QUEUE_IDX + 1))
  [[ $QUEUE_IDX -lt ${#VALID_ISSUES[@]} && $(active_count) -lt $MAX_PARALLEL ]] && sleep "$LAUNCH_DELAY"
done

while [[ $(active_count) -gt 0 ]]; do
  if check_done; then
    while [[ $QUEUE_IDX -lt ${#VALID_ISSUES[@]} && $(active_count) -lt $MAX_PARALLEL ]]; do
      sleep "$LAUNCH_DELAY"
      launch_issue "${VALID_ISSUES[$QUEUE_IDX]}"
      QUEUE_IDX=$((QUEUE_IDX + 1))
    done
  fi
  [[ $(active_count) -gt 0 ]] && sleep 10 || true
done

# ── Results ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Build Results${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Succeeded:${NC} ${SUCCEEDED[*]:-none}"
echo -e "${YELLOW}Skipped:${NC} ${SKIPPED[*]:-none}"
echo -e "${RED}Failed:${NC} ${FAILED[*]:-none}"
echo ""

# ── Release worktrees ───────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Releasing worktrees (freeing branches for ship)...${NC}"
cd "$PROJECT_DIR"

for issue in "${SUCCEEDED[@]}" "${SKIPPED[@]}" "${FAILED[@]}"; do
  wt_path=$(wt_path_for "$issue")
  main_log_dir="$PROJECT_DIR/.gg/logs/feature-$issue"
  wt_log_dir="$wt_path/.gg/logs/feature-$issue"
  mkdir -p "$main_log_dir"

  if [[ -f "$wt_log_dir/.plan_issue" ]]; then
    cp "$wt_log_dir/.plan_issue" "$main_log_dir/.plan_issue"
  fi

  # Keep failed worktrees for --retry-failed; clean up succeeded/skipped
  should_remove=true
  for f in "${FAILED[@]}"; do
    [[ "$f" == "$issue" ]] && should_remove=false && break
  done

  if [[ "$should_remove" == "true" && -d "$wt_path" ]]; then
    git worktree remove "$wt_path" --force 2>/dev/null || true
  elif [[ "$should_remove" == "false" ]]; then
    echo -e "${YELLOW}  Keeping worktree for failed #$issue at $wt_path${NC}"
  fi
done
git worktree prune 2>/dev/null || true
echo -e "${GREEN}Worktrees released${NC}"

# ── Ship sequentially from main checkout ────────────────────────────────────
if [[ ${#SUCCEEDED[@]} -eq 0 ]]; then
  echo -e "${RED}No issues to ship${NC}"
else
  # ── Pre-ship rebase: sync feature branches to latest base ──────────────────
  echo ""
  echo -e "${CYAN}Rebasing feature branches onto $BASE_BRANCH before shipping...${NC}"
  cd "$PROJECT_DIR"
  git checkout "$BASE_BRANCH" 2>/dev/null || true
  git pull --ff-only origin "$BASE_BRANCH" 2>/dev/null || true

  SHIP_READY=()
  for issue in "${SUCCEEDED[@]}"; do
    branch="$BRANCH_PREFIX/feature-$issue"
    echo -e "${CYAN}  Rebasing $branch onto $BASE_BRANCH...${NC}"
    if git rebase "$BASE_BRANCH" "$branch" 2>>"$PROJECT_DIR/.gg/logs/feature-$issue/rebase.log"; then
      echo -e "${GREEN}    ✓ Rebase clean${NC}"
      SHIP_READY+=("$issue")
    else
      echo -e "${RED}    ✗ Rebase conflict — skipping ship for #$issue${NC}"
      git rebase --abort 2>/dev/null || true
      FAILED+=("$issue")
    fi
  done
  git checkout "$BASE_BRANCH" 2>/dev/null || true

  echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Sequential Ship Phase (${#SHIP_READY[@]} issues)${NC}"
  echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"

  cd "$PROJECT_DIR"

  for issue in "${SHIP_READY[@]}"; do
    main_log_dir="$PROJECT_DIR/.gg/logs/feature-$issue"

    echo -e "${CYAN}Shipping issue #$issue...${NC}"

    plan_issue=""
    if [[ -f "$main_log_dir/.plan_issue" ]]; then
      plan_issue=$(cat "$main_log_dir/.plan_issue")
      echo -e "${GREEN}  Plan issue: #$plan_issue${NC}"
    fi

    branch="$BRANCH_PREFIX/feature-$issue"
    git checkout "$branch" 2>/dev/null || {
      echo -e "${RED}  Cannot checkout $branch — skipping ship${NC}"
      FAILED+=("$issue")
      continue
    }

    ship_args=(--issue "$issue" --start-phase ship)
    [[ -n "$plan_issue" ]] && ship_args+=(--plan-issue "$plan_issue")

    if "$PROJECT_DIR/scripts/run-feature.sh" "${ship_args[@]}"; then
      echo -e "${GREEN}  Issue #$issue shipped${NC}"
      # Rebase remaining branches onto updated base for next ship
      cd "$PROJECT_DIR"
      git checkout "$BASE_BRANCH" 2>/dev/null || true
      git pull --ff-only origin "$BASE_BRANCH" 2>/dev/null || true
      for rem_issue in "${SHIP_READY[@]}"; do
        [[ "$rem_issue" == "$issue" ]] && continue
        rem_branch="$BRANCH_PREFIX/feature-$rem_issue"
        git rev-parse --verify "$rem_branch" &>/dev/null || continue
        if ! git rebase "$BASE_BRANCH" "$rem_branch" 2>/dev/null; then
          echo -e "${YELLOW}    ⚠ Post-ship rebase conflict in #$rem_issue — will retry on its turn${NC}"
          git rebase --abort 2>/dev/null || true
        fi
      done
      git checkout "$BASE_BRANCH" 2>/dev/null || true
    else
      echo -e "${RED}  Issue #$issue ship failed${NC}"
      FAILED+=("$issue")
      git checkout "$BASE_BRANCH" 2>/dev/null || true
    fi
  done
fi

cd "$PROJECT_DIR"
git checkout "$BASE_BRANCH" 2>/dev/null || true

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Parallel Speedrun Complete${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Shipped:${NC} ${SUCCEEDED[*]:-none}"
[[ ${#SKIPPED[@]} -gt 0 ]] && echo -e "${YELLOW}Skipped:${NC} ${SKIPPED[*]}"
[[ ${#FAILED[@]} -gt 0 ]] && echo -e "${RED}Failed:${NC} ${FAILED[*]}"
exit 0
