'use strict';

// Pure text-parsing logic for the label/GOTCP verification feature -- no
// dependency on the `vscode` module, so this can be unit-tested with plain
// Node (see tests/label-parser.test.js) without needing the extension host.
//
// IMPORTANT: the regexes below intentionally mirror the shapes of the
// corresponding rules in syntaxes/testcontrolprotocol.tmLanguage.json
// (goto-lines, search-lines, gotcp-lines, and the shared I-line label field
// used by all of goto/gotcp/search/instruction-lines). If the grammar's
// column widths or keyword lists change, these must be updated to match, or
// diagnostics will silently drift out of sync with what the syntax
// highlighter considers a label/keyword/target. There is no automated check
// tying the two together -- this is a known duplication, see TODO.md.

// Every I-line's own label field: `I <label>` at columns 10-17, regardless of
// what instruction follows. Matches goto-lines/gotcp-lines/search-lines/
// instruction-lines' shared capture for this field.
const I_LINE_OWN_LABEL_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)/d;

// GOTO/GOSUB/DATE/GET's target operand -- mirrors goto-lines' match in the
// grammar exactly (same keyword alternation, same condition codes).
const GOTO_TARGET_RE =
  /^(.{7})(\bI\b\s)(.{1,8}\s)(\b(?:GOTO(?:,(?:EQ|NE|GT|GE|LT|LE|IR|OR|MM|M))?|GOSUB(?:,(?:EQ|NE|GT|GE|LT|LE|IR|OR|MM|M))?|DATE,(?:EQ|NE|GT|GE|LT|LE)|GET(?:,[EOA])?)\s+)(.{1,9}\s)?/d;

// SEARCH's op1 (branch-on-not-found target) -- mirrors search-lines' match.
// SEARCH's op2 (item keyword) and op3 (criteria) are not labels, not parsed here.
const SEARCH_TARGET_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\bSEARCH\s+)(.{1,9}\s)?/d;

// GOTCP's target -- a 4-digit test code referring to a DIFFERENT TCP file,
// not a label in this file. Mirrors gotcp-lines' match.
const GOTCP_TARGET_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\bGOTCP(?:,(?:EQ|NE|GT|GE|LT|LE))?\s+)(.{1,8}\s)?/d;

// NORMALX's op1 -- a test-code reference (like GOTCP's target), NOT a data
// box, despite NORMALX's name/family resemblance to NORMAL (which the
// existing `\b` boundary in DATA_REFERENCE_RE already correctly excludes
// NORMALX from matching). Confirmed against real production data: 366 real
// uses -- 157 bare (a legitimate common pattern, see MISSING_OPERAND_-
// style exclusions elsewhere), and of the 209 with an operand, ALL 209
// (100%) are purely numeric and resolve to a real test code somewhere in
// the workspace. 203 are exactly 4 digits and match a `testCodes` entry
// directly; the other 6 are the same real codes without a leading zero
// (`770`/`299`/`120`/`290` matching real `T0770`/`T0299`/`T0120`/`T0290`
// headers) -- `findNormalxTestReferences` zero-pads before checking, same
// as GOTCP already effectively does via 4-digit `testCodes` entries. The
// separator is bounded to `\s{1,4}` (NORMALX is 7 chars + 2 padding in its
// own 9-char field), unlike GOTCP_TARGET_RE's older unbounded `\s+` above
// -- no real "blank operand + distant trailing comment" case has been
// found for NORMALX, but there's no reason to risk it when a bounded
// pattern costs nothing.
//
// NORMALX also documents a genuine op2 (confirmed via the Reference
// Manual, not just corpus sampling this time): "Optional. If present, this
// operand must be one of the following global dates: DATE REG, DATE ARR,
// DATE COL, DATESPEC, ENTDATE, AUTHDATE. If not specified or left blank,
// the system uses DATE REG as the default." Confirmed against the real
// corpus: 54 real instances of op2, ALL 54 (100%) exactly one of these six
// words -- zero deviations. Op1 and op2 are independent (13 of the 54 have
// op2 present with op1 blank, e.g. `NORMALX           DATE REG` -- applies
// to the current test's own range, just overriding which date field is
// used). This was originally miscategorised as free-text trailing comment
// before the documented operand was found -- see NORMALX_DATE_TYPES below.
const NORMALX_TARGET_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\bNORMALX\b\s{1,4})(.{1,9}\s)?(.{1,8})?/d;

