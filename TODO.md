# Outstanding items

Backlog from the grammar/colour review and testing work-through. Grouped by area; `[x]` = already done in this pass, `[ ]` = still open.

## Grammar correctness

- [x] **Title-line scope mislabelled as `hex-line`.** `title-lines` was created by copy-pasting `hex-lines` (confirmed via `git show 53a899c`) and its overall scope name was never updated. Fixed in `syntaxes/testcontrolprotocol.tmLanguage.json` — now `title-line.testcontrolprotocol`. Caught by the new snapshot tests before it could get baked in as "expected" behaviour.
- [x] **Highlighting silently disappearing for some users, depending on colour theme.** `support.type`, `variable.parameter`, and `entity.name.function` have no colour rule at all in VS Code's bundled "Visual Studio" legacy themes (`dark_vs.json`/`light_vs.json`), only in the modern Dark+/Light+ defaults — confirmed by diffing the grammar's scopes against VS Code's own theme source. Remapped to scopes with real coverage in both: `support.type` → `storage.type`, `variable.parameter` → `entity.other.attribute-name`, `entity.name.function` → `entity.name.tag`.
- [x] ~~Trailing literal `\n` in `invalid`/`comments` match patterns could fail to match the last line of a file lacking a trailing newline~~ — investigated empirically via `vscode-tmgrammar-snap` (the real VS Code tokenizer) across single-line files, multi-line files, with and without a trailing EOF newline. All matched correctly in every case tested. Not an actual bug — no action needed.
- [ ] **`goto-lines` keyword alternation is inconsistent.** `\bGOTO.{1,4}|GOSUB.{1,3}|SEARCH.{1,3}|DATE.{1,4}\s` — because of `|` precedence, `\b` only binds to `GOTO` and the trailing `\s` only binds to `DATE`, not applied uniformly across all four keywords. `SEARCH`'s max field width (6+3=9 chars) also exceeds the 8-char column convention the other three keywords respect. Should be `\b(?:GOTO.{1,4}|GOSUB.{1,3}|SEARCH.{0,2}|DATE.{1,4})\s`.
- [ ] **Folding markers don't match the grammar's own column convention.** `language-configuration.json`'s fold start marker uses `^.{1,7}[TD]` (variable-width line-number field, and omits `Q`) while the grammar treats the line-number field as a fixed `.{7}` and treats `Q` as a valid title-line type. Align both.
- [ ] **Heavy duplication across `goto-lines`/`gotcp-lines`/`get-lines`/`instruction-lines`.** Four near-identical blocks differing only in the embedded keyword alternation — this is exactly the copy-paste pattern that produced the title-line naming bug above, and every new instruction keyword (`GOSUB`/`GOTCP`, `GET`, `DATE`) has meant hand-copying a whole block. Worth collapsing into one pattern where only the keyword alternation varies.

## Testing

- [x] Added snapshot-based grammar tests (`vscode-tmgrammar-snap`) — `npm test` / `npm run test:update`, fixtures under `tests/fixtures/*.tcp`. One fixture is transcribed from real content (`images/tcp-highlighting-example.png`); the rest (`H`, `N`/`R`/`S`, `D`/`Q` title lines, `GOSUB`/`SEARCH`/`DATE`/`GOTCP`/`GET`) are synthesised directly from the regexes because no real example was available — worth validating against real (sanitised) files when convenient.
- [x] Added `.gitignore` (was missing entirely — `npm install` would otherwise have staged `node_modules`).

## Manifest / packaging polish

- [ ] **`"extensions": [""]` is very likely dead weight.** The README already requires every user to manually set `files.associations`, so this empty-string extension entry probably never matches anything real. Worth removing or replacing with a comment/README note explaining why it's not needed.
- [ ] **No `CHANGELOG.md`** despite 10 version bumps (0.0.1 → 0.0.10) — worth starting one, especially timed with the version bump below.
- [ ] `author` is a bare string (`"James Ingerson"`) — fine as-is, but worth a conscious decision on whether this should attribute to Pathlab as an org given it governs internal/proprietary Delphic LIS tooling, vs. staying personal (matches the current `pl-jamesi` GitHub org in the repo URL).

## Version bump

- [ ] User is considering a **major** version bump for this batch of fixes, not the usual patch bump the project has used throughout its history (0.0.1 → 0.0.10, patch-only so far, no established major/minor precedent). Needs a decision on the actual target version (e.g. `0.1.0` vs `1.0.0`) and, going forward, what "major" should mean for this extension's versioning.
