#!/bin/sh
if [ -f "$TMPDIR/orbit-codex-overflow" ]; then
  (trap '' TERM; exec sleep 120) &
  printf '%s' "$!" > "$TMPDIR/orbit-codex-child.pid"
  head -c 1100000 /dev/zero | tr '\000' X
  wait
  exit 0
fi
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *'"id":2'*) printf '%s\n' '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":20,"resetsAt":4102444800,"windowDurationMins":300},"secondary":{"usedPercent":40,"resetsAt":4102444800,"windowDurationMins":10080}}}}' ;;
  esac
done
