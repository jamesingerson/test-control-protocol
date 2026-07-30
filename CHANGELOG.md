# Changelog

Notable changes to this extension. Versions prior to 0.1.0 predate this file — see `git log` for that history.

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