// NORMALX's fixed op2 vocabulary (see NORMALX_TARGET_RE above). Matches the
// two-word entries' exact real spacing (`DATE REG` etc. are 8 characters,
// fitting the same single field as the one-word entries).
const NORMALX_DATE_TYPES = new Set(['DATE REG', 'DATE ARR', 'DATE COL', 'DATESPEC', 'ENTDATE', 'AUTHDATE']);

// Any I-line's opcode field -- whatever token sits immediately after the own
// label, regardless of whether it's a recognized keyword (GOTO, PRINT, ...)
// or a macro invocation. Used to find macro-invocation sites: a bare
// instruction line like `I  DRUGM  DRUGMCR` has its own label DRUGM and an
// opcode field DRUGMCR that isn't a keyword at all -- it's a call into a `D
// DRUGMCR` macro defined elsewhere, which textually injects that macro's own
// labels into the calling block at assembly time. Mirrors instruction-lines'
// shared field shape (both fields optional, matching the fixed-column
// layout even when a field is blank).
const I_LINE_OPCODE_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)?(.{1,8}\s)?/d;

// A macro definition's own header line -- mirrors macro-definition-lines'
// match. Macro bodies run from one `D <name>` line up to (but not
// including) the next `D <name>` line or end of file -- confirmed against
// the real production MACRO file (254 macros, each delimited this way).
const D_LINE_NAME_RE = /^(.{7})(\bD\b\s)([^ ]{1,8})?/d;

// A/M-line's own label (alpha data declaration) -- mirrors alpha-lines' match.
const ALPHA_DATA_LABEL_RE = /^(.{7})(\b[AM]\b\s)(.{1,8}\s)/d;

// N/R/S-line's own label (numeric/range data declaration) -- mirrors
// number-lines' match.
const NUMBER_DATA_LABEL_RE = /^(.{7})(\b[NRS]\b\s)(.{1,8}\s)/d;

// H-line's own label (hex data declaration, optional field) -- mirrors
// hex-lines' match.
const HEX_DATA_LABEL_RE = /^(.{7})(\bH\b\s)(.{1,8}\s)?/d;

// The real `GLOBAL` file's header -- mirrors global-header-lines' match.
// Every A-line in a file containing this header is a globally available
// data label, not scoped to any block -- confirmed against the real
// production `GLOBAL` file (130 lines: this header, comments, and A-lines
// only, nothing else).
const GLOBAL_HEADER_RE = /^.{7}GLOBAL\s+ALPHA\s+DATA/;

// Operand1 of a small, deliberately narrow whitelist of instructions whose
// operand is confirmed (by sampling the real production corpus) to
// genuinely reference a declared A/M/N/R/S/H data label, not a numeric
// literal, a special CRS-parsing keyword (TYPE/RESULT/VALUE/ELEMENT), or
// something else entirely. Two plausible-looking candidates were checked
// and REJECTED: SIGNOUT's operand is a numeric test code (not a data
// label), and MOVE,D's operand is almost always the special word `VALUE`
// -- neither is actually "referencing declared data." `CR REQ`/`CR COM`
// confirmed as two more genuine members of the same "CR" (cumulative
// report) family as `CR TEST`/`CR CRS`, found via a corpus-wide audit
// after the fact rather than the original manual-driven pass -- see
// TODO.md's "Undefined data reference" and "Comprehensive operand audit"
// sections for the frequency analysis; this list is intentionally not
// exhaustive (the manual documents 100+ instructions, most with
// unvalidated operand semantics).
//
// The separator after the keyword is bounded to \s{1,4} (enough to finish
// out its own 9-char field: "GROUP" + 4 spaces, "NORMAL" + 3, "CR TEST"/"CR
// CRS"/"CR REQ"/"CR COM" + 2 -- all confirmed against real spacing), NOT
// unbounded \s+. A real production line can use one of these keywords with
// a genuinely blank operand1 followed, many blank fields later, by a
// distant trailing comment (e.g. `I NEXT GROUP <lots of blank fields> No`)
// -- unbounded \s+ would greedily cross every blank field in between and
// let the optional operand-capture group latch onto that far-away comment
// word instead of correctly seeing operand1 as blank. Same bug class as
// the "number-line label field swallowed its own comment" fix elsewhere in
// this grammar; confirmed via a real false positive here too (`GROUP`
// lines in HAEM/HISTO/PALMSAP each followed by a distant `No`/`for ...`
// comment, wrongly flagged as an undefined reference to that word).
const DATA_REFERENCE_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\b(?:NORMAL|CR TEST|CR CRS|CR REQ|CR COM|GROUP)\b\s{1,4})(.{1,9}\s)?/d;

