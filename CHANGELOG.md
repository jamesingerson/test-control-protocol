# Changelog

Notable changes to this extension. Versions prior to 0.1.0 predate this file — see `git log` for that history.

## 0.18.0

- `H`-line's own label now renders `storage` (blue), matching `A`/`M`/`N`/`R`/`S`'s own label, instead of the branch-label yellow it used before — fixes the inconsistency documented in `COLOURS.md`/`TODO.md` last release, where `H` was coloured differently even though the diagnostics logic already treats it as the same data-declaration category. Validated against all 128 real `H`-lines in the corpus.

## 0.17.0

- Added `COLOURS.md`: every scope this grammar assigns, what it's for, why it was chosen, and its resolved colour under Dark+/Light+. Found and documented a real inconsistency along the way — `H`-line's own label uses the label colour instead of the data colour, even though it's treated as data everywhere else — left as documentation, not silently changed.

## 0.16.0

- New diagnostics: a `T`/`Q` test code declared more than once across the workspace (or twice in the same file), and a test code declared out of ascending numeric order — both errors. `REJECT.DJS` (an auxiliary reference file, not a compiled TCP source) is disregarded entirely for the duplicate check, dropping the count from 32 originally-found duplicates to the 15 genuine ones. Validated against the full corpus: 30 duplicate and 41 out-of-order diagnostics, matching the pre-implementation census exactly.

## 0.15.0

- A typo'd `NORMALX` global-date or `SEARCH` item keyword now renders as `invalid` (red) instead of falling through to the neutral catch-all colour — both diagnostics already caught these, but the highlighting didn't reflect it. Grammar-only change; validated against every real `NORMALX`/`SEARCH` line in the corpus (2201 lines) with zero misclassifications.

## 0.14.0

- `REQPRIOR`/`OPENFILE`/`COPYDR`/`CRDX`/`REQUEST`/`REQNEXT`/`GETSPEC`'s single operand is now recognized and checked as a branch label, the same treatment `GOTO`'s target already had. Confirmed against all 191 real combined occurrences, 100% resolving to a real label once macro-label injection is accounted for.

## 0.13.0

- New diagnostic: `SEARCH`'s item keyword (2nd operand) is checked against its documented 13-word vocabulary (Reference Manual Error 30) — an unrecognized value is now flagged, matching the highlighting the grammar already had for it. Corrected the vocabulary count along the way: it's 13 words, not 12 — the Reference Manual's own `SEARCH` entry includes `TESTDEPT` alongside the others. Validated against the entire real corpus with zero false positives.

## 0.12.0

- `CR REQL` recognized as a sixth "CR" family member, alongside `CR TEST`/`CR CRS`/`CR REQ`/`CR COM`: op1 is a data reference, op2/op3 are branch labels (either optional). Confirmed against all 6 real occurrences in the corpus, zero deviations.

## 0.11.0

- New diagnostic: an I-line opcode that's neither a recognized instruction keyword nor a known macro invocation is now flagged (Reference Manual Error 6, "Unrecognisable instruction"). The recognized-keyword list is derived from a full census of the real production corpus plus the Reference Manual's own instruction catalogue; a workspace's own macro names (from the existing macro index) are always additionally recognized, so this never flags a legitimate custom macro call. Validated against the entire real corpus with zero false positives.

## 0.10.0

- `NORMALX` has a documented 2nd operand (per the Reference Manual: "Optional. If present, this operand must be one of the following global dates: DATE REG, DATE ARR, DATE COL, DATESPEC, ENTDATE, AUTHDATE. If not specified... the system uses DATE REG as the default"), confirmed against real data with zero deviations across 54 real occurrences. Previously miscategorised as free-text trailing comment. Now recognised and highlighted like `SEARCH`'s item keyword, and validated with a new enumerated-value check — the first of its kind in this extension — flagging anything outside those six documented words.

## 0.9.0

- `NORMALX`'s operand (e.g. `NORMALX 0710`) is a test-code reference, not a data box — confirmed against real data (209 real occurrences with an operand, 100% resolving to a real test code once a handful of non-zero-padded codes are accounted for). Now highlighted teal (matching `GOTCP`'s target) and checked against the workspace's known test codes, the same way a `GOTCP` reference is.

## 0.8.0

- `GOTO,IR`'s 3rd operand (a range reference, e.g. `GOTO,IR SCHECK VALUE SIGNIF`) is now checked for undefined references and highlighted to match its target's colour. The special comparison keywords `RANGE`/`RANGE2` ("the range already associated with this test") are exempted, the same treatment `VALUE`/`TYPE`/`RESULT`/`ELEMENT` already had.

## 0.7.0

- `PRINT`/`PRINT,H`/`PRINT,A`'s 2nd operand (a data reference — op1 is a print-column number) is now checked for undefined references and highlighted to match its target's colour, the same treatment `NORMAL`/`GROUP`/the `CR` family already had. `PRINT,R` (never has this operand) and `PRINT,J` (different real semantics — prints literal comparison text, not a box reference) are deliberately excluded.
- Significantly expanded the set of implicit built-in data boxes (previously just `TCPNAME`) to ~80 real Delphic LIS system fields (patient/request/report metadata like `DATE`, `TIME`, `NAME`, `SEX`, `TESTCODE`, `DRNAME`...), documented in the Reference Manual's "Global Data" catalogue and confirmed against real corpus usage — this was the missing piece keeping `PRINT`'s resolve rate at ~67%; with it, real usage resolves at ~99%.

