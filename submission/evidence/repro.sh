#!/usr/bin/env bash
# Reproduce Part-1 bugs against a running `npm run dev` (no OpenAI key needed).
set -u
APP=http://127.0.0.1:3000/api
BANK=http://127.0.0.1:4001
ADMIN="Authorization: Bearer banana-local-admin"
DIR=$(cd "$(dirname "$0")" && pwd)
J=$(mktemp -d)/jar
H=(-H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000')

login() { curl -s -c "$J.$1" "${H[@]}" -d "{\"userId\":\"$1\"}" $APP/session >/dev/null; }
as() { local who=$1; shift; curl -s -b "$J.$who" "${H[@]}" "$@"; echo; }
scenario() { curl -s -X POST -H "$ADMIN" -H 'Content-Type: application/json' -d "{\"profile\":\"$1\",\"seed\":${2:-17}}" $BANK/admin/scenario; echo; }
ops() { curl -s -H "$ADMIN" $BANK/admin/snapshot | python3 -c "
import json,sys;s=json.load(sys.stdin)
print('  bank operations:',len(s['operations']),'| scenario:',s['scenario'])
for a in s['accounts']:
  if a['id'] in ('acc-lucia','acc-bruno'): print('  ',a['id'],a['balanceCents'])"; }
transfer() { # who intentId amount
  local body="{\"name\":\"transfer_money\",\"arguments\":{\"fromAccountId\":\"acc-lucia\",\"toAccountId\":\"acc-bruno\",\"amountCents\":$3,\"concept\":\"Test $3\"}${2:+,\"intentId\":\"$2\"}}"
  as "$1" -d "$body" $APP/actions
}

for u in lucia bruno marta diego; do login $u; done

echo "### B1 lost-response => duplicated transfer + status 'failed'"
scenario lost-response; ops
transfer lucia "" 1000
ops

echo; echo "### B1b slow-response (2.6s > app timeout 1.4s) => duplicate"
scenario slow-response; ops
transfer lucia "" 1100
sleep 3; ops

echo; echo "### B2 no confirmation: transfer_money executes immediately (normal profile)"
scenario normal
transfer lucia "" 1200

echo; echo "### B3 retrying the same intentId after a failure re-sends with a new reference"
scenario lost-response
transfer lucia intent-fixed-1 1300
ops
transfer lucia intent-fixed-1 1300
ops

echo; echo "### B4 approvals/:id/confirm (no approvals ever created)"
as lucia "$APP/dashboard" | python3 -c "import json,sys;print('  approvals:',json.load(sys.stdin)['approvals'])"

echo; echo "### B5 operator case detail is empty (history/events/intents/bank)"
as marta "$APP/incidents/case-lucia"

echo; echo "### B6 operation_status for historic lucia reference while app says failed"
scenario normal
as lucia -d '{"name":"operation_status","arguments":{"reference":"ref-historic-lucia"}}' $APP/actions

echo; echo "### B7 intent with same id but other user => leaks 409 vs ownership"
as diego -d '{"name":"transfer_money","intentId":"intent-fixed-1","arguments":{"fromAccountId":"acc-diego","toAccountId":"acc-bruno","amountCents":100,"concept":"x"}}' $APP/actions

echo; echo "### B8 insufficient funds message (Diego)"
as diego -d '{"name":"transfer_money","arguments":{"fromAccountId":"acc-diego","toAccountId":"acc-ines","amountCents":20000,"concept":"x"}}' $APP/actions