// CR TEST/CR CRS/CR REQ's op2 and op3 -- confirmed against real production
// data (BIO) to be genuine I-line BRANCH labels, not data references: e.g.
// `CR TEST FLK-P FLK-H RES1-C` has `FLK-H`/`RES1-C` declared elsewhere in
// the same block as `I FLK-H PRINT 1 FLK` / `I RES1-C MOVE 1 LITPRINT`;
// `CR REQ REQ-P REQ-H REQ-L` likewise (`REQ-H`/`REQ-L` are real I-line
// labels, `REQ-P` is a declared `N` numeric label). Either or both can be
// legitimately blank (e.g. `CR CRS EPP-P` alone, or `CR CRS EPP-P <blank>
// EPP-C`; `CR REQ REQ-P REQ-H` with op3 omitted) -- each field is
// independently bounded (no shared unbounded separator between
// op1/op2/op3), so a blank middle field can't be crossed into by a later
// field the way the keyword's own separator bug could; confirmed by
// mapping real field boundaries exactly before trusting this.
// `CR COM` does NOT share this shape -- confirmed against all 6 real
// occurrences in the corpus, it never has op2/op3 at all (just an optional
// op1) -- so it's in DATA_REFERENCE_RE above but deliberately excluded
// here. NORMAL/GROUP also do NOT share this shape (their extra operands
// are numeric/keyword flags, not labels). This is intentionally a separate
// regex from DATA_REFERENCE_RE, not a generalization of it.
const CR_LABEL_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\b(?:CR TEST|CR CRS|CR REQ)\b\s{1,4})(.{1,9}\s)?(.{1,9}\s)?(.{1,8})?/d;

// PRINT/PRINT,H/PRINT,A's op2 -- a genuinely different shape from
// DATA_REFERENCE_RE's family: the data reference sits at op2, not op1
// (op1 is a print-column number, confirmed always numeric or blank across
// all 9618+ real bare-PRINT uses, never itself a reference). Confirmed via
// the corpus-wide audit: bare PRINT op2 resolves to a real/global data
// label in ~99% of non-numeric, non-blank cases once the expanded
// IMPLICIT_DATA_LABELS catalogue above is accounted for (67% direct before
// that). PRINT,H and PRINT,A share the identical shape (`PRINT,H 1
// DATE8`, `PRINT,A 50 SPACE 5`). PRINT,R and PRINT,J are deliberately
// EXCLUDED -- checked and rejected: PRINT,R's op2 is blank 100% of the
// time (349/349, no data-reference slot at all), and PRINT,J's op2 only
// resolves ~30% of the time (many real values look like literal
// comparison text, e.g. `PRINT,J 31 >60`, not a box reference) -- a
// genuinely different instruction despite the shared "PRINT" prefix.
const PRINT_DATA_REFERENCE_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\bPRINT(?:,[HA])?\b\s{1,4})(.{1,9}\s)?(.{1,9}\s)?/d;

// GOTO,IR's op3 -- a genuinely different shape from GOTO's other condition
// codes: `GOTO,IR <label> VALUE <range>` compares the current value
// against a named reference/feasible range, e.g. `GOTO,IR SCHECK VALUE
// SIGNIF`, where SIGNIF is a declared S/R-line label. Confirmed against
// real production data: 424 real uses; of the 350 where op3 is present and
// non-numeric, 140 (40%) resolve directly to a declared range label, and
// the other 210 are ALL just two literal values, `RANGE` (206) and
// `RANGE2` (4) -- a special comparison keyword (meaning "the range already
// associated with this test"), the exact same pattern as MOVE,D's `VALUE`
// rejection elsewhere in this file. Once RANGE/RANGE2 are treated as
// implicit (see IMPLICIT_DATA_LABELS), the remaining named references
// resolve 100% cleanly. GOSUB,IR has zero real occurrences in the corpus
// (kept in the alternation anyway for symmetry with GOTO's own condition
// codes, since every other one is shared between GOTO/GOSUB) -- this is
// unverified for GOSUB specifically, purely a consistency choice. Op1 is
// still validated as a branch label by the existing GOTO_TARGET_RE/
// goto-lines machinery -- this regex only concerns op3.
const GOTO_IR_DATA_REFERENCE_RE = /^(.{7})(\bI\b\s)(.{1,8}\s)(\b(?:GOTO|GOSUB),IR\b\s{1,4})(.{1,9}\s)?(.{1,9}\s)?(.{1,8})?/d;

