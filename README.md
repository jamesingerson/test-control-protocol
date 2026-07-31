# test-control-protocol README

Naive syntax highlighting for Test Control Protocol (TCP) files for the Delphic LIS, plus basic label/GOTCP verification diagnostics.

## Features

Primitive support based on existing Pathlab TCP's:

<img src="https://github.com/pl-jamesi/test-control-protocol/blob/master/images/tcp-highlighting-example.png?raw=true" alt="Example TCP Highlighting" width="600px" />

Also has folding:

<img src="https://github.com/pl-jamesi/test-control-protocol/blob/master/images/collapse-tcp.gif?raw=true" alt="Example TCP Folding" width="800px" />

Also flags undefined/duplicate labels and unresolved GOTCP targets as you edit — see the Diagnostics section below.

## Requirements

Pathlab TCP files do not have an extension, so you need to declare the file type association in VS Code yourself:

In the directory where you're working, if it does not already exist create a .vscode folder, within that, settings.json.

```
{
  "editor.rulers": [7, 18, 27, 36, 45, 54, 80],
  "editor.wordBasedSuggestions": false,
  "workbench.colorCustomizations": {
    "editorRuler.foreground": "#424242"
  },
  "files.associations": {
    "**/testlisv10-tcp/**/*.gitignore": "txt",
    "**/testlisv10-tcp/**/TCP_LIST*": "shellscript",
    "**/testlisv10-tcp/**/*.json": "json",
    "**/testlisv10-tcp/**/*": "testcontrolprotocol"
  }
}
```

(Rulers are optional.)

## Installation

- In `<user home>/.vscode/extensions` folder `git clone https://github.com/pl-jamesi/test-control-protocol.git` and restart VS Code.
- If you're updating an existing install (`git pull` in that folder), **reload or restart VS Code afterwards**. Since 0.2.0 this extension runs real code on activation (previously it was pure declarative syntax highlighting) — VS Code won't pick up a changed activation entry point in an already-running extension host without a reload.

## Diagnostics

As you edit, this extension flags:

- GOTO/GOSUB/DATE/GET/SEARCH/CR TEST/CR CRS/CR REQ/CR REQL/REQPRIOR/OPENFILE/COPYDR/CRDX/REQUEST/REQNEXT/GETSPEC references to a label with no matching definition
- Duplicate label definitions
- GOTCP/NORMALX references to a test code that doesn't exist anywhere in the workspace
- `NORMAL`/`CR TEST`/`CR CRS`/`CR REQ`/`CR REQL`/`CR COM`/`GROUP`/`PRINT`/`PRINT,H`/`PRINT,A`/`GOTO,IR`/`MOVE,AV`/`MOVE,AP`/`TESTADD`/`HL7SET`/`ALPHA`/`CHARGE`/`CHECK*`/`REPTKEY`/`TESTRES`/`STATS`/`NUMERIC`/`ERROR`'s and `GOTO`/`GOSUB`'s condition-code families operands with no matching data declaration (a warning, not an error — see below)
- `NORMAL`/`CR TEST`/`CR CRS`/`CR REQ`/`CR REQL`/`MOVE,AV`/`MOVE,AP`/`TESTADD`/`HL7SET`/`CHARGE`/`CHECK*`/`REPTKEY` used with no operand at all — but not `GROUP`, `CR COM`, or `ALPHA`, where a bare keyword with no operand is a real, common pattern, not a mistake
- `NORMALX`'s 2nd operand, if present, must be one of six documented global dates (`DATE REG`/`DATE ARR`/`DATE COL`/`DATESPEC`/`ENTDATE`/`AUTHDATE`) — anything else is flagged, and also highlighted red (invalid) rather than just losing its colour
- `SEARCH`'s 2nd operand (item keyword) must be one of 13 documented words (`PATIENT`/`NAME`/`REQUEST`/`DATETIME`/`ARRSET`/`REPORTED`/`TRACKED`/`TEST`/`GROUP`/`CONSTIT`/`ANTIBODY`/`PRODUCT`/`TESTDEPT`) — anything else is flagged and highlighted red the same way
- An I-line opcode that's neither a recognized instruction keyword nor a known macro invocation (a likely typo or misaligned column)
- A `T`/`Q` test code declared more than once across the workspace (or twice in the same file) — an error, since any `GOTCP`/`NORMALX` reference to it would be ambiguous
- A `T`/`Q` test code declared out of ascending numeric order relative to the one before it in the same file — an error
- A test that doesn't end with a terminal instruction (`END`, or a bare `GOTCP` to another test that itself terminates) — a warning, since this isn't a documented requirement, just longstanding real-corpus convention

