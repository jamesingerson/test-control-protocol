#!/usr/bin/env node
// Fetches the VS Code built-in theme JSON files that resolve-theme-colors.js
// checks against, into scripts/theme-cache/ (gitignored -- always re-fetch
// rather than trust a stale copy, since these are Microsoft's source of truth).

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes/';
const FILES = ['dark_plus.json', 'light_plus.json', 'dark_vs.json', 'light_vs.json'];
const OUT_DIR = path.join(__dirname, 'theme-cache');

function download(file) {
  return new Promise((resolve, reject) => {
    https.get(BASE + file, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`${file}: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(path.join(OUT_DIR, file), Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of FILES) {
    await download(file);
    console.log(`fetched ${file}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
