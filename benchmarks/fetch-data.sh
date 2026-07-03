#!/usr/bin/env bash
# Fetches the VON Similo LLM replication dataset (Nass et al.) into data/.
# The dataset is not committed to this repo; run this once before benchmarking.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
git clone --depth 1 https://github.com/michelnass/SimiloLLM "$tmp/SimiloLLM"
mkdir -p data
cp "$tmp/SimiloLLM"/{old.txt,new.txt,oracles.txt} data/
rm -rf "$tmp"
echo "Dataset ready in benchmarks/data/"
