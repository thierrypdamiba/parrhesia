#!/usr/bin/env bash
# HTTP walkthrough of the letters API (PLAN.md P3) against a running dev server.
#   BASE=http://localhost:3112 ./scripts/api-walkthrough.sh
# Needs curl and jq, and DEV_IDENTITY=1 on the server (for /dev/signin, the local stand-in for
# Sign in with ChatGPT). Prints each step's status and ends with letter A at rev_no 3.
set -u
BASE="${BASE:-http://localhost:3112}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0
STEP=0

Q3='The use of bicycles and electric bicycles is allowed in other locations designated by the superintendent after notice is provided using one or more of the methods described in Sec. 1.7 of this chapter.'
Q1='Written determinations for existing trails and for new trails within developed areas must be published in the Federal Register for 30 days of public comment.'
Q2='The superintendent would have authority to designate other locations, including administrative roads and trails, for bicycle and e-bike use except that rulemaking in the Federal Register would be required to allow bicycles or e-bikes in two circumstances.'
BAD='Written determinations for existing trails must be published in the Federal Register for 60 days of public comment.'
AMBIG='bicycles and electric bicycles'  # a real fragment, but it occurs 3 times in 2026-17902
ASSERT='Notice under Sec. 1.7 can be a bulletin-board posting; nothing sets a minimum interval before a designation takes effect.'

