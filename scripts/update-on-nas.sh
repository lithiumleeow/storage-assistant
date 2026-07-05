#!/bin/sh
set -eu

cd "$(dirname -- "$0")/.."

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example to .env and fill your NAS settings first."
  exit 1
fi

mkdir -p data

docker compose up -d --build
docker compose ps
