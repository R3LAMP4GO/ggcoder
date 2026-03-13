#!/bin/bash
set -eo pipefail

# ── CUSTOMIZE THESE (speedrun fills them in) ─────────────────────────────────
PROJECT_DIR="${WORKTREE_PROJECT_DIR:-__PROJECT_DIR__}"
LOG_DIR="$PROJECT_DIR/.gg/logs"
CHECK_CMD="__CHECK_CMD__"

# Ensure node_modules/.bin + bun in PATH for non-interactive shells
export PATH="$PROJECT_DIR/node_modules/.bin:$HOME/.bun/bin:$PATH"
# Disable git pager so diff/log never blocks on (END)
export GIT_PAGER=cat
export CI=1
FEATURE_NAME="__FEATURE_NAME__"
ISSUE_NUM="__ISSUE_NUM__"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Timing helper ─────────────────────────────────────────────────────────────
_timer_start() { _TIMER_START=$(date +%s); }
_timer_elapsed() {
  local elapsed=$(( $(date +%s) - _TIMER_START ))
  local mins=$((elapsed / 60)) secs=$((elapsed % 60))
  echo "${mins}m${secs}s"
}

# ── ggcoder wrapper with transient-error retry ───────────────────────────────
# Retries on: rate limits, API disconnects, connection errors, overload
run_ggcoder() {
  local log_file="$1"; shift
  local max_retries=5
  local delay=60
  local attempt=1

  while true; do
    ggcoder "$@" < /dev/null 2>&1 | tee "$log_file"
    local rc=${PIPESTATUS[0]}

    # Check for transient/retryable errors in log output
    if grep -qiE "rate.limit|Rate limited|overloaded|429|too many requests|terminated|Connection error|ECONNRESET|ETIMEDOUT|socket hang up|503|502|SIGTERM|AbortError|network|fetch failed" "$log_file" 2>/dev/null; then
      if [[ $attempt -ge $max_retries ]]; then
        echo -e "${RED}✗ Transient error after $max_retries retries — giving up${NC}"
        return 1
      fi
      echo -e "${YELLOW}⚠ Transient error (attempt $attempt/$max_retries) — waiting ${delay}s...${NC}"
      sleep "$delay"
      delay=$((delay * 2))
      [[ $delay -gt 600 ]] && delay=600
      attempt=$((attempt + 1))
      continue
    fi

    return $rc
  done
}

# Defaults
START_CHUNK=1
CLEANUP_EVERY=0
SKIP_FINAL_CHECK=false

# Parse args (--issue overrides baked-in value)
while [[ $# -gt 0 ]]; do
  case $1 in
    --start) START_CHUNK="$2"; shift 2 ;;
    --issue) ISSUE_NUM="$2"; shift 2 ;;
    --cleanup-every) CLEANUP_EVERY="$2"; shift 2 ;;
    --skip-final-check) SKIP_FINAL_CHECK=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Auto-detect issue from CLAUDE.md if still placeholder
PLACEHOLDER="__ISSUE""_NUM__"
if [[ "$ISSUE_NUM" == "$PLACEHOLDER" || -z "$ISSUE_NUM" ]]; then
  ISSUE_NUM=$(grep '^\*\*Phase:\*\*' "$PROJECT_DIR/CLAUDE.md" 2>/dev/null | grep -oE '#[0-9]+' | tail -1 | tr -d '#' || true)
fi
[[ -z "$ISSUE_NUM" ]] && echo -e "${RED}✗ No issue #. Pass --issue N or update CLAUDE.md.${NC}" && exit 1

# Fetch plan from GitHub issue
PLAN_FILE=$(mktemp)
trap "rm -f '$PLAN_FILE'" EXIT
echo -e "${BLUE}Fetching plan from issue #${ISSUE_NUM}...${NC}"
gh issue view "$ISSUE_NUM" --json body -q '.body' > "$PLAN_FILE" 2>/dev/null || { echo -e "${RED}✗ Failed to fetch issue #${ISSUE_NUM}${NC}"; exit 1; }

mkdir -p "$LOG_DIR"

echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Plan Executor - $(basename "$PROJECT_DIR")${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"

TOTAL_CHUNKS=$(grep -cE "^#{3,4} Chunk [0-9]+:" "$PLAN_FILE" || echo "0")
echo -e "${GREEN}✓${NC} Issue: #$ISSUE_NUM"
echo -e "${GREEN}✓${NC} $TOTAL_CHUNKS chunks, starting from $START_CHUNK"
echo -e "${GREEN}✓${NC} Feature: $FEATURE_NAME"
echo -e "${GREEN}✓${NC} Checks: $CHECK_CMD"
[[ "$CLEANUP_EVERY" -gt 0 ]] && echo -e "${GREEN}✓${NC} Cleanup every $CLEANUP_EVERY chunks"
echo ""

# ── Pre-read ALL chunks into arrays BEFORE any ggcoder invocations ───────────
declare -a CHUNK_NUMS=()
declare -a CHUNK_NAMES=()

while IFS= read -r line; do
  num=$(echo "$line" | grep -oE "Chunk [0-9]+" | grep -oE "[0-9]+")
  name=$(echo "$line" | sed -E 's/#{3,4} Chunk [0-9]+: //' | sed 's/ (parallel-safe:.*//')
  [[ -n "$num" ]] && CHUNK_NUMS+=("$num") && CHUNK_NAMES+=("$name")
done < <(grep -E "^#{3,4} Chunk [0-9]+:" "$PLAN_FILE")

echo -e "${GREEN}✓${NC} Chunks: ${CHUNK_NUMS[*]}"
echo ""

# Guard: exit if no chunks detected
if [[ ${#CHUNK_NUMS[@]} -eq 0 ]]; then
  echo -e "${RED}✗ No chunks found in plan issue #${ISSUE_NUM}${NC}"
  echo -e "${RED}  Expected headers matching: ^#{3,4} Chunk [0-9]+:${NC}"
  echo -e "${RED}  Plan content preview:${NC}"
  head -30 "$PLAN_FILE"
  exit 1
fi

# ── Mark chunk done in GitHub issue ──────────────────────────────────────────
mark_chunk_done() {
  local num=$1 body
  body=$(gh issue view "$ISSUE_NUM" --json body -q '.body' 2>/dev/null) || { echo -e "${YELLOW}  ⚠ Could not fetch issue for checkbox update${NC}"; return 0; }
  echo "$body" | sed "s/- \[ \] Chunk ${num}:/- [x] Chunk ${num}:/" | gh issue edit "$ISSUE_NUM" -F - 2>/dev/null \
    && echo -e "${GREEN}  ✓ Issue #${ISSUE_NUM}: Chunk ${num} checked off${NC}" \
    || echo -e "${YELLOW}  ⚠ Could not update checkbox (non-fatal)${NC}"
}

# ── Context bridge ───────────────────────────────────────────────────────────
PREV_CHUNK_CONTEXT=""
capture_context() {
  cd "$PROJECT_DIR"
  PREV_CHUNK_CONTEXT=$(git diff --stat HEAD 2>/dev/null || echo "(no git changes)")
}

# ── Prompt generation ────────────────────────────────────────────────────────
generate_prompt() {
  local num=$1 name=$2 context=$3
  local context_section=""
  if [[ -n "$context" && "$context" != "(no git changes)" ]]; then
    context_section="
**Previous chunk changes** (context only, do NOT modify unless in YOUR scope):
\`\`\`
$context
\`\`\`"
  fi

  cat << PROMPT
Continue work on $(basename "$PROJECT_DIR") at $PROJECT_DIR

**Phase**: build | **Feature**: $FEATURE_NAME | **Chunk**: $num/$TOTAL_CHUNKS — $name | **Plan**: #$ISSUE_NUM
$context_section

Fetch plan: gh issue view $ISSUE_NUM --json body -q '.body' — locate Chunk $num.
Read ALL referenced files BEFORE writing. Implement exactly what Chunk $num describes.
Run: $CHECK_CMD. Fix errors. Update CLAUDE.md phase line.
IMPORTANT: Do NOT run git checkout, git switch, or change branches. Stay on the current branch.
Do NOT ask questions.
PROMPT
}

generate_fix_prompt() {
  cat << PROMPT
Continue work on $(basename "$PROJECT_DIR") at $PROJECT_DIR

**Phase**: fix | **Feature**: $FEATURE_NAME

Quality checks failed. Fix ALL errors below — minimal changes only.
\`\`\`
$1
\`\`\`
Re-run: $CHECK_CMD. Loop until clean.
IMPORTANT: Do NOT run git checkout, git switch, or change branches. Stay on the current branch.
Do NOT ask questions.
PROMPT
}

# ── Ensure expected branch (recovery helper) ────────────────────────────────
ensure_branch() {
  cd "$PROJECT_DIR"
  local current expected="$1"
  current=$(git branch --show-current)
  if [[ "$current" != "$expected" ]]; then
    echo -e "${YELLOW}  ⚠ Branch drifted to $current — restoring $expected${NC}"
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "auto-recovery: drift from $current" 2>/dev/null || true
      git checkout "$expected" 2>/dev/null || true
      git stash pop 2>/dev/null || true
    else
      git checkout "$expected" 2>/dev/null || true
    fi
  fi
}

# ── Run a chunk ──────────────────────────────────────────────────────────────
run_chunk() {
  local num=$1 name=$2 log="$LOG_DIR/chunk-${1}.log"
  _timer_start
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶ Chunk $num/$TOTAL_CHUNKS: $name${NC}  Log: $log"

  cd "$PROJECT_DIR"
  if run_ggcoder "$log" --max-turns 50 \
            --print "$(generate_prompt "$num" "$name" "$PREV_CHUNK_CONTEXT")"; then
    if grep -qE "max.turns|turn limit|Maximum number of turns" "$log"; then
      echo -e "${RED}✗ Hit turn limit — output may be incomplete${NC}"; exit 1
    fi
    echo -e "${GREEN}✓ Chunk $num done ($(_timer_elapsed))${NC}"
  else
    echo -e "${RED}✗ Chunk $num failed — check $log${NC}"; exit 1
  fi
}

# ── Quality gate ─────────────────────────────────────────────────────────────
run_quality_gate() {
  local num=$1 gate_log="$LOG_DIR/gate-${1}.log"
  echo -e "${CYAN}  Quality gate after chunk $num...${NC}"
  cd "$PROJECT_DIR"

  if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
    echo -e "${GREEN}  ✓ Passed${NC}"; return 0
  fi

  echo -e "${YELLOW}  ⚠ Failed — fix pass...${NC}"
  local fix_log="$LOG_DIR/fix-${num}.log"
  if run_ggcoder "$fix_log" --max-turns 20 \
            --print "$(generate_fix_prompt "$(cat "$gate_log")")"; then
    # Restore branch if fix pass drifted
    ensure_branch "$EXPECTED_BRANCH"
    if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
      echo -e "${GREEN}  ✓ Fixed${NC}"; return 0
    fi
  fi
  echo -e "${RED}  ✗ Still failing — continuing${NC}"; return 1
}

run_cleanup() {
  echo -e "${CYAN}▶ CLAUDE.md cleanup...${NC}"
  cd "$PROJECT_DIR"
  run_ggcoder "$LOG_DIR/cleanup.log" --max-turns 10 \
         --print "Run /init to clean up CLAUDE.md. Keep it minimal."
}

# ── Main loop ────────────────────────────────────────────────────────────────
# Save the branch we should be on — ggcoder may switch branches during a chunk
cd "$PROJECT_DIR"
EXPECTED_BRANCH=$(git branch --show-current)
echo -e "${GREEN}✓${NC} Working branch: $EXPECTED_BRANCH"
BUILD_START=$(date +%s)

CHUNKS_SINCE_CLEANUP=0
for i in "${!CHUNK_NUMS[@]}"; do
  num="${CHUNK_NUMS[$i]}" name="${CHUNK_NAMES[$i]}"
  [[ "$num" -lt "$START_CHUNK" ]] && echo -e "${YELLOW}  Skip chunk $num${NC}" && continue

  run_chunk "$num" "$name"

  # Restore expected branch if ggcoder switched away
  ensure_branch "$EXPECTED_BRANCH"

  run_quality_gate "$num"

  # Checkpoint commit after each chunk
  cd "$PROJECT_DIR"
  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    git add -A
    git commit -m "checkpoint: chunk $num — $name" 2>>"$LOG_DIR/chunk-${num}.log" || true
    echo -e "${GREEN}  ✓ Checkpoint commit${NC}"
  fi

  mark_chunk_done "$num"
  capture_context

  CHUNKS_SINCE_CLEANUP=$((CHUNKS_SINCE_CLEANUP + 1))
  if [[ "$CLEANUP_EVERY" -gt 0 && "$CHUNKS_SINCE_CLEANUP" -ge "$CLEANUP_EVERY" ]]; then
    run_cleanup; CHUNKS_SINCE_CLEANUP=0
  fi
done

BUILD_ELAPSED=$(( $(date +%s) - BUILD_START ))
BUILD_MINS=$((BUILD_ELAPSED / 60))
echo -e "\n${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All chunks complete! (${BUILD_MINS}m total)${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}\n"

# Close the plan issue
echo -e "${BLUE}Closing issue #${ISSUE_NUM}...${NC}"
gh issue close "$ISSUE_NUM" 2>/dev/null && echo -e "${GREEN}✓ Issue #${ISSUE_NUM} closed${NC}" || echo -e "${YELLOW}⚠ Could not close #${ISSUE_NUM}${NC}"

if [[ "$SKIP_FINAL_CHECK" != "true" ]]; then
  echo -e "${BLUE}Final quality checks...${NC}"
  cd "$PROJECT_DIR"
  eval "$CHECK_CMD" && echo -e "${GREEN}✓ All passed${NC}" || { echo -e "${RED}✗ Failed${NC}"; exit 1; }
fi

echo -e "\n${GREEN}Done!${NC} git diff → /commit"
