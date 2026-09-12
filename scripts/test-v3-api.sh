#!/bin/bash
# Quicky v3 end-to-end API test — two sessions (Luna + Alex/admin)
set -e
BASE=http://localhost:3000
J1=/tmp/qk_luna.txt
J2=/tmp/qk_alex.txt
rm -f $J1 $J2

login() { # phone jar
  local phone=$1 jar=$2
  local code
  code=$(curl -s -c $jar -X POST $BASE/api/quicky/auth/otp -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["demoCode"])')
  curl -s -b $jar -c $jar -X POST $BASE/api/quicky/auth/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("login:",d.get("user",{}).get("name") or d)'
}

login +15555550101 $J1   # Luna
login +15555550109 $J2   # Alex (admin)

echo "── landing stats (Luna) ──"
curl -s -b $J1 $BASE/api/quicky/games/spin-bottle/landing-stats | python3 -m json.tool

echo "── gift catalog (Luna) ──"
curl -s -b $J1 $BASE/api/quicky/games/spin-bottle/gifts | python3 -c 'import sys,json;d=json.load(sys.stdin);print("categories:",[(c["slug"]) for c in d["categories"]]);print("gifts:",[(g["id"],g["priceCoins"]) for g in d["catalog"]]);print("balance:",d["coinBalance"])'

echo "── mock coin purchase (Luna, 500 pack) ──"
curl -s -b $J1 -X POST $BASE/api/quicky/games/spin-bottle/coins -H 'Content-Type: application/json' -d '{"packageId":"coins_500"}' | python3 -m json.tool

echo "── join room (Luna) ──"
R1=$(curl -s -b $J1 -X POST $BASE/api/quicky/games/spin-bottle/join | python3 -c 'import sys,json;print(json.load(sys.stdin)["roomId"])')
echo "room: $R1"

echo "── join room (Alex) ──"
R2=$(curl -s -b $J2 -X POST $BASE/api/quicky/games/spin-bottle/join | python3 -c 'import sys,json;print(json.load(sys.stdin)["roomId"])')
echo "room: $R2"

echo "── Alex sends Luna a rose ──"
curl -s -b $J2 -X POST $BASE/api/quicky/games/spin-bottle/gifts -H 'Content-Type: application/json' -d "{\"roomId\":\"$R2\",\"recipientId\":\"$(curl -s -b $J1 $BASE/api/quicky/auth/me | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')\",\"itemId\":\"rose\"}" | python3 -m json.tool

echo "── gift send with insufficient coins (forced quantity 12 x kiss) ──"
curl -s -b $J2 -X POST $BASE/api/quicky/games/spin-bottle/gifts -H 'Content-Type: application/json' -d "{\"roomId\":\"$R2\",\"recipientId\":\"$(curl -s -b $J1 $BASE/api/quicky/auth/me | python3 -c 'import sys,json;print(json.load(sys.stdin)["user"]["id"])')\",\"itemId\":\"kiss\",\"quantity\":12}" | python3 -m json.tool

echo "── snapshot viewer economy (Luna) ──"
curl -s -b $J1 "$BASE/api/quicky/games/spin-bottle/room?roomId=$R1" | python3 -c 'import sys,json;s=json.load(sys.stdin)["snapshot"];print("viewer:",s.get("viewer"));print("players:",[(p["displayName"],p["kissPoints"]) for p in s["players"]])'

echo "── admin: list (Alex) ──"
curl -s -b $J2 $BASE/api/quicky/admin/gifts | python3 -c 'import sys,json;d=json.load(sys.stdin);print("cats:",len(d["categories"]),"gifts:",len(d["gifts"]))'

echo "── admin: create gift (Alex) ──"
NEW=$(curl -s -b $J2 -X POST $BASE/api/quicky/admin/gifts -H 'Content-Type: application/json' -d '{"kind":"gift","data":{"name":"Unicorn","icon":"🦄","priceCoins":123,"isActive":true,"sortOrder":50}}')
echo "$NEW" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("created:",d.get("gift",{}).get("id"),d.get("gift",{}).get("name"),d.get("gift",{}).get("coinPrice"))'
NEWID=$(echo "$NEW" | python3 -c 'import sys,json;print(json.load(sys.stdin)["gift"]["id"])')

echo "── admin: price change 123→77 (Alex) ──"
curl -s -b $J2 -X PATCH $BASE/api/quicky/admin/gifts -H 'Content-Type: application/json' -d "{\"kind\":\"gift\",\"id\":\"$NEWID\",\"data\":{\"priceCoins\":77}}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["gift"]["coinPrice"])'

echo "── admin: deactivate unicorn (Alex) ──"
curl -s -b $J2 -X DELETE $BASE/api/quicky/admin/gifts -H 'Content-Type: application/json' -d "{\"kind\":\"gift\",\"id\":\"$NEWID\"}"
echo ""

echo "── catalog excludes deactivated unicorn ──"
curl -s -b $J1 $BASE/api/quicky/games/spin-bottle/gifts | python3 -c 'import sys,json;d=json.load(sys.stdin);ids=[g["id"] for g in d["catalog"]];print("unicorn hidden:", "'$NEWID'" not in ids)'

echo "── admin: forbidden for non-admin (Luna) ──"
curl -s -o /dev/null -w "%{http_code}\n" -b $J1 $BASE/api/quicky/admin/gifts

echo "── admin: create category (Alex) ──"
curl -s -b $J2 -X POST $BASE/api/quicky/admin/gifts -H 'Content-Type: application/json' -d '{"kind":"category","data":{"name":"Test Cat","icon":"🧪","sortOrder":9}}' | python3 -c 'import sys,json;print("cat:",json.load(sys.stdin)["category"]["slug"])'

echo "ALL API TESTS DONE"
