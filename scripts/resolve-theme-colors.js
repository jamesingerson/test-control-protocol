#!/usr/bin/env node
// Resolves the EFFECTIVE colour VS Code would actually render for every scope
// this grammar uses, against a given theme -- and flags which of our scopes
// collide (render identically) under that theme.
//
// This exists because "does scope X have a colour rule in theme Y" is NOT the
// same question as "does scope X render differently from scope Z in theme Y" --
// a theme can rule both, with the same colour (see TODO.md, 2026-07-30, for the
// incident this caught: entity.name.tag and variable.language were both
// #569cd6 in dark_vs.json/Dark+, despite both having "a rule").
//
// Usage:
//   node scripts/download-themes.js         (fetches the theme JSON files once)
//   node scripts/resolve-theme-colors.js [dark_plus.json light_plus.json ...]
//
// Scopes checked are auto-discovered from syntaxes/testcontrolprotocol.tmLanguage.json,
// so this stays in sync with the grammar without manual upkeep.

const fs = require('fs');
const path = require('path');

const THEME_DIR = path.join(__dirname, 'theme-cache');
const GRAMMAR_PATH = path.join(__dirname, '..', 'syntaxes', 'testcontrolprotocol.tmLanguage.json');
const LANG_SUFFIX = '.testcontrolprotocol';

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === '\n') { inLineComment = false; out += c; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += next; i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    out += c;
  }
  return out;
}

function loadJsonc(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const noComments = stripJsonComments(raw);
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

// Resolve a theme's effective tokenColors, following "include". Own rules are
// listed before the included base's rules, i.e. take precedence on ties.
function resolveRules(themeFile, seen = new Set()) {
  if (seen.has(themeFile)) return [];
  seen.add(themeFile);
  const theme = loadJsonc(path.join(THEME_DIR, themeFile));
  let rules = theme.tokenColors || [];
  if (theme.include) {
    rules = rules.concat(resolveRules(theme.include, seen));
  }
  return rules;
}

// Matches a selector against a token whose scope stack is just
// ["source.testcontrolprotocol", scope] -- i.e. this grammar's actual runtime
// shape. A descendant selector ("A B") requires B to match the token itself
// and A to match something higher in the stack; since our only ancestor is
// "source.testcontrolprotocol", this correctly excludes selectors like
// "string meta.image.inline.markdown" that would otherwise false-match.
function segmentPrefixMatch(selector, scope) {
  const selParts = selector.split('.');
  const scopeParts = scope.split('.');
  if (selParts.length > scopeParts.length) return false;
  return selParts.every((p, i) => p === scopeParts[i]);
}

function selectorMatches(selector, scope) {
  const parts = selector.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (!segmentPrefixMatch(last, scope)) return false;
  const ancestors = ['source.testcontrolprotocol'];
  for (let i = parts.length - 2; i >= 0; i--) {
    if (!ancestors.some(a => segmentPrefixMatch(parts[i], a))) return false;
  }
  return true;
}

function effectiveColor(rules, scope) {
  let best = null;
  rules.forEach((rule, idx) => {
    const scopes = Array.isArray(rule.scope) ? rule.scope : (rule.scope ? [rule.scope] : []);
    scopes.forEach(sel => {
      if (!selectorMatches(sel, scope)) return;
      const parts = sel.trim().split(/\s+/);
      const specificity = parts[parts.length - 1].split('.').length + parts.length;
      if (!best || specificity > best.specificity || (specificity === best.specificity && idx < best.ruleIndex)) {
        best = { specificity, ruleIndex: idx, color: rule.settings && rule.settings.foreground, matchedSelector: sel };
      }
    });
  });
  return best;
}

function discoverScopes() {
  const grammar = fs.readFileSync(GRAMMAR_PATH, 'utf8');
  const matches = grammar.matchAll(/"name":\s*"([a-zA-Z.-]+)\.testcontrolprotocol"/g);
  const scopes = new Set();
  for (const m of matches) {
    // skip the wrapper/overall line names (e.g. "alpha-line") -- those aren't
    // colour-bearing in practice, the more specific capture scopes win
    if (!m[1].includes('-line')) scopes.add(m[1]);
  }
  return [...scopes].sort();
}

function main() {
  const themeFiles = process.argv.slice(2);
  if (themeFiles.length === 0) {
    themeFiles.push('dark_plus.json', 'light_plus.json', 'dark_vs.json', 'light_vs.json');
  }
  if (!fs.existsSync(THEME_DIR)) {
    console.error(`No theme cache at ${THEME_DIR} -- run scripts/download-themes.js first.`);
    process.exit(1);
  }

  const scopes = discoverScopes();

  for (const themeFile of themeFiles) {
    console.log(`\n=== ${themeFile} ===`);
    const rules = resolveRules(themeFile);
    const byColor = {};
    scopes.forEach(scope => {
      const result = effectiveColor(rules, scope + LANG_SUFFIX);
      const color = result ? result.color : 'UNSTYLED';
      (byColor[color] = byColor[color] || []).push(scope);
    });
    Object.entries(byColor).forEach(([color, group]) => {
      const flag = group.length > 1 ? '  <-- COLLISION' : '';
      console.log(`${color.padEnd(10)} -> ${group.join(', ')}${flag}`);
    });
  }
}

main();
