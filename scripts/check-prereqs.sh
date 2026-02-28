#!/usr/bin/env bash
set -euo pipefail

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf "OK      %s -> %s\n" "$name" "$("$name" --version 2>/dev/null | head -n 1 || echo "installed")"
  else
    printf "MISSING %s\n" "$name"
  fi
}

echo "Checking local prerequisites for Audio EDA Preview VS Code extension..."
check_command node
check_command npm
check_command git
check_command code
check_command yo
