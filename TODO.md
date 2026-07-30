# Outstanding items

Backlog from the grammar/colour review and testing work-through. Grouped by area; `[x]` = already done in this pass, `[ ]` = still open.

## Grammar correctness

- [x] **Title-line scope mislabelled as `hex-line`.** `title-lines` was created by copy-pasting `hex-lines` (confirmed via `git show 53a899c`) and its overall scope name was never updated. Fixed in `syntaxes/testcontrolprotocol.tmLanguage.json` — now `title-line.testcontrolprotocol`. Caught by the new snapshot tests before it could get baked in as "expected" behaviour.
- [x] **Highlighting silently disappearing for some users, depending on colour theme.** `support.type`, `variable.parameter`, and `entity.name.function` have no colour rule at all in VS Code's bundled "Visual Studio" legacy themes (`dark_vs.json`/`light_vs.json`), only in the modern Dark+/Light+ defaults — confirmed by diffing the grammar's scopes against VS Code's own theme source. Remapped to scopes with real coverage in both: `support.type` → `storage.type`, `variable.parameter` → `entity.other.attribute-name`, `entity.name.function` → `entity.name.tag`.
- [x] ~~Trailing literal `\n` in `invalid`/`comments` match patterns could fail to match the last line of a file lacking a trailing newline~~ — investigated empirically via `vscode-tmgrammar-snap` (the real VS Code tokenizer) across single-line files, multi-line files, with and without a trailing EOF newline. All matched correctly in every case tested. Not an actual bug — no action needed.
- [x] **`goto-lines` keyword alternation was inconsistent.** Fixed: wrapped the alternation in `(?:...)` so `\b`/`\s` apply uniformly to all four keywords, and capped `SEARCH` at the same 8-char field width as the others. Verified via the snapshot tests — the keyword field now spans its full 9-column width instead of leaking a stray space into the next field.
- [x] **Folding markers didn't match the grammar's own column convention.** Fixed: `language-configuration.json` now uses the fixed `.{7}` line-number field and includes `Q` as a valid title-line type in the fold start marker. Not covered by the snapshot tests (they only exercise tokenization, not folding) — worth a manual F5 check.
- [x] **`get-lines` duplicated `goto-lines`.** Its capture-scope mapping was byte-identical to `goto-lines`'s, so `GET` is now folded into the same keyword alternation instead of being a separate copy-pasted block.
- [ ] **`gotcp-lines` and the generic `instruction-lines` fallback remain separate, and can't be merged as easily.** Assessed after merging `get-lines`: `gotcp-lines` differs from `goto-lines` only in one capture (`storage.type` for the GOTCP target vs. `entity.name.tag` for GOTO/GOSUB/DATE/GET targets) — since a single TextMate capture group has one fixed scope name regardless of which regex alternative matched, merging it would either erase that colour distinction or require restructuring the whole rule into nested sub-patterns rather than one flat regex. `instruction-lines` (the no-keyword-required fallback) differs more substantially — fields 5/6/7 are all `string`, with no `entity.name.tag` field at all. Left both as-is rather than make an unreviewed call on whether the GOTCP colour distinction is intentional or another copy-paste artifact — worth a real person's judgement on whether it's meant to be preserved before merging further.

## Testing

- [x] Added snapshot-based grammar tests (`vscode-tmgrammar-snap`) — `npm test` / `npm run test:update`, fixtures under `tests/fixtures/*.tcp`. One fixture is transcribed from real content (`images/tcp-highlighting-example.png`); the rest (`H`, `N`/`R`/`S`, `D`/`Q` title lines, `GOSUB`/`SEARCH`/`DATE`/`GOTCP`/`GET`) are synthesised directly from the regexes because no real example was available — worth validating against real (sanitised) files when convenient.
- [x] Added `.gitignore` (was missing entirely — `npm install` would otherwise have staged `node_modules`).

## Manifest / packaging polish

- [x] **`"extensions": [""]` was dead weight.** Removed — the README already requires every user to manually set `files.associations`, so this empty-string extension entry never matched anything real.
- [x] **No `CHANGELOG.md`** despite repeated version bumps — added, with a 0.1.0 entry covering this pass; versions prior to 0.1.0 aren't backfilled (see `git log`).
- [ ] `author` is a bare string (`"James Ingerson"`) — fine as-is, but worth a conscious decision on whether this should attribute to Pathlab as an org given it governs internal/proprietary Delphic LIS tooling, vs. staying personal (matches the current `pl-jamesi` GitHub org in the repo URL). Left alone — not something to decide unilaterally.

## Version bump

- [x] Bumped to **0.1.0** (minor, per instruction — not the major bump floated earlier) to cover this pass of fixes.