// Keywords whose operand is confirmed NEVER genuinely blank in real
// production data (Reference Manual Error 7, "Missing operand"). GROUP and
// CR COM are deliberately excluded despite being in DATA_REFERENCE_RE
// above: a bare `GROUP` with no operand at all occurs 101 times across the
// real corpus (23% of all GROUP usage), and a bare `CR COM` occurs 4 of
// its 6 total real uses (67%) -- both legitimate, common patterns (their
// own meaning, not an omission), confirmed by checking real matching
// lines, not just an aggregate count. NORMAL/CR TEST/CR CRS/CR REQ have
// zero blank-operand instances across 1688 combined real uses, so a blank
// operand for those four is safe to treat as a genuine mistake.
const MISSING_OPERAND_KEYWORDS = new Set(['NORMAL', 'CR TEST', 'CR CRS', 'CR REQ']);

// Implicit built-in data boxes that always exist without a local A/M/N/R/S/H
// declaration -- the Reference Manual documents an entire "Global Data"
// catalogue (Core Global Data, Global Data for Modules, Global Data in
// Alphabetical Order -- ~30 pages: patient demographics, request/specimen
// data, lab info, report-printing fields, etc.), separate from both local
// declarations and the TCP/GLOBAL file's own A-line constants. TCPNAME is
// just the one example the Introduction Manual spells out in prose ("there
// is a box with the label TCPNAME...").
//
// The manual's own table for this section defeated clean extraction (a
// multi-column PDF table that both `pdftotext -layout` and plain
// `pdftotext` scramble into misaligned fragments), so this list is NOT
// transcribed from the manual directly. Instead: every genuinely
// unresolved (non-numeric, not locally/macro/globally declared) `PRINT`
// op2 value across the entire real corpus was collected (82 distinct
// values, 2660 total instances), then cross-checked against the manual's
// raw text -- 73 of 82 (covering 98.9% of instances) appear verbatim as
// real terms in the manual; the remaining 9 (`TAV3`-`TAV5`, `LONGV3`-
// `LONGV5`, `LONGAV3`-`LONGAV4`) are obvious numbered continuations of
// already-confirmed families (`TAV1`/`TAV2`, `LONGV1`/`LONGV2`,
// `LONGAV1` are all directly confirmed). This is an empirically-derived
// subset of the real catalogue -- what's actually used in this specific
// production corpus, not an attempt at the full ~30-page list. Extend it
// the same way (real corpus usage + manual cross-reference) if more
// surface later; see TODO.md's "PRINT op2 data reference" section.
const IMPLICIT_DATA_LABELS = new Set([
  'TCPNAME',
  'AGEUNITS', 'ALPHAAGE', 'ANTNAME', 'AV0', 'AV1', 'AV2', 'AV3', 'AV4',
  'CLINICNO', 'COMMENT1', 'COMMENT2', 'CUMPAGE',
  'DATE', 'DATE6', 'DATE7', 'DATE8', 'DATE11', 'DATEYEAR',
  'DOCREF', 'DRADDR1', 'DRADDR2', 'DRADDR3', 'DRADDR4', 'DRADDR5', 'DRALPHA',
  'DRBILL', 'DRCPN', 'DRDAYPH1', 'DREXT1', 'DREXT2', 'DRFACLTY', 'DRFAXNO',
  'DRNAME', 'DRNUM', 'DRSMRTKR',
  'ELEMENT', 'ENCOUNTR', 'ETHNICTY', 'FEECODE', 'FIRSTNAM', 'FREQNO',
  'HOSPNO', 'IREQNO', 'LABNAME',
  'LONGAV1', 'LONGAV2', 'LONGAV3', 'LONGAV4', 'LONGAV5',
  'LONGV1', 'LONGV2', 'LONGV3', 'LONGV4', 'LONGV5',
  'NAME', 'ONAME', 'PAGENO', 'PATCITY', 'PATSADDR', 'PATSUBUR', 'PTID',
  'REQNAME', 'REQNO', 'REQSPEC', 'RESULT', 'SEX', 'SURNAME',
  'TAV1', 'TAV2', 'TAV3', 'TAV4', 'TAV5', 'TAV6',
  'TCPUNITS', 'TESTCODE', 'TESTDESC', 'TESTNAME', 'TIME', 'TYPE', 'UCODE', 'UNAME',
  // RANGE/RANGE2: GOTO,IR's special comparison keyword (see
  // GOTO_IR_DATA_REFERENCE_RE) -- "the range already associated with this
  // test", not a named data box. Confirmed as the ENTIRE unresolved bucket
  // for GOTO,IR op3 (206 + 4 of 210 real instances). This set already mixes
  // two conceptually different things (the Reference Manual's "Global
  // Data" system fields above, e.g. DATE/TIME/NAME, vs. per-instruction
  // special comparison keywords like TYPE/RESULT/ELEMENT above and
  // RANGE/RANGE2 here) -- flagged for the planned colour-taxonomy revisit
  // (TODO.md) that intends to give these categories visually distinct
  // treatment instead of collapsing them into one "implicit" bucket.
  'RANGE', 'RANGE2',
]);

