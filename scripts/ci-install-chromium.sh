#!/usr/bin/env bash
set -euo pipefail

# The Azure Ubuntu mirror stalled for 13 minutes in DEV run 40354773536.
# Use Ubuntu's archive, retaining apt signature verification, on this CI runner.
for source in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [[ -f "$source" ]]; then
    sudo sed -i 's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|https://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source"
  fi
done
sudo tee /etc/apt/apt.conf.d/80pgt-ci-network >/dev/null <<'APT'
Acquire::Retries "1";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT

# Fail clearly on infrastructure trouble; browser tests remain mandatory.
timeout --signal=TERM --kill-after=15s 240s npx --no-install playwright install-deps chromium
timeout --signal=TERM --kill-after=15s 180s npx --no-install playwright install chromium
