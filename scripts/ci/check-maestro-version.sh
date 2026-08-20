#!/usr/bin/env bash

set -euo pipefail

readonly expected_version="2.7.0"

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro ${expected_version} is required on the Android release runner." >&2
  exit 1
fi

reported="$(maestro --version 2>&1)"
resolved="${reported%%$'\n'*}"
resolved="${resolved%$'\r'}"
if [ "$resolved" != "$expected_version" ]; then
  echo "Maestro version mismatch: expected ${expected_version}, got ${resolved:-unknown}." >&2
  exit 1
fi

printf '%s\n' "$resolved"
