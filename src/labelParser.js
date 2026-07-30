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
    let found = extractGroup(line, GOTO_TARGET_RE, 5);
    if (!found) found = extractGroup(line, SEARCH_TARGET_RE, 5);
    if (found && !isMacroInternalLabel(found.text)) {
      results.push({ label: found.text, line: lineIndex, startCol: found.startCol, endCol: found.endCol });
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
  findLabelDefinitions,
  findLabelReferences,
  findGotcpReferences,
  findOpcodeFields,
  findMacroDefinitions,
  findTestBlocks,
};
