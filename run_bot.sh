#!/bin/bash
cd "$(dirname "$0")"
pkill -f "node bot/index.js"
node bot/index.js > bot_output.log 2>&1