# call <label> <method> <path> <jar> [json-body] [extra curl args...]
# Sets STATUS and BODY (file). Prints "STEP n  label → status".
call() {
  local label="$1" method="$2" path="$3" jar="$4" data="${5:-}"
  shift 4; [ $# -gt 0 ] && shift
  STEP=$((STEP + 1))
  BODY="$WORK/step$STEP.json"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" -b "$jar" -c "$jar" -H 'content-type: application/json')
  [ -n "$data" ] && args+=(--data "$data")
  STATUS="$(curl "${args[@]}" "$@" "$BASE$path")"
  printf 'STEP %-2s %-58s → %s\n' "$STEP" "$label" "$STATUS"
}

expect() { # expect <status> [jq-expr] [expected-value]
  local want="$1" expr="${2:-}" value="${3:-}"
  if [ "$STATUS" != "$want" ]; then
    echo "  FAIL: expected HTTP $want, got $STATUS: $(head -c 300 "$BODY")"; FAILS=$((FAILS + 1)); return
  fi
  if [ -n "$expr" ]; then
    local got; got="$(jq -r "$expr" "$BODY" 2>/dev/null)"
    if [ "$got" != "$value" ]; then
      echo "  FAIL: $expr = '$got', expected '$value': $(head -c 300 "$BODY")"; FAILS=$((FAILS + 1)); return
    fi
    echo "  ok: $expr = $got"
  fi
}
j() { jq -r "$1" "$BODY"; }
json() { jq -cn "$@"; }

OWNER="$WORK/owner.jar"; MAYA="$WORK/maya.jar"; SAM="$WORK/sam.jar"; touch "$OWNER" "$MAYA" "$SAM"

echo "== Letter A: create+bind, propose, accept, refusals, stale revisions, identity, unknown fields"
call 'POST /api/letters {document_number}' POST /api/letters "$OWNER" '{"document_number":"2026-17902"}'
expect 201 '.rev_no' 1
LID="$(j .letter_id)"; SHARE="$(j .share_code)"; REV1="$(j .rev)"
echo "  letter $LID rev $REV1 rule $(j .rule.document_number) closes $(j .rule.comments_close_on) ($(j .rule.days_left) days left)"

call 'POST /bind on a bound letter' POST "/api/letters/$LID/bind" "$OWNER" '{"document_number":"2026-15406"}'
expect 409 '.error' ALREADY_BOUND

call 'GET /state?rev=<current>' GET "/api/letters/$LID/state?rev=$REV1" "$OWNER"
expect 200 '.unchanged' true

call 'POST /read {query:"30 days"} as agent' POST "/api/letters/$LID/read" "$OWNER" '{"query":"30 days"}' -H 'x-docket-actor: agent'
expect 200 '.passages[0].page' 56096
echo "  matches_total $(j .matches_total) first passage $(j .passages[0].start)–$(j '.passages[0].end')"

call 'POST /verify Q3' POST "/api/letters/$LID/verify" "$OWNER" "$(json --arg q "$Q3" '{quote:$q}')"
expect 200 '.anchor.start' 40935

call 'POST /proposals claim Q3 (agent)' POST "/api/letters/$LID/proposals" "$OWNER" \
  "$(json --arg r "$REV1" --arg q "$Q3" --arg a "$ASSERT" '{base_rev:$r, kind:"claim", quote:$q, position:"modify", assertion:$a, requested_change:"Add a minimum 30-day interval between notice and designation."}')" \
  -H 'x-docket-actor: agent'
expect 201 '.anchor | "\(.start),\(.end),\(.page)"' '40935,41136,56101'
PID1="$(j .proposal_id)"

call 'decide accept hold 700' POST "/api/letters/$LID/proposals/$PID1/decide" "$OWNER" '{"decision":"accept","hold_ms":700}'
expect 200 '.rev_no' 2
REV2="$(j .rev)"; CID="$(j .claim_id)"

call 'POST /proposals claim BAD (60 days)' POST "/api/letters/$LID/proposals" "$OWNER" \
  "$(json --arg r "$REV2" --arg q "$BAD" --arg a "$ASSERT" '{base_rev:$r, kind:"claim", quote:$q, position:"oppose", assertion:$a}')" \
  -H 'x-docket-actor: agent'
expect 422 '.nearest[0].start' 20073
echo "  error $(j .error); nearest: $(j '[.nearest[] | "\(.score)@\(.start)–\(.end) p.\(.page)"] | join(" · ")')"

call 'POST /proposals with stale base_rev (rev 1)' POST "/api/letters/$LID/proposals" "$OWNER" \
  "$(json --arg r "$REV1" --arg q "$Q1" --arg a "$ASSERT" '{base_rev:$r, kind:"claim", quote:$q, position:"support", assertion:$a}')" \
  -H 'x-docket-actor: agent'
expect 409 '.changed_since[0] | "\(.field) \(.claim_id)"' "claim $CID"
echo "  current_rev $(j .current_rev); changed_since: $(j '[.changed_since[].summary] | join("; ")')"

call 'PATCH /claims/:cid assertion by hand' PATCH "/api/letters/$LID/claims/$CID" "$OWNER" \
  "$(json --arg r "$REV2" '{base_rev:$r, field:"assertion", text:"A bulletin-board posting is not enough notice for a trail designation that takes effect at once."}')"
expect 200 '.rev_no' 3
REV3="$(j .rev)"

call 'POST /proposals edit against rev 2 (stale)' POST "/api/letters/$LID/proposals" "$OWNER" \
  "$(json --arg r "$REV2" --arg c "$CID" '{base_rev:$r, kind:"edit", claim_id:$c, field:"requested_change", text:"Require 30 days between notice and designation."}')" \
  -H 'x-docket-actor: agent'
expect 409 '.changed_since[0] | "\(.claim_id) \(.field) \(.by)"' "$CID assertion human:anon"

call 'POST /proposals impact without identity' POST "/api/letters/$LID/proposals" "$OWNER" \
  "$(json --arg r "$REV3" '{base_rev:$r, kind:"impact", text:"Our club rides these connector trails every weekend and would lose access without notice."}')" \
  -H 'x-docket-actor: agent'
expect 401 '.error' NOT_SIGNED_IN

call 'GET /dev/signin?name=Maya' GET '/dev/signin?name=Maya' "$MAYA"
expect 302
call 'GET /by-share/:code as Maya' GET "/api/letters/by-share/$SHARE" "$MAYA"
expect 200 '.can_edit' true

call 'POST /proposals impact as Maya (agent)' POST "/api/letters/$LID/proposals" "$MAYA" \
  "$(json --arg r "$REV3" '{base_rev:$r, kind:"impact", text:"Our club rides these connector trails every weekend and would lose access without notice."}')" \
  -H 'x-docket-actor: agent'
expect 201 '.kind' impact
PIDI="$(j .proposal_id)"

call 'decide accept impact by another user' POST "/api/letters/$LID/proposals/$PIDI/decide" "$OWNER" '{"decision":"accept","hold_ms":700}'
expect 403 '.hint' 'Only Maya can accept this'

call 'decide accept impact by Maya, hold 200' POST "/api/letters/$LID/proposals/$PIDI/decide" "$MAYA" '{"decision":"accept","hold_ms":200}'
expect 400 '.error' HOLD_REQUIRED

call 'POST /proposals with signer_name' POST "/api/letters/$LID/proposals" "$MAYA" \
  "$(json --arg r "$REV3" '{base_rev:$r, kind:"impact", text:"Our club rides these connector trails every weekend and would lose access without notice.", signer_name:"Maya"}')" \
  -H 'x-docket-actor: agent'
expect 400 '.hint' 'signer_name is not accepted'

call 'POST /signers/me with display_name' POST "/api/letters/$LID/signers/me" "$MAYA" "$(json --arg r "$REV3" '{base_rev:$r, display_name:"Someone Else"}')"
expect 400 '.error' UNKNOWN_FIELD

call 'GET /by-public/:token' GET "/api/letters/by-public/$(curl -s -b "$OWNER" "$BASE/api/letters/$LID/state" | jq -r .letter.public_token)" "$SAM"
expect 200 '.can_edit' false
call 'PATCH /claims by a public viewer' PATCH "/api/letters/$LID/claims/$CID" "$SAM" "$(json --arg r "$REV3" '{base_rev:$r, field:"evidence", text:"x"}')"
expect 403 '.error' FORBIDDEN

echo "== Letter B: two parallel accepts against one base → exactly one rev_no+1 and one 409"
call 'POST /api/letters (B)' POST /api/letters "$OWNER" '{"document_number":"2026-17902"}'
expect 201 '.rev_no' 1
LB="$(j .letter_id)"; RB="$(j .rev)"
call 'B: propose claim Q1' POST "/api/letters/$LB/proposals" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$Q1" --arg a "$ASSERT" '{base_rev:$r, kind:"claim", quote:$q, position:"support", assertion:$a}')" -H 'x-docket-actor: agent'
expect 201; PB1="$(j .proposal_id)"
call 'B: propose claim Q2' POST "/api/letters/$LB/proposals" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$Q2" --arg a "$ASSERT" '{base_rev:$r, kind:"claim", quote:$q, position:"support", assertion:$a}')" -H 'x-docket-actor: agent'
expect 201; PB2="$(j .proposal_id)"
STEP=$((STEP + 1))
for P in "$PB1" "$PB2"; do
  curl -s -o "$WORK/par-$P.json" -w '%{http_code}\n' -X POST -b "$OWNER" -H 'content-type: application/json' \
    --data '{"decision":"accept","hold_ms":700}' "$BASE/api/letters/$LB/proposals/$P/decide" > "$WORK/par-$P.status" &
done
wait
S1="$(cat "$WORK/par-$PB1.status")"; S2="$(cat "$WORK/par-$PB2.status")"
printf 'STEP %-2s %-58s → %s\n' "$STEP" 'B: two parallel accepts' "$S1 $S2"
CODES="$(printf '%s\n%s\n' "$S1" "$S2" | sort | tr '\n' ' ')"
if [ "$CODES" = "200 409 " ]; then
  WON="$PB1"; [ "$S1" = 409 ] && WON="$PB2"
  echo "  ok: winner rev_no $(jq -r .rev_no "$WORK/par-$WON.json"); loser $(jq -r '.error' "$WORK/par-$([ "$WON" = "$PB1" ] && echo "$PB2" || echo "$PB1").json")"
else
  echo "  FAIL: expected one 200 and one 409, got $S1 $S2"; FAILS=$((FAILS + 1))
fi
call 'B: state after the race' GET "/api/letters/$LB/state" "$OWNER"
expect 200 '.letter.rev_no' 2
echo "  claims $(j '.claims | length'), pending $(j '.pending | length'), activity: $(j '.activity[0].summary')"
call 'B: undo (held)' POST "/api/letters/$LB/undo" "$OWNER" "$(json --arg r "$(j .letter.rev)" '{base_rev:$r, hold_ms:800}')"
expect 200 '.rev_no' 3
call 'B: state after undo has no claims' GET "/api/letters/$LB/state" "$OWNER"
expect 200 '.claims | length' 0
RB="$(j .letter.rev)"

echo "== Letter B: by-hand claim, reject, delete, signer routes (identity from the session only)"
call 'B: POST /claims by hand with the BAD quote' POST "/api/letters/$LB/claims" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$BAD" --arg a "$ASSERT" '{base_rev:$r, quote:$q, position:"oppose", assertion:$a}')"
expect 201 '.claim.anchor_status' unverified
echo "  nearest[0] $(j '.nearest[0] | "\(.score)@\(.start) p.\(.page)"'); rev_no $(j .rev_no)"
RB="$(j .rev)"; CB="$(j .claim.id)"
call 'B: POST /claims by hand with an ambiguous quote' POST "/api/letters/$LB/claims" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$AMBIG" --arg a "$ASSERT" '{base_rev:$r, quote:$q, position:"modify", assertion:$a}')"
expect 201 '.claim.anchor_status' unverified
expect 201 '.occurrences | length' 3
echo "  occurrences: $(j '[.occurrences[] | "\(.start)–\(.end) p.\(.page)"] | join(" · ")'); anchor_start $(j .claim.anchor_start)"
RB="$(j .rev)"; CA="$(j .claim.id)"
call 'B: PATCH that quote to a unique longer span' PATCH "/api/letters/$LB/claims/$CA" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$Q1" '{base_rev:$r, field:"quote", text:$q}')"
expect 200 '.claim | "\(.anchor_status) \(.anchor_start) \(.page)"' 'anchored 20073 56098'
RB="$(j .rev)"
call 'B: PATCH it back to the ambiguous quote' PATCH "/api/letters/$LB/claims/$CA" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$AMBIG" '{base_rev:$r, field:"quote", text:$q}')"
expect 200 '.claim | "\(.anchor_status) \(.anchor_start) \(.page)"' 'unverified null null'
expect 200 '.occurrences | length' 3
RB="$(j .rev)"
call 'B: DELETE the ambiguous claim (held)' DELETE "/api/letters/$LB/claims/$CA" "$OWNER" "$(json --arg r "$RB" '{base_rev:$r, hold_ms:800}')"
expect 200
RB="$(j .rev)"
call 'B: POST /claims as agent (refused: by-hand is human)' POST "/api/letters/$LB/claims" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$Q1" --arg a "$ASSERT" '{base_rev:$r, quote:$q, position:"support", assertion:$a}')" -H 'x-docket-actor: agent'
expect 403 '.error' FORBIDDEN
call 'B: propose edit to the unverified quote (agent)' POST "/api/letters/$LB/proposals" "$OWNER" \
  "$(json --arg r "$RB" --arg c "$CB" --arg q "$Q1" '{base_rev:$r, kind:"edit", claim_id:$c, field:"quote", text:$q}')" -H 'x-docket-actor: agent'
expect 201 '.anchor.page' 56098
PE="$(j .proposal_id)"; echo "  diff removed $(j '.diff.removed | length') added $(j '.diff.added | length') words"
call 'B: PATCH the same field by hand → proposal goes stale' PATCH "/api/letters/$LB/claims/$CB" "$OWNER" \
  "$(json --arg r "$RB" --arg q "$Q3" '{base_rev:$r, field:"quote", text:$q}')"
expect 200 '.claim.page' 56101
RB="$(j .rev)"
call 'B: accept the stale edit proposal' POST "/api/letters/$LB/proposals/$PE/decide" "$OWNER" '{"decision":"accept","hold_ms":900}'
expect 409 '.error' STALE_PROPOSAL
echo "  $(j .hint) (field $(j .field), by $(j .by))"
call 'B: propose edit to requested_change (agent)' POST "/api/letters/$LB/proposals" "$OWNER" \
  "$(json --arg r "$RB" --arg c "$CB" '{base_rev:$r, kind:"edit", claim_id:$c, field:"requested_change", text:"Publish each designation on the park website 30 days before it takes effect."}')" -H 'x-docket-actor: agent'
expect 201
PR="$(j .proposal_id)"
call 'B: reject it (click, no hold needed)' POST "/api/letters/$LB/proposals/$PR/decide" "$OWNER" '{"decision":"reject"}'
expect 200 '.status' rejected
call 'B: DELETE claim without hold' DELETE "/api/letters/$LB/claims/$CB" "$OWNER" "$(json --arg r "$RB" '{base_rev:$r, hold_ms:100}')"
expect 400 '.error' HOLD_REQUIRED
call 'B: POST /signers/me anonymous' POST "/api/letters/$LB/signers/me" "$OWNER" "$(json --arg r "$RB" '{base_rev:$r}')"
expect 401 '.error' NOT_SIGNED_IN
call 'B: Maya opens the co-writing link' GET "/api/letters/by-share/$(curl -s -b "$OWNER" "$BASE/api/letters/$LB/state" | jq -r .letter.share_code)" "$MAYA"
expect 200 '.can_edit' true
call 'B: POST /signers/me as Maya' POST "/api/letters/$LB/signers/me" "$MAYA" "$(json --arg r "$RB" '{base_rev:$r}')"
expect 200 '.signers[0] | "\(.display_name) \(.is_viewer)"' 'Maya true'
RB="$(j .rev)"
call 'B: POST /signers/me again' POST "/api/letters/$LB/signers/me" "$MAYA" "$(json --arg r "$RB" '{base_rev:$r}')"
expect 409 '.error' ALREADY_SIGNER
call 'B: PATCH /signers/me impact_text' PATCH "/api/letters/$LB/signers/me" "$MAYA" \
  "$(json --arg r "$RB" '{base_rev:$r, impact_text:"Our club rides these connector trails every weekend."}')"
expect 200 '.signers[0].impact_text' 'Our club rides these connector trails every weekend.'
RB="$(j .rev)"
call 'B: PATCH /signers/me/display_name as agent' PATCH "/api/letters/$LB/signers/me/display_name" "$MAYA" \
  "$(json --arg r "$RB" '{base_rev:$r, display_name:"Maya C."}')" -H 'x-docket-actor: agent'
expect 403 '.error' FORBIDDEN
call 'B: PATCH /signers/me/display_name by hand' PATCH "/api/letters/$LB/signers/me/display_name" "$MAYA" \
  "$(json --arg r "$RB" '{base_rev:$r, display_name:"Maya <script>Chen</script>"}')"
expect 200 '.signers[0].display_name' 'Maya script Chen script'
RB="$(j .rev)"
call 'B: POST /signers/me/sign (held)' POST "/api/letters/$LB/signers/me/sign" "$MAYA" "$(json --arg r "$RB" '{base_rev:$r, hold_ms:750}')"
expect 200 '.signers[0].signed_at | type' string
RB="$(j .rev)"
call 'B: owner sees the signature in state' GET "/api/letters/$LB/state" "$OWNER"
expect 200 '.signers[0] | "\(.display_name) \(.is_viewer) \(.signed_at != null)"' 'Maya script Chen script false true'
echo "  activity: $(j '[.activity[0:3][].summary] | join(" | ")')"
call 'B: DELETE /signers/me as Maya' DELETE "/api/letters/$LB/signers/me" "$MAYA" "$(json --arg r "$RB" '{base_rev:$r}')"
expect 200 '.signers | length' 0

echo "== Letter A: export and final state"
call 'GET /export.txt' GET "/api/letters/$LID/export.txt" "$OWNER"
expect 200
grep -q 'page 56101' "$BODY" && echo "  ok: contains 'page 56101'" || { echo "  FAIL: no 'page 56101'"; FAILS=$((FAILS + 1)); }
grep -q "\[claimant's words\]" "$BODY" && echo "  ok: contains [claimant's words]" || { echo "  FAIL: no [claimant's words]"; FAILS=$((FAILS + 1)); }
grep -q 'Prepared with' "$BODY" && echo "  ok: disclosure footer present" || { echo "  FAIL: no footer"; FAILS=$((FAILS + 1)); }
sed 's/^/  | /' "$BODY"

call 'GET /state (final)' GET "/api/letters/$LID/state" "$OWNER"
expect 200 '.letter.rev_no' 3
echo "  pending $(j '.pending | length') (impact for $(j '.pending[0].for_display_name')), missing: $(j '.missing | join("; ")')"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "ALL STEPS PASSED — letter $LID ends at rev_no $(j .letter.rev_no)"
else
  echo "$FAILS FAILURE(S)"; exit 1
fi
