#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="storage-assistant-$STAMP.tar.gz"

mkdir -p "$RELEASE_DIR"

tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='release' \
  --exclude='.env' \
  --exclude='fnos.env' \
  -czf "$RELEASE_DIR/$NAME" \
  -C "$ROOT_DIR" \
  .

echo "$RELEASE_DIR/$NAME"
