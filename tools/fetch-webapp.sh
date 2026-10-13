#!/usr/bin/env bash
# Download the EA FC Ultimate Team web app JS bundles into reference/webapp/.
# The bundles are public (no login needed) and contain every class/method name
# fsu.js hooks, so the hook audit can run offline.
#
# Usage: bash tools/fetch-webapp.sh
set -euo pipefail

BASE="https://www.ea.com/ea-sports-fc/ultimate-team/web-app"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
OUT="$(cd "$(dirname "$0")/.." && pwd)/reference/webapp"

mkdir -p "$OUT"
cd "$OUT"

echo "==> 拉取入口页，解析 build 号"
curl -sL -m 30 -A "$UA" "$BASE/" -o index.html
BUILD=$(grep -oE 'js/compiled_1\.js\?_=[0-9]+' index.html | head -1 | grep -oE '[0-9]+$')
if [ -z "$BUILD" ]; then
    echo "解析 build 号失败，入口页结构可能已变，请手工检查 $OUT/index.html" >&2
    exit 1
fi
echo "    build = $BUILD"

for f in compiled_1 compiled_2 compiled_3 compiled_4 ocompiled; do
    curl -sL -m 90 -A "$UA" "$BASE/js/$f.js?_=$BUILD" -o "$f.js" \
        -w "    $f.js  HTTP %{http_code}  %{size_download}B\n"
done

cat compiled_1.js compiled_2.js compiled_3.js compiled_4.js ocompiled.js > all.js
echo "$BUILD" > BUILD

echo "==> 合并为 all.js  ($(wc -c < all.js | tr -d ' ') 字节)"
echo "==> 赛季常量"
grep -ohE "APP_YEAR *= *parseInt[^,]*,APP_YEAR_SHORT *= *[^,]*" all.js | head -1 || true
echo
echo "完成。接着运行： node tools/static-audit.js"
