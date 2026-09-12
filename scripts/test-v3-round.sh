#!/bin/bash
# Quicky v3 — round resolution + kiss point flow test (Luna & Alex, both say yes)
set -e
BASE=http://localhost:3000
J1=/tmp/qk_luna.txt
J2=/tmp/qk_alex.txt
ROOM=$1

get_snap() { curl -s -b $1 "$BASE/api/quicky/games/spin-bottle/room?roomId=$ROOM"; }

echo "waiting for a spin to start..."
for i in $(seq 1 40); do
  STATUS=$(get_snap $J1 | python3 -c 'import sys,json;s=json.load(sys.stdin)["snapshot"];cs=s.get("currentSpin");print("none" if not cs else cs["status"])')
  if [ "$STATUS" = "awaiting" ]; then break; fi
  sleep 1
done
echo "status: $STATUS"

SNAP=$(get_snap $J1)
SPIN_ID=$(echo "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["snapshot"]["currentSpin"]["id"])')
SPINNER=$(echo "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["snapshot"]["currentSpin"]["spinnerId"])')
TARGET=$(echo "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["snapshot"]["currentSpin"]["targetId"])')
LUNA_ID=$(curl -s -b $J1 $BASE/api/quicky/auth/me | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')
ALEX_ID=$(curl -s -b $J2 $BASE/api/quicky/auth/me | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')
echo "spin $SPIN_ID spinner=$SPINNER target=$TARGET"

# Both answer yes (whoever they are)
curl -s -b $J1 -X POST $BASE/api/quicky/games/spin-bottle/respond -H 'Content-Type: application/json' -d "{\"roomId\":\"$ROOM\",\"choice\":\"yes\"}" | head -c 200; echo ""
curl -s -b $J2 -X POST $BASE/api/quicky/games/spin-bottle/respond -H 'Content-Type: application/json' -d "{\"roomId\":\"$ROOM\",\"choice\":\"yes\"}" | head -c 200; echo ""

sleep 2
SNAP=$(get_snap $J1)
echo "$SNAP" | python3 -c '
import sys, json
s = json.load(sys.stdin)["snapshot"]
cs = s["currentSpin"]
print("result:", cs["result"], "| sResp:", cs["spinnerResponse"], "| tResp:", cs["targetResponse"])
print("viewer economy:", s["viewer"])
print("players kissPoints:", [(p["displayName"], p["kissPoints"]) for p in s["players"]])
'
echo "── landing stats after round (Luna) ──"
curl -s -b $J1 $BASE/api/quicky/games/spin-bottle/landing-stats | python3 -m json.tool
