#!/bin/bash
set -e
BASE=http://localhost:3300
TMPDIR=/tmp/sb_test
rm -rf $TMPDIR
mkdir -p $TMPDIR

echo "=== 1. Create group ==="
RESP=$(curl -s -c $TMPDIR/admin.txt -L -w "\n%{url_effective}" -d "groupName=Taipei Trip&currency=TWD" -X POST "$BASE/groups")
GROUP_ID=$(echo "$RESP" | tail -1 | grep -oP '/g/\K[^/]+' | head -1)
echo "Group ID: $GROUP_ID"

echo "=== 2. Add 4 members ==="
for NAME in Owen Taku Clayton AT; do
  curl -s -c $TMPDIR/admin.txt -b $TMPDIR/admin.txt -d "displayName=$NAME" -X POST "$BASE/g/$GROUP_ID/members" -o /dev/null
done

echo "=== 3. Finish setup ==="
curl -s -c $TMPDIR/admin.txt -b $TMPDIR/admin.txt -X POST "$BASE/g/$GROUP_ID/setup/finish" -o /dev/null

echo "=== 4. Owen logs in via fake LINE, visits /join, gets member ID list ==="
curl -s -c $TMPDIR/owen.txt -b $TMPDIR/owen.txt "$BASE/test-only/fake-login?userId=line_owen&name=Owen" -o /dev/null
curl -s -c $TMPDIR/owen.txt -b $TMPDIR/owen.txt "$BASE/g/$GROUP_ID/join" -o $TMPDIR/join.html

python3 - "$TMPDIR/join.html" << 'PYEOF'
import re, sys
html = open(sys.argv[1]).read()
forms = re.findall(r'name="memberId" value="([^"]+)">\s*<button[^>]*>\s*([^<]+?)\s*</button>', html)
with open("/tmp/sb_test/ids.env", "w") as f:
    for member_id, name in forms:
        f.write(f"{name.strip().upper()}_ID={member_id}\n")
print(forms)
PYEOF
cat $TMPDIR/ids.env
source $TMPDIR/ids.env

echo "=== 5. Owen claims his name ==="
curl -s -c $TMPDIR/owen.txt -b $TMPDIR/owen.txt -d "memberId=$OWEN_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null -w "Owen claim status: %{http_code}\n"

echo "=== 6. Taku, Clayton, AT each fake-login and claim ==="
curl -s -c $TMPDIR/taku.txt -b $TMPDIR/taku.txt "$BASE/test-only/fake-login?userId=line_taku&name=Taku" -o /dev/null
curl -s -c $TMPDIR/taku.txt -b $TMPDIR/taku.txt -d "memberId=$TAKU_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null -w "Taku claim status: %{http_code}\n"

curl -s -c $TMPDIR/clayton.txt -b $TMPDIR/clayton.txt "$BASE/test-only/fake-login?userId=line_clayton&name=Clayton" -o /dev/null
curl -s -c $TMPDIR/clayton.txt -b $TMPDIR/clayton.txt -d "memberId=$CLAYTON_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null -w "Clayton claim status: %{http_code}\n"

curl -s -c $TMPDIR/at.txt -b $TMPDIR/at.txt "$BASE/test-only/fake-login?userId=line_at&name=AT" -o /dev/null
curl -s -c $TMPDIR/at.txt -b $TMPDIR/at.txt -d "memberId=$AT_ID" -X POST "$BASE/g/$GROUP_ID/claim" -o /dev/null -w "AT claim status: %{http_code}\n"

echo "=== 7. Verify dashboard shows Owen as admin (first to claim) ==="
curl -s -b $TMPDIR/owen.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash1.html
grep -c "badge-admin" $TMPDIR/dash1.html
grep -oP 'badge-joined' $TMPDIR/dash1.html | wc -l

echo "=== 8. Add expenses ==="
# Owen pays 683, everyone splits
curl -s -b $TMPDIR/owen.txt -d "description=Gas&amount=683&paidBy=$OWEN_ID&splitMode=all" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null -w "Expense1: %{http_code}\n"
# Taku pays 703, everyone splits
curl -s -b $TMPDIR/taku.txt -d "description=Tolls&amount=703&paidBy=$TAKU_ID&splitMode=all" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null -w "Expense2: %{http_code}\n"
# Clayton pays 2880, everyone splits
curl -s -b $TMPDIR/clayton.txt -d "description=Hotel&amount=2880&paidBy=$CLAYTON_ID&splitMode=all" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null -w "Expense3: %{http_code}\n"

echo "=== 9. Calculate split (as admin = Owen) ==="
curl -s -b $TMPDIR/owen.txt -X POST "$BASE/g/$GROUP_ID/calculate" -o /dev/null -w "Calculate status: %{http_code}\n"

echo "=== 10. Check dashboard settlement output ==="
curl -s -b $TMPDIR/owen.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash2.html
python3 - "$TMPDIR/dash2.html" << 'PYEOF'
import re, sys
html = open(sys.argv[1]).read()
transfers = re.findall(r'<strong>([^<]+)</strong>\s*<span class="arrow">[^<]*</span>\s*<strong>([^<]+)</strong>.*?class="amt">([^<]+)<', html, re.S)
for t in transfers:
    print(t)
PYEOF

echo "=== 11. Test custom split: AT pays 400 for just Owen+Taku ==="
curl -s -b $TMPDIR/at.txt -d "description=Snacks&amount=400&paidBy=$AT_ID&splitMode=custom&participantIds=$OWEN_ID&participantIds=$TAKU_ID" -X POST "$BASE/g/$GROUP_ID/expenses" -o /dev/null -w "Custom expense status: %{http_code}\n"

curl -s -b $TMPDIR/owen.txt -X POST "$BASE/g/$GROUP_ID/calculate" -o /dev/null -w "Recalculate status: %{http_code}\n"
curl -s -b $TMPDIR/owen.txt "$BASE/g/$GROUP_ID" -o $TMPDIR/dash3.html
python3 - "$TMPDIR/dash3.html" << 'PYEOF'
import re, sys
html = open(sys.argv[1]).read()
transfers = re.findall(r'<strong>([^<]+)</strong>\s*<span class="arrow">[^<]*</span>\s*<strong>([^<]+)</strong>.*?class="amt">([^<]+)<', html, re.S)
print("After custom-split expense added, transfers:")
for t in transfers:
    print(t)
PYEOF

echo "GROUP_ID=$GROUP_ID" >> $TMPDIR/ids.env
