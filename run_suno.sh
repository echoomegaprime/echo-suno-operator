#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a; . ./.env; set +a
exec node src/server.js
