# Changelog

Notable changes to this extension. Versions prior to 0.1.0 predate this file — see `git log` for that history.

## 0.1.0

- Fixed highlighting silently disappearing for some users depending on their colour theme. `support.type`, `variable.parameter`, and `entity.name.function` have no colour rule in VS Code's bundled "Visual Studio" legacy themes (only in the modern Dark+/Light+ defaults). Remapped to `storage.type`, `entity.other.attribute-name`, and `entity.name.tag`, which have broad coverage across both.
- Fixed the title-line rule's scope being mislabelled `hex-line` (leftover from being copy-pasted from the hex-line rule).
- Fixed a regex precedence bug in the GOTO/GOSUB/SEARCH/DATE keyword alternation that let the keyword field consume one column short of its 9-char width, leaking a stray space into the following target field.
- Merged the `get-lines` rule into `goto-lines` (their capture-scope mapping was identical, differing only in the keyword).
- Removed the vestigial `extensions: [""]` language contribution entry — real TCP files have no extension and always require a manual `files.associations` entry anyway.
- Aligned folding markers with the grammar's fixed 7-char line-number field, and added `Q` as a valid folding start (title-lines already recognised T/D/Q).
- Added snapshot-based grammar tests (`npm test` / `npm run test:update`) against fixture files under `tests/fixtures/`, checked with the same tokenizer VS Code itself uses.
