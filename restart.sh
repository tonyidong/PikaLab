#!/bin/bash
# Safely restart the bot — kills any existing instance first
PID_FILE="./data/.bot.pid"

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  echo "Killing old bot (PID $OLD_PID)..."
  kill "$OLD_PID" 2>/dev/null
  sleep 1
fi

# Also kill any stray tsx/node processes running our bot
pgrep -f "node.*tsx src/index" | xargs kill 2>/dev/null
sleep 1

echo "Starting bot..."
exec npx tsx src/index.ts
