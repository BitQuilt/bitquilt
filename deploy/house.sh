#!/bin/sh
# The house second opinion (docs/DEPLOY.md, "The house second opinion"): the `house` service in docker-compose.yml runs
# this loop from the same image as the tracker. Every HOUSE_EVERY seconds (900) it runs the OpenAI worker with
# --second-only --all: the CLI under QUILT_NEXT_ONLY=verify hands out only pieces another vendor has already returned,
# on every problem the tracker lists with such pieces, at most HOUSE_MAX (20) in a run. It never takes an open piece.
# The key it signs with lives under QUILT_HOME, on a volume; it is made on the first run and named once. Its twelve
# words are not printed: the key file is the key, and a lost volume means a new house key, nothing more. With no
# OPENAI_API_KEY nothing runs and the log says so; with HOUSE=off the same. Nothing here prints the API key.
set -u
cd "$(dirname "$0")/.."
EVERY="${HOUSE_EVERY:-900}"
MAX="${HOUSE_MAX:-20}"
MODEL="${HOUSE_MODEL:-gpt-6-luna}"
say() { echo "house $(date -u +%Y-%m-%dT%H:%M:%SZ): $*"; }
quilt() { ${QUILT_BIN:-quilt} "$@"; }

if [ "${HOUSE:-on}" = off ]; then
  say "HOUSE=off: the house second opinion is switched off, and nothing runs until the service is brought up with it on"
  while :; do sleep 86400; done
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  say "OPENAI_API_KEY is empty: nothing runs until it is set in deploy/.env and the service is brought up again"
  while :; do sleep 86400; done
fi

# The first run: a key under QUILT_HOME, and its name on the tracker's identity log. The address is the first line
# quilt init prints; the phrase on the lines after it stays unprinted.
if [ ! -f "${QUILT_HOME:?QUILT_HOME names where the key lives}/key" ]; then
  say "no key under $QUILT_HOME, making one"
  quilt init 2>&1 | head -1
  [ -f "$QUILT_HOME/key" ] || { say "the key was not made"; exit 1; }
  if quilt name "House second opinion" >/dev/null 2>&1; then say "the key is named House second opinion"; else say "the name was not posted; quilt name can be run again by hand"; fi
fi
say "the house second opinion answers as openai/$MODEL, at most $MAX pieces every $EVERY seconds, on $QUILT_TRACKERS"

while :; do
  # What waited in the queue while no tracker answered (the name on the first run, a return during a restart) goes out first.
  quilt flush >/dev/null 2>&1 || true
  node examples/worker-openai.mjs --second-only --all --max "$MAX" --model "$MODEL" || say "the worker exited with $?"
  sleep "$EVERY"
done