## 0.6.0

- Added `CR REQ` and `CR COM` as two more members of the same "cumulative report" family as `CR TEST`/`CR CRS`, found via a corpus-wide operand audit. `CR REQ` shares `CR TEST`/`CR CRS`'s exact shape (op1 = data reference, op2/op3 = branch labels, either can be blank) and is now checked/highlighted identically. `CR COM` only ever has op1 (a data reference, sometimes omitted — confirmed against all 6 real occurrences in the corpus) — no label operands.

## 0.5.0

- `CR TEST`/`CR CRS`'s 2nd and 3rd operands are real `I`-line branch labels (e.g. `CR TEST FLK-P FLK-H RES1-C` — `FLK-H`/`RES1-C` are declared elsewhere in the block as `I FLK-H ...`/`I RES1-C ...`), not data references. They're now highlighted the same colour as other branch labels (matching GOTO targets) instead of plain operand text, and checked by the existing undefined-label diagnostic the same way a GOTO target is — including tolerating a genuinely blank op2 (e.g. `CR CRS EPP-P` with only op3 present), a real, common pattern.

## 0.4.0

- Added a missing-data-operand diagnostic: `NORMAL`, `CR TEST`, and `CR CRS` are flagged when used with a blank operand (Reference Manual Error 7). `GROUP` is deliberately excluded — a bare `GROUP` with no operand is a real, common pattern in production (101 occurrences across the corpus), not an omission.
- `NORMAL`/`CR TEST`/`CR CRS`/`GROUP`'s operand (the data reference these instructions check for undefined-reference/missing-operand) is now highlighted the same colour as the `A`/`M`/`N`/`R`/`S` label it points to, instead of the generic instruction-operand colour — visually tying the reference to its declaration.

## 0.3.0

- Added an undefined-data-reference diagnostic: `NORMAL`, `CR TEST`, `CR CRS`, and `GROUP`'s operand is flagged if it doesn't match a declared `A`/`M`/`N`/`R`/`S`/`H` data label anywhere it could legitimately come from (the same block, an invoked macro's body, or the workspace's `GLOBAL` file). Deliberately scoped to just these four keywords — sampling operand behaviour across the real production corpus showed most other instructions' first operand isn't a data reference at all (numeric literals, special CRS-parsing keywords, or something else entirely), and a couple of plausible-looking candidates (`SIGNOUT`, `MOVE,D`) were checked and rejected for exactly that reason. See `TODO.md` for the full analysis.
- Fixed a false positive in that same check: a keyword used with a genuinely blank operand, followed many blank fields later by a distant trailing comment, had that comment's first word mistaken for the operand (same bug class as an earlier number-line fix elsewhere in the grammar).

## 0.2.0

- Added label and GOTCP verification diagnostics: flags GOTO/GOSUB/DATE/GET/SEARCH references to labels with no matching definition, duplicate label definitions, and GOTCP targets with no matching test code anywhere in the workspace. Runs on-change (debounced) via a real diagnostics-producing extension activation (`onLanguage:testcontrolprotocol`) — the first non-declarative code in this extension.
- Checks are scoped per `T`/`Q` test-definition block (not per physical file — a single file can legitimately bundle hundreds of separate scripts, each with its own label namespace) and are macro-aware (a block invoking a `D`-defined macro inherits that macro's internal labels as valid targets). `~`-prefixed macro-internal labels are exempted from all checks.
- Fixed a false-positive GOTCP diagnostic when the workspace root folder is itself the TCP files' folder: the workspace-wide file scan was reusing `files.associations` glob patterns with `vscode.workspace.findFiles()`, which matches relative-to-root paths rather than full paths like `files.associations` does — this silently found zero files whenever the pattern relied on the root folder's own name (e.g. `"**/TCP/**/*"` with root `C:\repos\TCP`), making every cross-file GOTCP/macro reference look unresolved.

## 0.1.0

- Fixed highlighting silently disappearing for some users depending on their colour theme. `support.type`, `variable.parameter`, and `entity.name.function` have no colour rule in VS Code's bundled "Visual Studio" legacy themes (only in the modern Dark+/Light+ defaults). Remapped to `storage.type`, `entity.other.attribute-name`, and `entity.name.tag`, which have broad coverage across both.
- Fixed the title-line rule's scope being mislabelled `hex-line` (leftover from being copy-pasted from the hex-line rule).
- Fixed a regex precedence bug in the GOTO/GOSUB/SEARCH/DATE keyword alternation that let the keyword field consume one column short of its 9-char width, leaking a stray space into the following target field.
- Merged the `get-lines` rule into `goto-lines` (their capture-scope mapping was identical, differing only in the keyword).
- Removed the vestigial `extensions: [""]` language contribution entry — real TCP files have no extension and always require a manual `files.associations` entry anyway.
- Aligned folding markers with the grammar's fixed 7-char line-number field, and added `Q` as a valid folding start (title-lines already recognised T/D/Q).
- Added snapshot-based grammar tests (`npm test` / `npm run test:update`) against fixture files under `tests/fixtures/`, checked with the same tokenizer VS Code itself uses.
