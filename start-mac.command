#!/bin/bash
# AutoPilot — double-click (Mac) or run ./start-mac.command (Mac/Linux)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run again."
  open https://nodejs.org 2>/dev/null
  read -r -p "Press Enter to close"; exit 1
fi
node scripts/check-node.mjs || { read -r -p "Press Enter to close"; exit 1; }

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install || { read -r -p "npm install failed. Press Enter to close"; exit 1; }
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — add your OPENAI_API_KEY there to enable AI script writing."
fi

echo "Building the web interface..."
npm run build || { read -r -p "Build failed. Press Enter to close"; exit 1; }

( sleep 5; (open http://127.0.0.1:3001 || xdg-open http://127.0.0.1:3001) >/dev/null 2>&1 ) &
echo
echo "Starting server. Keep this window open while you work. Close it (or Ctrl+C) to stop."
npm start
