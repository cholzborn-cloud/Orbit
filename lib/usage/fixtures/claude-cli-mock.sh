#!/bin/sh
IFS= read -r command
if [ "$command" = "/usage" ]; then
  if [ -f "$TMPDIR/orbit-claude-partial" ]; then
    printf 'Current session\n100%% used\nResets 11:59pm (UTC)\n'
    exit 0
  fi
  if [ -f "$TMPDIR/orbit-claude-overflow" ]; then
    (trap '' TERM; exec sleep 120) &
    printf '%s' "$!" > "$TMPDIR/orbit-claude-child.pid"
    head -c 600000 /dev/zero | tr '\000' X
    wait
    exit 0
  fi
  printf 'Current session\n20%% 20%% used\nResets 11:59pm (UTC)\nCurrent week (all models)\n40%% 40%% used\nResets Dec 31 at 11:59pm (UTC)\n'
fi
