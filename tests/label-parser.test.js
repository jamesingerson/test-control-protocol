'use strict';

const assert = require('assert');
const {
  isMacroInternalLabel,
  findLabelDefinitions,
  findLabelReferences,
  findGotcpReferences,
  findOpcodeFields,
  findMacroDefinitions,
  findTestBlocks,
} = require('../src/labelParser');

// Builds a fixed-column I-line: 7-char blank line-number field, "I ", then
// each field padded to 9 chars (8 content + 1 separator), matching the
// convention used throughout tests/fixtures/*.tcp and the real grammar.
const LN = ' '.repeat(7);
function iLine(label, ...fields) {
  return LN + 'I ' + label.padEnd(9) + fields.map((f) => f.padEnd(9)).join('').trimEnd();
}

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

run('findLabelDefinitions finds a simple I-line label', () => {
  const lines = [iLine('PCT1', 'COMMENT', 'PCT1')];
  const defs = findLabelDefinitions(lines);
  assert.strictEqual(defs.length, 1);
  assert.strictEqual(defs[0].label, 'PCT1');
  assert.strictEqual(defs[0].line, 0);
});

run('findLabelDefinitions skips blank label fields', () => {
  const lines = [iLine('', 'GOTO', 'FIN')];
  const defs = findLabelDefinitions(lines);
  assert.strictEqual(defs.length, 0);
});

run('findLabelDefinitions flags duplicates as two separate entries (dedup is the diagnostics layer\'s job)', () => {
  const lines = [iLine('PCT1', 'COMMENT', 'A'), iLine('PCT1', 'COMMENT', 'B')];
  const defs = findLabelDefinitions(lines);
  assert.strictEqual(defs.length, 2);
  assert.strictEqual(defs[0].label, 'PCT1');
  assert.strictEqual(defs[1].label, 'PCT1');
  assert.strictEqual(defs[0].line, 0);
  assert.strictEqual(defs[1].line, 1);
});

run('findLabelDefinitions excludes ~-prefixed macro-internal labels', () => {
  assert.ok(isMacroInternalLabel('~1'));
  const lines = [iLine('~1', 'COMMENT', 'X')];
  assert.strictEqual(findLabelDefinitions(lines).length, 0);
});

run('findLabelReferences finds a GOTO target (undefined-label scenario: reference exists with no matching def)', () => {
  const lines = [iLine('', 'GOTO,LE', 'PCT1', 'VALUE', '0.50')];
  const refs = findLabelReferences(lines);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].label, 'PCT1');
  assert.strictEqual(refs[0].line, 0);
  // No corresponding definition anywhere in `lines` -- this is exactly the
  // shape the diagnostics layer will flag as Assembly Error 14.
  assert.strictEqual(findLabelDefinitions(lines).length, 0);
});

run('findLabelReferences finds GOSUB/DATE/GET targets', () => {
  const lines = [
    iLine('', 'GOSUB', 'SUB1'),
    iLine('', 'DATE,GT', 'TODAY', 'FMT'),
    // GET's target is whatever field immediately follows the keyword -- same
    // capture position as GOTO's, per the grammar's goto-lines rule (which
    // this parser mirrors exactly). "RESULT" here plays that role, not "PCT1".
    iLine('', 'GET', 'RESULT', 'PCT1'),
  ];
  const refs = findLabelReferences(lines);
  assert.deepStrictEqual(refs.map((r) => r.label), ['SUB1', 'TODAY', 'RESULT']);
});

run('findLabelReferences finds SEARCH op1 (branch target) but not the item keyword or criteria', () => {
  const lines = [iLine('', 'SEARCH', 'NOTFND', 'TEST', 'FIRST')];
  const refs = findLabelReferences(lines);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].label, 'NOTFND');
});

run('findLabelReferences excludes ~-prefixed macro-internal targets', () => {
  const lines = [iLine('', 'GOTO', '~1')];
  assert.strictEqual(findLabelReferences(lines).length, 0);
});

run('findGotcpReferences extracts the 4-digit test code, not treating it as a label', () => {
  const lines = [
    iLine('', 'GOTCP', 'T0400', 'START'),
    iLine('', 'GOTCP,EQ', 'T0500', 'FLAG'),
  ];
  const refs = findGotcpReferences(lines);
  assert.deepStrictEqual(refs.map((r) => r.code), ['T0400', 'T0500']);
  // GOTCP targets must never leak into label-reference results.
  assert.strictEqual(findLabelReferences(lines).length, 0);
});

run('a well-formed GOTO,MM target line reports correct column ranges', () => {
  const lines = [iLine('', 'GOTO,MM', 'PCT1', 'TEMPLATE')];
  const refs = findLabelReferences(lines);
  assert.strictEqual(refs.length, 1);
  const { startCol, endCol, label } = refs[0];
  assert.strictEqual(lines[0].slice(startCol, endCol), label);
});

run('findTestBlocks splits a file into per-T/Q-header blocks (real files bundle many scripts per physical file)', () => {
  const lines = [
    LN + 'T0302 Procalcitonin',
    iLine('', 'GOTO', 'FIN'),
    iLine('FIN', 'END'),
    LN + 'T0400 Another Test',
    iLine('', 'GOTO', 'FIN'),
    iLine('FIN', 'END'),
  ];
  const blocks = findTestBlocks(lines);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].name, 'T0302');
  assert.strictEqual(blocks[0].startLine, 0);
  assert.strictEqual(blocks[0].endLine, 3);
  assert.strictEqual(blocks[1].name, 'T0400');
  assert.strictEqual(blocks[1].startLine, 3);
  assert.strictEqual(blocks[1].endLine, 6);
});

run('findMacroDefinitions splits a file into per-D-header macro bodies', () => {
  const lines = [
    LN + 'D DRUGMCR',
    iLine('CONT', 'GOTO,EQ', 'DCHECK', 'VALIDATE', '1'),
    iLine('ENDMCR', 'END'),
    LN + 'D OTHERMAC',
    iLine('', 'END'),
  ];
  const macros = findMacroDefinitions(lines);
  assert.strictEqual(macros.length, 2);
  assert.strictEqual(macros[0].name, 'DRUGMCR');
  assert.strictEqual(macros[0].startLine, 0);
  assert.strictEqual(macros[0].endLine, 3);
  // The macro body's own labels are recoverable by slicing + re-running
  // findLabelDefinitions -- this is exactly how the diagnostics layer will
  // resolve macro-injected labels for a calling block.
  const bodyLabels = findLabelDefinitions(lines.slice(macros[0].startLine, macros[0].endLine));
  assert.deepStrictEqual(bodyLabels.map((d) => d.label), ['CONT', 'ENDMCR']);
});

run('findOpcodeFields extracts the field after the label on every I-line, matching real macro-invocation shape', () => {
  // Real production shape (BIO, T0750 block): "I DRUGM    DRUGMCR" invokes
  // a macro named DRUGMCR -- not a recognized keyword, so it never matches
  // GOTO/SEARCH/GOTCP, but its opcode field still needs to be visible so the
  // diagnostics layer can check it against the macro-name index.
  const lines = [iLine('DRUGM', 'DRUGMCR')];
  const opcodes = findOpcodeFields(lines);
  assert.strictEqual(opcodes.length, 1);
  assert.strictEqual(opcodes[0].text, 'DRUGMCR');
});

console.log('all label-parser tests passed');