function isImplicitDataLabel(label) {
  return IMPLICIT_DATA_LABELS.has(label);
}

// A test/query definition's header line -- mirrors title-lines' match.
// Confirmed against real production data (e.g. a single physical file named
// `BIO` bundles 623 separate T/Q-delimited test scripts): GOTO/GOSUB/label
// scope is per T/Q block, NOT per physical file -- a label used in one test
// definition has no relationship to a same-named label in another, even
// within the same file. Diagnostics must scope duplicate/undefined checks
// to each block individually, exactly like macro bodies above.
const TITLE_LINE_RE = /^(.{7})([TQ]\d{4})/d;

// Macro-internal labels (the `~` prefix convention, see the TCP Introduction
// Manual): disambiguated to `~1`/`~2`/... only at assembly time by a separate
// tool. Exempted from undefined/duplicate checks in this first version --
// see TODO.md.
function isMacroInternalLabel(label) {
  return label.startsWith('~');
}

// Trims leading/trailing whitespace from a [start, end) range within `line`,
// returning null if the range is empty/all-whitespace after trimming.
function trimRange(line, start, end) {
  while (start < end && /\s/.test(line[start])) start++;
  while (end > start && /\s/.test(line[end - 1])) end--;
  if (start >= end) return null;
  return { start, end, text: line.slice(start, end) };
}

// Runs `regex` (must have the `d` flag) against `line`, extracts the group at
// `groupIndex`, trims it, and returns { text, startCol, endCol } or null if
// the line doesn't match or that group is absent/blank.
//
// A trailing "\n" is appended before matching: VS Code's tokenizer feeds each
// line to the grammar WITH its line terminator, so a field that ends exactly
// at end-of-line (no padding before EOL) still satisfies a trailing `\s` in
// the grammar's regexes via that newline. Matching on the bare line only
// (as this module's public functions do, per their documented input shape)
// would make the last field on a line invisible to `\s`-terminated capture
// groups whenever nothing pads it out to the next column boundary.
function extractGroup(line, regex, groupIndex) {
  const padded = line + '\n';
  const match = regex.exec(padded);
  if (!match || !match.indices || !match.indices[groupIndex]) return null;
  const [start, end] = match.indices[groupIndex];
  const trimmed = trimRange(padded, start, end);
  if (!trimmed) return null;
  return { text: trimmed.text, startCol: trimmed.start, endCol: trimmed.end };
}

/**
 * @param {string[]} lines document text split into lines (no newline chars)
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findLabelDefinitions(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, I_LINE_OWN_LABEL_RE, 3);
    if (found && !isMacroInternalLabel(found.text)) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * @param {string[]} lines
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findLabelReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const candidates = [
      extractGroup(line, GOTO_TARGET_RE, 5) || extractGroup(line, SEARCH_TARGET_RE, 5),
      // CR TEST/CR CRS can reference up to two branch labels (op2 and op3);
      // either, both, or neither may be present on a given line.
      extractGroup(line, CR_LABEL_RE, 6),
      extractGroup(line, CR_LABEL_RE, 7),
    ];
    for (const found of candidates) {
      if (found && !isMacroInternalLabel(found.text)) {
        results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
      }
    }
  });
  return results;
}

/**
 * @param {string[]} lines
 * @returns {Array<{code: string, line: number, startCol: number, endCol: number}>}
 */
function findGotcpReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, GOTCP_TARGET_RE, 5);
    if (found) {
      results.push({ code: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * NORMALX's op1 (see NORMALX_TARGET_RE) -- a test-code reference, same
 * category as GOTCP's target, not a data box.
 * @param {string[]} lines
 * @returns {Array<{code: string, line: number, startCol: number, endCol: number}>}
 */
function findNormalxTestReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, NORMALX_TARGET_RE, 5);
    if (found) {
      results.push({ code: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * NORMALX's op2 values that are NOT one of the six documented global-date
 * words (see NORMALX_DATE_TYPES) -- a genuine enumerated-value check, the
 * first of its kind in this codebase (every other check here concerns
 * label/data references, not "is this token one of a fixed set of
 * keywords"). Op2 is independent of op1 (op1 blank is fine here too).
 * @param {string[]} lines
 * @returns {Array<{value: string, line: number, startCol: number, endCol: number}>}
 */
function findInvalidNormalxDateTypes(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, NORMALX_TARGET_RE, 6);
    if (found && !NORMALX_DATE_TYPES.has(found.text)) {
      results.push({ value: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * A/M/N/R/S/H-line data declarations (the box a label identifies, per the
 * Introduction Manual's "every item of data is held in a box... identified
 * by a LABEL" model) -- a separate namespace from I-line branch labels.
 * @param {string[]} lines
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findDataDeclarations(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found =
      extractGroup(line, ALPHA_DATA_LABEL_RE, 3) ||
      extractGroup(line, NUMBER_DATA_LABEL_RE, 3) ||
      extractGroup(line, HEX_DATA_LABEL_RE, 3);
    if (found) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * Operand1 of the narrow NORMAL/CR TEST/CR CRS/GROUP whitelist (see
 * DATA_REFERENCE_RE) -- references into the A/M/N/R/S/H data-declaration
 * namespace, not the branch-label namespace findLabelReferences covers.
 * @param {string[]} lines
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findDataReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, DATA_REFERENCE_RE, 5);
    if (found && !isImplicitDataLabel(found.text)) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * Operand2 of PRINT/PRINT,H/PRINT,A (see PRINT_DATA_REFERENCE_RE) -- a
 * separate shape from DATA_REFERENCE_RE's family, since the reference sits
 * at op2 rather than op1.
 * @param {string[]} lines
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findPrintDataReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, PRINT_DATA_REFERENCE_RE, 6);
    if (found && !isImplicitDataLabel(found.text)) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * GOTO,IR's op3 (see GOTO_IR_DATA_REFERENCE_RE) -- a range reference,
 * excluding the special RANGE/RANGE2 comparison keywords (handled via
 * isImplicitDataLabel like everything else in that set).
 * @param {string[]} lines
 * @returns {Array<{label: string, line: number, startCol: number, endCol: number}>}
 */
function findGotoIrDataReferences(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, GOTO_IR_DATA_REFERENCE_RE, 7);
    if (found && !isImplicitDataLabel(found.text)) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

/**
 * Sites where a NORMAL/CR TEST/CR CRS instruction (never GROUP -- see
 * MISSING_OPERAND_KEYWORDS) has no operand at all. Anchors the diagnostic
 * range on the keyword itself, since there's no operand text to underline.
 * @param {string[]} lines
 * @returns {Array<{keyword: string, line: number, startCol: number, endCol: number}>}
 */
function findMissingDataOperands(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const keyword = extractGroup(line, DATA_REFERENCE_RE, 4);
    if (!keyword || !MISSING_OPERAND_KEYWORDS.has(keyword.text)) return;
    const operand = extractGroup(line, DATA_REFERENCE_RE, 5);
    if (!operand) {
      results.push({ keyword: keyword.text, line: lineIndex, startCol: keyword.startCol, endCol: keyword.endCol });
    }
  });
  return results;
}

/**
 * Whether this document is the (or a) global-data file -- every A-line
 * label it declares is available everywhere in the workspace, not scoped
 * to a block.
 * @param {string[]} lines
 * @returns {boolean}
 */
function isGlobalDataFile(lines) {
  return lines.some((line) => GLOBAL_HEADER_RE.test(line));
}

/**
 * Every I-line's opcode field (see I_LINE_OPCODE_RE), regardless of whether
 * it's a recognized keyword or a macro name -- the caller cross-references
 * against a known macro-name index to find macro invocations.
 * @param {string[]} lines
 * @returns {Array<{text: string, line: number, startCol: number, endCol: number}>}
 */
function findOpcodeFields(lines) {
  const results = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, I_LINE_OPCODE_RE, 4);
    if (found) {
      results.push({ text: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
    }
  });
  return results;
}

// Instruction keywords confirmed as genuine, universal TCP language
// built-ins -- NOT specific to any one workspace's own macro definitions.
// Derived by unioning (a) every opcode used in a real T/Q test block
// across the entire production corpus (C:\repos\TCP) that does NOT match
// any locally-defined macro name (a D-line header) anywhere in that same
// corpus, with (b) every instruction name found in the Reference Manual's
// own "Instructions in Alphabetical Order" section (82 entries, extracted
// from its linear prose layout -- unlike the multi-column "Global Data"
// tables elsewhere in the manual, this section reliably parses as one
// instruction name per line immediately followed by a line starting with
// "Function").
//
// The manual union matters: three genuine built-ins (ALPHA, GROUP,
// NUMERIC) are ALSO coincidentally macro names in this specific
// workspace's own MACRO file (`D GROUP`, `D ALPHA`, `D NUMERIC` are real
// macros here) -- the corpus-census step deliberately excludes any opcode
// matching a locally-defined macro name, precisely so this "universal"
// list doesn't accidentally bake in one workspace's own custom macro
// vocabulary (e.g. WBHBIO, DRUGMCR, PNMCR1 -- real Pathlab macro names
// that must NOT be treated as recognized everywhere; they're only
// legitimate via a live macro-name index, see opts.macroLabels in
// diagnostics.js). That filter would have silently dropped ALPHA/GROUP/
// NUMERIC too, since they collide with real local macro names -- the
// manual's independent confirmation restores them without reopening that
// hole.
//
// Lesson learned while building this list: an opcode's low frequency (or
// even single-instance rarity -- NORMAL2 was initially mistaken for a
// likely copy-paste typo, since it appears exactly once, in a spot
// structurally identical to an adjacent NORMAL) is NOT evidence of
// invalidity. Every file in the real corpus has already assembled and is
// running in production, meaning it already passed the real assembler's
// own Error 6 ("Unrecognisable instruction") check -- rarity reflects an
// uncommon real feature, not a mistake. NORMAL2 has a full Reference
// Manual entry (selects a second RANGE2 comparison range, see
// GOTO_IR_DATA_REFERENCE_RE above) confirming it's genuine. Nothing was
// excluded from this list on the basis of rarity alone -- only the
// macro-name-collision filter above deliberately excludes anything.
const KNOWN_INSTRUCTION_KEYWORDS = new Set([
  'ADD', 'ADDSPEC', 'ALIASPID', 'ALPHA', 'ANTIBIO', 'BACSTAT', 'CHARGE', 'CHECK*', 'CHECK*X',
  'CHECKSUS', 'CLEAR', 'CLOSEFIL', 'COMMENT', 'COPYDR', 'COPYTO', 'CR COM', 'CR CRS', 'CR CRSNH',
  'CR REF', 'CR REQ', 'CR REQL', 'CR TEST', 'CRDX', 'CRDX,NFT', 'CRDY', 'CRDY,NFT', 'DATECOMP',
  'DAYOFWK', 'DELTA', 'DELTA,%', 'DELTAX', 'DIAG,A', 'DIVIDE', 'DOCTOR', 'EMAILVAL', 'END',
  'EPIDIAG', 'ERROR', 'ERROR,EQ', 'ERROR,GE', 'ERROR,GT', 'ERROR,LE', 'ERROR,LT', 'ERROR,M',
  'ERROR,MM', 'ERROR,NE', 'ERROR,OR', 'EXP', 'EXTRACT', 'EXTROUT', 'FAXTO', 'FEASX', 'FIRSTDAY',
  'GET', 'GET,A', 'GET,E', 'GET,O', 'GETPARAM', 'GETSPEC', 'GETYEAR', 'GLHREP', 'GOSUB',
  'GOSUB,EQ', 'GOSUB,GE', 'GOSUB,GT', 'GOSUB,LE', 'GOSUB,LT', 'GOSUB,M', 'GOSUB,MM', 'GOSUB,NE',
  'GOTCP', 'GOTCP,EQ', 'GOTCP,GE', 'GOTCP,GT', 'GOTCP,LE', 'GOTCP,LT', 'GOTCP,NE', 'GOTO',
  'GOTO,EQ', 'GOTO,GE', 'GOTO,GT', 'GOTO,IR', 'GOTO,LE', 'GOTO,LT', 'GOTO,M', 'GOTO,MM', 'GOTO,NE',
  'GOTO,OR', 'GOTO,PCT', 'GROUP', 'HIGHLITE', 'HL7PRINT', 'HL7SET', 'INSERT', 'LAB', 'LOG', 'MOVE',
  'MOVE,A', 'MOVE,AI1', 'MOVE,AI2', 'MOVE,AP', 'MOVE,AV', 'MOVE,D', 'MOVE,I1', 'MOVE,I2', 'MOVE,N',
  'MOVE,T', 'MULTIPLY', 'NEWDATE', 'NEWLINE', 'NEWPAGE', 'NOAMEND', 'NOQUERY', 'NOREPORT',
  'NORMAL', 'NORMAL2', 'NORMAL2X', 'NORMALX', 'NUMERIC', 'NUMRSLT', 'NUMVAL', 'OPENFILE',
  'ORGANISM', 'PHONE', 'POSNEG', 'PRINT', 'PRINT,A', 'PRINT,H', 'PRINT,HJ', 'PRINT,J', 'PRINT,M',
  'PRINT,R', 'READPID', 'READREQ', 'REPT', 'REPTKEY', 'REPTMODE', 'REPTTYPE', 'REQDEBT', 'REQNEXT',
  'REQPRIOR', 'REQSTART', 'REQUEST', 'RESTORE', 'RETAIN', 'RETURN', 'REVIEW', 'SEARCH', 'SELDEL',
  'SELREP', 'SIGNOUT', 'SNOMED', 'SPECIMEN', 'SPECTYPE', 'STATS', 'STATSX', 'SUBTRACT', 'SUPRECIP',
  'TEST', 'TESTADD', 'TESTFEE', 'TESTRES', 'TESTTYPE', 'TIMEDIFF', 'TOX', 'UNAUTHX', 'USERCODE',
  'VERIFY', 'WARN', 'WRITEREC',
]);

/**
 * I-line opcodes (see I_LINE_OPCODE_RE via findOpcodeFields) that are not
 * one of the confirmed universal built-in keywords (KNOWN_INSTRUCTION_-
 * KEYWORDS) -- candidates for Reference Manual Error 6, "Unrecognisable
 * instruction". This module has no workspace context, so a candidate here
 * may still turn out to be a legitimate macro invocation -- the caller
 * (diagnostics.js) must additionally exempt any opcode matching a live
 * macro-name index (opts.macroLabels' own keys) before treating a
 * candidate as a genuine error, exactly like the existing
 * macro-label-injection pattern used for undefined-label checking.
 * @param {string[]} lines
 * @returns {Array<{opcode: string, line: number, startCol: number, endCol: number}>}
 */
function findUnrecognizedOpcodes(lines) {
  const results = [];
  for (const field of findOpcodeFields(lines)) {
    if (!KNOWN_INSTRUCTION_KEYWORDS.has(field.text)) {
      results.push({ opcode: field.text, line: field.line, startCol: field.startCol, endCol: field.endCol });
    }
  }
  return results;
}

// Turns a list of {name, line} header hits into [{name, startLine, endLine}]
// blocks, each running up to the next header (exclusive) or end of file.
function toBlocks(headers, lineCount) {
  return headers.map((header, i) => ({
    name: header.name,
    startLine: header.line,
    endLine: i + 1 < headers.length ? headers[i + 1].line : lineCount,
  }));
}

/**
 * @param {string[]} lines
 * @returns {Array<{name: string, startLine: number, endLine: number}>}
 */
function findMacroDefinitions(lines) {
  const headers = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, D_LINE_NAME_RE, 3);
    if (found) headers.push({ name: found.text, line: lineIndex });
  });
  return toBlocks(headers, lines.length);
}

/**
 * @param {string[]} lines
 * @returns {Array<{name: string, startLine: number, endLine: number}>}
 */
function findTestBlocks(lines) {
  const headers = [];
  lines.forEach((line, lineIndex) => {
    const found = extractGroup(line, TITLE_LINE_RE, 2);
    if (found) headers.push({ name: found.text, line: lineIndex });
  });
  return toBlocks(headers, lines.length);
}

module.exports = {
  isMacroInternalLabel,
  isImplicitDataLabel,
  findLabelDefinitions,
  findLabelReferences,
  findGotcpReferences,
  findNormalxTestReferences,
  findInvalidNormalxDateTypes,
  findDataDeclarations,
  findDataReferences,
  findPrintDataReferences,
  findGotoIrDataReferences,
  findMissingDataOperands,
  isGlobalDataFile,
  findOpcodeFields,
  findUnrecognizedOpcodes,
  findMacroDefinitions,
  findTestBlocks,
};