Checks run on-change, debounced, so they don't run on every keystroke. They're scoped per `T`/`Q` test-definition block, not per file — a single file can legitimately bundle many separate test scripts, each with its own label namespace — and are macro-aware, so a block that invokes a `D`-defined macro inherits that macro's internal labels and data declarations as valid targets. Data-reference checks also resolve against the workspace's `GLOBAL` file and a curated set of ~80 implicit built-in system fields (patient/request/report metadata like `DATE`, `TIME`, `NAME`, `TESTCODE`, `DRNAME`...; `TCPNAME` was the first one found, since documented directly in the Introduction Manual). `~`-prefixed macro-internal labels are exempted from all checks, since they're only disambiguated at assembly time. `CR TEST`/`CR CRS`/`CR REQ`/`CR REQL`'s 2nd and 3rd operands are branch labels (checked and coloured like a GOTO target), not data references — either can be legitimately blank; `CR COM` shares the same op1 data-reference shape but never has label operands. `PRINT`/`PRINT,H`/`PRINT,A`'s data reference sits at the 2nd operand instead of the 1st (the 1st is a print-column number). `GOTO,IR`'s sits at the 3rd operand (a range reference, e.g. `GOTO,IR SCHECK VALUE SIGNIF`) — its own 1st operand is still a branch label, checked the same way a plain `GOTO` target is. `NORMALX`'s 1st operand is a test-code reference like `GOTCP`'s target (teal, not the blue used for data references), not a data box; its independent 2nd operand is a fixed 6-word vocabulary (highlighted like `SEARCH`'s own fixed-vocabulary item word). The unrecognized-instruction check's own keyword list is derived from a full census of the real production corpus plus the Reference Manual's own instruction catalogue; a workspace's own macro names (from the same macro index used for label injection) are always additionally recognized, so a legitimate custom macro call is never flagged. `REQPRIOR`/`OPENFILE`/`COPYDR`/`CRDX`/`REQUEST`/`REQNEXT`/`GETSPEC` are a small family whose only operand is a branch label (like GOTO's target) but without any condition-code variants; `COPYDR`'s own optional 2nd operand (the special keyword `FIRST`) isn't parsed. `MOVE,AV`/`MOVE,AP`/`TESTADD`/`HL7SET`/`ALPHA`/`CHARGE`/`CHECK*`/`REPTKEY`'s data reference sits at the 1st operand; `TESTRES`/`STATS`/`NUMERIC`'s sits at the 2nd. `ERROR`'s 2nd and 3rd operands are both potential data references (the manual documents them as two symmetric "condition operand" slots); `GOTO`/`GOSUB`'s condition-code family (`EQ`/`NE`/`GE`/`LE`/`LT`/`OR`, plus `M`/`MM`) checks the 3rd operand the same way, and *additionally* the 2nd for the `M`/`MM` list-membership variants specifically, since only those have a genuinely different, confirmed-clean 2nd-operand shape — `GOTO,GT` is deliberately excluded (a real, not-yet-explained gap), and none of these checks ever flag a bare numeric comparison value. Every one of the checks above is a genuine Delphic-documented built-in, never a locally-defined macro — macro-based operand candidates (e.g. `SENDRSLT`, `MICSIGN`) are deliberately left unimplemented, since hardcoding one workspace's own evolving macro vocabulary into a static check would contradict the whole point of resolving macro names live from the workspace's own index. See `TODO.md`'s "Label and GOTCP verification feature", "Undefined data reference feature", "Comprehensive operand highlighting audit", "PRINT op2 data reference", "GOTO,IR op3 range reference", "NORMALX takes a test-code operand", "Unrecognized instruction keyword feature", "SEARCH item-word diagnostic", "Pure branch-label candidates feature", "Invalid enum values render as invalid", "Duplicate test-code definitions feature", "Missing terminal instruction feature", and "Comprehensive operand highlighting audit, second pass" sections for the full design and how each was validated against real production data. The duplicate/ascending-order checks disregard `REJECT.DJS` entirely — it's not a compiled TCP source, just an auxiliary reference file that happens to reuse the same numbering scheme. A `GOTCP` ending only counts as terminal if its own target is verified (workspace-wide, recursively) to itself terminate — it isn't accepted just for existing, and a conditional `GOTCP,EQ`-style ending never counts, since it only fires when its condition holds.

The data-reference check is deliberately narrow — only specific keywords/positions confirmed clean against real usage, not every instruction that might reference data. Sampling showed most instructions' operands aren't data references at all (numeric literals, special keywords, or something else), and a blanket check would have been mostly noise; see `TODO.md` for the analysis, the still-open backlog of unimplemented candidates, and why several plausible-looking ones (`SIGNOUT`, `MOVE,D`, `PRINT,R`, `PRINT,J`) were rejected.

`TODO.md` also tracks a larger backlog not yet implemented: a colour-taxonomy revisit (splitting "user-declared variable" from "implicit global/system field", currently both rendered the same blue) and hover/go-to-definition support for labels and variables. See [COLOURS.md](COLOURS.md) for what every scope this grammar assigns currently means, why, and its resolved colour under Dark+/Light+.

A few things worth knowing before relying on or sharing this:

- **Nothing leaves your machine.** All of this runs against files already in your workspace — no network calls, no telemetry.
- **Cross-file checks (GOTCP targets, macro-injected labels) depend on `files.associations` already covering every relevant file**, the same requirement highlighting already has (see Requirements above). If it doesn't, those specific checks silently under-report rather than break outright — a document's own internal label checks are unaffected either way.
- To find files workspace-wide, this scans everything (`**/*`) and watches everything for changes, then filters by `files.associations` itself — TCP files have no fixed extension to filter on up front, so there's no narrower pattern to watch instead. The cost of an unrelated file changing elsewhere in the workspace is just a debounce timer reset, not repeated file I/O.
- **There's currently no way to turn diagnostics off independently of highlighting** — it's all-or-nothing for now.

## Known Issues

- Highlights if line structure is more or less correct, but does not verify the validity of instructions/keywords/macros/globals — the label/GOTCP diagnostics (see Diagnostics above) are the one exception, and even those don't expand macro bodies beyond injecting their labels (a macro's own internal GOTO/GOTCP references, which use `OP1`/`OP2`/`OP3`-style parameter placeholders, are never checked).
- Assumed line numbers will be systemically removed in the future, so they are not validated or coloured.
- Trailing/overhanging free-text comments (anything left over after a line's declared fields) are highlighted as comments on every line type except `A` lines, as long as the whole line stays within 80 characters — past that, `invalid.too-long` takes over for the whole line, matching real compiler behaviour. `A` lines are excluded because their character-string field already spans the full remaining line width, leaving no room for a separate comment to exist.
- ~~Some instructions should have more intelligent highlighting, e.g. NORMAL's first operand is a reference range so the colours should match.~~ **Resolved (0.4.0)**: `NORMAL`/`CR TEST`/`CR CRS`/`GROUP`'s operand now renders in the same colour (`storage.testcontrolprotocol`) as the `A`/`M`/`N`/`R`/`S`/`H` label it references, visually tying the reference to its declaration.
- An instruction's own label (e.g. `PCT1` in `I PCT1 COMMENT PCT1`) and a GOTO/GOSUB/DATE/GET/SEARCH target referencing a label (e.g. `PCT1` in `GOTO,LE PCT1 ...`) are deliberately the same colour (`entity.name.function`) — both are "a label," whether declared or referenced, and are intentionally not visually distinguished from each other.
- `entity.name.function` (labels, above) and `support.type` (title-line code/name, GOTCP's target) have no colour rule at all under the legacy "Dark (Visual Studio)"/"Light (Visual Studio)" themes, so they render as plain unstyled text there rather than colliding with anything. Accepted tradeoff — Dark+/Light+ (the modern defaults) were prioritised since that's what's actually used for review, and both scopes were specifically chosen because they match those two themes' colours for these fields (yellow labels, teal titles/GOTCP) rather than the different colour a legacy-theme-safe scope would have produced. Run `node scripts/download-themes.js` then `npm run check-colors` to check any scope's actual rendered colour against a given theme before assuming coverage, or before assuming two scopes render distinctly just because both have "a rule" somewhere.
- Under Dark+ specifically, `markup.heading` (the `G`-line header in `TCP/GLOBAL`) and `storage` (a number/alpha-line's own label field) render the same colour — a real but low-stakes gap, since the two scopes are never used near each other in a real file.

## Contributing

All the magic happens in `syntaxes/testcontrolprotocol.tmLanguage.json` the Text mate grammar file that is used for tokenization.

You may find the following resources useful:

https://www.youtube.com/watch?v=5msZv-nKebI - walkthrough of someone else going through the experience of setting up syntax highlighting for their own language.

https://regexr.com/ - for testing regular expressions. Note, in .tmLanguage.json you have to double escape using \\, but regexr should only have one \ to escape something.

https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide - written instructions on set up and behaviour of VS Code syntax highlighting.

https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/light_vs.json - for examples of "names" to use for colouring.

## Development

- Make changes to `syntaxes/testcontrolprotocol.tmLanguage.json`
- Press `F5` to open a new window with the extension loaded.
- Create a new file with a file name suffix matching your language or otherwise manage file type association in .vscode/settings.json.
- Verify that syntax highlighting works.
- You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load saved changes.

## Testing

`npm install` then `npm test` runs, in order: plain-Node unit tests (`tests/label-parser.test.js`, `tests/workspace-index.test.js`, `tests/diagnostics.test.js`) for the label/GOTCP diagnostics logic, then [vscode-tmgrammar-test](https://github.com/PanAeon/vscode-tmgrammar-test)'s snapshot mode against the fixture files in `tests/fixtures/*.tcp`, checking the exact scope assigned to every token against a committed `.snap` file. The snapshot tests use the same tokenizer VS Code itself uses, so they catch highlighting regressions without needing to eyeball a real editor window; `src/extension.js` itself (the `vscode`-dependent activation wrapper) isn't covered by either — it needs a real Extension Development Host (`F5`) to exercise.

If you deliberately change how a line type should be scoped, run `npm run test:update` to regenerate the affected `.snap` file(s), then **read the diff carefully** before committing — the snapshot only proves the grammar is consistent with itself, not that the new scopes are correct.

Some fixtures are transcribed from real TCP content (see `images/tcp-highlighting-example.png`); others (`H`, `N`/`R`/`S` lines, `GOSUB`/`SEARCH`/`DATE`/`GOTCP`/`GET` operand shapes) are re-created generically rather than copied verbatim, since the source is proprietary — but their exact structure (field widths, valid keyword suffixes, `D`/`G` line shapes) has been checked against both the TCP Introduction/Reference manuals and real production TCP files, not just guessed from the grammar's own regexes. See `TODO.md` for what's been validated this way.

## Add more language features

- There's documentation on intellisense, hovers, and validators, etc at VS Code extenders documentation at https://code.visualstudio.com/docs
- I've not implemented any of it at this time but it may be worthwhile.
