#!/bin/bash
cd "$(dirname "$0")"
[ -f .env.local ] || cp .env.example .env.local
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale com:  brew install node@20"
  exit 1
fi
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "Instalando dependências do painel..."
  npm install || exit 1
fi
(sleep 8 && open "http://localhost:3000") >/dev/null 2>&1 &
npm run dev
