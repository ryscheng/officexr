#!/usr/bin/env bash
# Camera-path A/B on one machine: scripts/perf/ab.sh <base-checkout> [runs per side]
# Run from the head checkout, after `pnpm install` and `bake:layout platform` in both.
# Builds the HUD preview of each checkout, runs the scenario in alternation, writes
# $PERF_RESULTS/{base,head}-N.json and summary.md (default ./perf-results), and exits 1 on a regression.
set -euo pipefail

head_dir=$(pwd)
base_dir=$(cd "$1" && pwd)
runs=${2:-2}
out=${PERF_RESULTS:-$head_dir/perf-results}
mkdir -p "$out"

# The base checkout runs the head's scenario and build config, which need nothing from the app under test.
for f in playwright.perf.config.ts tests/playwright/perf-turn.spec.ts tests/playwright/lib/perfStats.ts \
  tests/playwright/lib/componentProbe.ts packages/web/vite.hud-preview.config.ts; do
  cp "$head_dir/$f" "$base_dir/$f"
done

for dir in "$base_dir" "$head_dir"; do
  (cd "$dir/packages/web" && pnpm exec vite build --config vite.hud-preview.config.ts --configLoader runner > "$out/build-$(basename "$dir").log")
done

for i in $(seq 1 "$runs"); do
  (cd "$base_dir" && PERF_OUT="$out/base-$i.json" pnpm exec playwright test -c playwright.perf.config.ts)
  PERF_OUT="$out/head-$i.json" pnpm exec playwright test -c playwright.perf.config.ts
done

set +e
node "$head_dir/scripts/perf/compare.mjs" --fail 25 --base "$out"/base-*.json --head "$out"/head-*.json > "$out/summary.md"
status=$?
cat "$out/summary.md"
exit $status
