#!/bin/bash
set -e
BASE=http://localhost:3300
TMPDIR=/tmp/sb_test2
rm -rf $TMPDIR
mkdir -p $TMPDIR

echo "=== Setup: group + 2 members, both claim ==="
RESP=$(curl -s -c $TMPDIR/admin.txt -L -w "\n%{url_effective}" -d "groupName=Quick Test&currency=TWD" -X POST "$BASE/groups")
GROUP_ID=$(echo "$RESP" | tail -1 | grep -oP '/g/\K[^/]+' | head -1)
curl -s -c $TMPDIR/admin.txt -b $TMPDIR/admin.txt -d "displayName=Alice" -X POST "$BASE/g/$GROUP_ID/members" -o /dev/null
curl -s -c $TMPDIR/admin.txt -b $TMPDIR/admin.txt -d "displayName=Bob" -X POST "$BASE/g/$GROUP_ID/members" -o /dev/null
curl -s -c $TMPDIR/admin.txt -b $TMPDIR/admin.txt -X POST "$BASE/g/$GROUP_ID/setup/finish" -o /dev/null

curl -s -c $TMPDIR/alice.txt -b $TMPDIR/alice.txt "$BASE/test-only/fake-login?userId=line_alice&name=Alice" -o /dev/null
curl -s -c $TMPDIR/alice.txt -b $TMPDIR/alice.txt "$BASE/g/$GROUP_ID/join" -o $TMPDIR/join.html
python3 - "$TMPDIR/join.html" << 'PYEOF'
import re, sys
html = open(sys.argv[1]).read()
forms = re.findall(r'name="memberId" value="([^"]+)">\s*<button[^>]*>\s*([^<]+?)\s*</button>', html)
with open("/tmp/sb_test2/ids.env", "w") as f:
    for member_id, name in forms:
        f.write(f"{name.strip().upper()}_ID={member_id}\n")
PYEOF
source $TMPDIR/ids.env
curl -s -c $TMPDIR/alice.txt -b $TMPDIR/alice.txt -d "memberId=$ALICE_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null

curl -s -c $TMPDIR/bob.txt -b $TMPDIR/bob.txt "$BASE/test-only/fake-login?userId=line_bob&name=Bob" -o /dev/null
curl -s -c $TMPDIR/bob.txt -b $TMPDIR/bob.txt -d "memberId=$BOB_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null

echo "Alice (admin) ID=$ALICE_ID, Bob ID=$BOB_ID"

echo ""
echo "=== TEST A: Non-admin (Bob) tries to calculate split -> should be 403 ==="
curl -s -b $TMPDIR/alice.txt -d "description=Lunch&amount=100&paidBy=$ALICE_ID&splitMode=all" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null
curl -s -b $TMPDIR/bob.txt -X POST "$BASE/g/$GROUP_ID/calculate" -o /dev/null -w "Bob (non-admin) calculate status: %{http_code} (expect 403)\n"

echo ""
echo "=== TEST B: Admin (Alice) calculates split -> should be 302 ==="
curl -s -b $TMPDIR/alice.txt -X POST "$BASE/g/$GROUP_ID/calculate" -o /dev/null -w "Alice (admin) calculate status: %{http_code} (expect 302)\n"

echo ""
echo "=== TEST C: Get transfer ID, then Bob marks it paid ==="
curl -s -b $TMPDIR/alice.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash.html
TRANSFER_ID=$(grep -oP "transfers/\K[^/]+(?=/toggle-paid)" $TMPDIR/dash.html | head -1)
echo "Transfer ID: $TRANSFER_ID"
curl -s -b $TMPDIR/bob.txt -X POST "$BASE/g/$GROUP_ID/transfers/$TRANSFER_ID/toggle-paid" -o /dev/null -w "Bob marks paid status: %{http_code} (expect 302)\n"

curl -s -b $TMPDIR/alice.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash2.html
grep -c 'class="transfer paid"' $TMPDIR/dash2.html
echo "(1 = correctly marked as paid)"

echo ""
echo "=== TEST D: Random stranger (no session) tries to mark paid -> should be 403 ==="
curl -s -X POST "$BASE/g/$GROUP_ID/transfers/$TRANSFER_ID/toggle-paid" -o /dev/null -w "Anonymous toggle-paid status: %{http_code} (expect 403)\n"

echo ""
echo "=== TEST E: Close the group, then verify Bob can't add expenses ==="
curl -s -b $TMPDIR/alice.txt -X POST "$BASE/g/$GROUP_ID/close" -o /dev/null -w "Close status: %{http_code}\n"
curl -s -b $TMPDIR/bob.txt -d "description=Snack&amount=10&paidBy=$BOB_ID&splitMode=all" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null -w "Add expense while closed status: %{http_code} (expect 400)\n"

echo ""
echo "=== TEST F: Reopen, then reset entries (keep members, wipe expenses) ==="
curl -s -b $TMPDIR/alice.txt -X POST "$BASE/g/$GROUP_ID/reopen" -o /dev/null -w "Reopen status: %{http_code}\n"
curl -s -b $TMPDIR/alice.txt -X POST "$BASE/g/$GROUP_ID/reset" -o /dev/null -w "Reset status: %{http_code}\n"

curl -s -b $TMPDIR/alice.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash3.html
echo "Members still present after reset:"
grep -oP 'member-name">\s*\K[A-Za-z]+' $TMPDIR/dash3.html
echo "Expense count after reset (should be 0):"
grep -oP 'Expenses \(\K[0-9]+' $TMPDIR/dash3.html
