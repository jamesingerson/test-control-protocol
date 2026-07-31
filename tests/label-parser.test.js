'use strict';

const assert = require('assert');
const {
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
} = require('../src/labelParser');

// Builds a fixed-column I-line: 7-char blank line-number field, "I ", then
// each field padded to 9 chars (8 content + 1 separator), matching the
// convention used throughout tests/fixtures/*.tcp and the real grammar.
const LN = ' '.repeat(7);
function iLine(label, ...fields) {
  return LN + 'I ' + label.padEnd(9) + fields.map((f) => f.padEnd(9)).join('').trimEnd();
}

// Builds a fixed-column data-declaration line (A/M/N/R/S/H): the type
// letter, then the label field, then any remaining fields.
function dataLine(type, label, ...fields) {
  return LN + type + ' ' + label.padEnd(9) + fields.map((f) => f.padEnd(9)).join('').trimEnd();
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

run('findLabelReferences finds CR TEST/CR CRS op2 and op3 as branch labels, not op1 (real BIO shape)', () => {
  // Real shape: "CR TEST FLK-P FLK-H RES1-C" -- FLK-P is a data reference
  // (covered by findDataReferences instead), FLK-H/RES1-C are real I-line
  // branch labels declared elsewhere in the block.
  const lines = [iLine('', 'CR TEST', 'FLK-P', 'FLK-H', 'RES1-C'), iLine('', 'CR CRS', 'GLOC-P')];
  const refs = findLabelReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['FLK-H', 'RES1-C']
  );
});

run('findLabelReferences tolerates a blank op2 for CR CRS without swallowing op3 (real EPP-P/EPP-C shape)', () => {
  // Real shape: op1=EPP-P (data ref), op2 genuinely blank, op3=EPP-C (label).
  const line = LN + 'I ' + ''.padEnd(9) + 'CR CRS'.padEnd(9) + 'EPP-P'.padEnd(18) + 'EPP-C';
  const refs = findLabelReferences([line]);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['EPP-C']
  );
});

run('findLabelReferences finds CR REQ op2/op3 as branch labels, the same shape as CR TEST/CR CRS (real BIO shape)', () => {
  const lines = [iLine('', 'CR REQ', 'REQ-P', 'REQ-H', 'REQ-L')];
  const refs = findLabelReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['REQ-H', 'REQ-L']
  );
});

run('findLabelReferences does not treat CR COM as having label operands (confirmed: never has op2/op3 in the real corpus)', () => {
  const lines = [iLine('HBACOMS', 'CR COM', 'HBAC-P')];
  assert.strictEqual(findLabelReferences(lines).length, 0);
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

run('findNormalxTestReferences extracts op1 as a test-code reference (real "NORMALX 0710" shape), not a data box or label', () => {
  const lines = [iLine('TPX', 'NORMALX', '0710')];
  const refs = findNormalxTestReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.code),
    ['0710']
  );
  assert.strictEqual(findDataReferences(lines).length, 0);
  assert.strictEqual(findLabelReferences(lines).length, 0);
});

run('findNormalxTestReferences does not require an operand for a bare NORMALX (real, common, 157 of 366 real occurrences)', () => {
  const lines = [iLine('', 'NORMALX')];
  assert.strictEqual(findNormalxTestReferences(lines).length, 0);
});

run('findNormalxTestReferences is unaffected by NORMAL matching (the existing \\b boundary already excludes NORMALX from DATA_REFERENCE_RE)', () => {
  const lines = [iLine('', 'NORMALX', '0710')];
  assert.strictEqual(findDataReferences(lines).length, 0);
});

run('findInvalidNormalxDateTypes accepts all six documented values, independent of op1 (real "NORMALX  DATE REG" shape)', () => {
  const lines = [
    iLine('', 'NORMALX', '0710', 'DATE REG'),
    iLine('', 'NORMALX', '', 'DATE ARR'),
    iLine('', 'NORMALX', '', 'DATE COL'),
    iLine('', 'NORMALX', '', 'DATESPEC'),
    iLine('', 'NORMALX', '', 'ENTDATE'),
    iLine('', 'NORMALX', '', 'AUTHDATE'),
  ];
  assert.strictEqual(findInvalidNormalxDateTypes(lines).length, 0);
});

run('findInvalidNormalxDateTypes flags a value outside the six documented global dates', () => {
  const lines = [iLine('', 'NORMALX', '0710', 'DATE XXX')];
  const invalid = findInvalidNormalxDateTypes(lines);
  assert.deepStrictEqual(
    invalid.map((i) => i.value),
    ['DATE XXX']
  );
});

run('findInvalidNormalxDateTypes does not require op2 (optional, defaults to DATE REG per the manual)', () => {
  const lines = [iLine('', 'NORMALX', '0710'), iLine('', 'NORMALX')];
  assert.strictEqual(findInvalidNormalxDateTypes(lines).length, 0);
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

run('findUnrecognizedOpcodes does not flag known built-in keywords, including multi-word and comma-suffixed ones', () => {
  const lines = [
    iLine('', 'GOTO,EQ', 'TARGET'),
    iLine('', 'CR TEST', 'FLK-P'),
    iLine('', 'NORMAL2', 'RRANGE'),
    iLine('', 'GROUP', 'TITLE'),
  ];
  assert.deepStrictEqual(findUnrecognizedOpcodes(lines), []);
});

run('findUnrecognizedOpcodes flags an opcode that is neither a known keyword nor (from this module\'s perspective) a macro name', () => {
  const lines = [iLine('', 'GOTOX')];
  const found = findUnrecognizedOpcodes(lines);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].opcode, 'GOTOX');
});

run('findUnrecognizedOpcodes flags a macro-invocation-shaped opcode too (macro-name exemption is the caller\'s job, see diagnostics.js)', () => {
  const lines = [iLine('DRUGM', 'DRUGMCR')];
  const found = findUnrecognizedOpcodes(lines);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].opcode, 'DRUGMCR');
});

run('findDataDeclarations finds A/M/N/R/S/H-line labels, a separate namespace from I-line branch labels', () => {
  const lines = [
    dataLine('A', 'TITLE', 'Procalcitonin'),
    dataLine('M', 'MASK1', 'x'),
    dataLine('N', 'REF', '0.10', '5.00'),
    dataLine('R', 'RRANGE', '1.00', '2.00'),
    dataLine('S', 'SRANGE', '0', '10'),
    dataLine('H', 'CRLF', '0D0A'),
  ];
  const decls = findDataDeclarations(lines);
  assert.deepStrictEqual(
    decls.map((d) => d.label),
    ['TITLE', 'MASK1', 'REF', 'RRANGE', 'SRANGE', 'CRLF']
  );
});

run('findDataReferences resolves NORMAL/CR TEST/CR CRS/GROUP operand1 against declared data labels (real BIO shape)', () => {
  // Real production shapes: "NORMAL RRANGE", "CR TEST FLK-P ...", "GROUP TITLE".
  const lines = [iLine('', 'NORMAL', 'RRANGE'), iLine('', 'CR TEST', 'FLK-P', 'FLK-H'), iLine('', 'GROUP', 'TITLE')];
  const refs = findDataReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['RRANGE', 'FLK-P', 'TITLE']
  );
});

run('findDataReferences resolves CR REQ/CR COM operand1 too (confirmed as two more members of the same CR family)', () => {
  // Real shapes: "CR REQ REQ-P REQ-H REQ-L", "CR COM HBAC-P" (or bare "CR COM").
  const lines = [iLine('', 'CR REQ', 'REQ-P', 'REQ-H', 'REQ-L'), iLine('HBACOMS', 'CR COM', 'HBAC-P')];
  const refs = findDataReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['REQ-P', 'HBAC-P']
  );
});

run('findDataReferences does not require an operand for a bare CR COM (real, common, 4 of 6 real occurrences)', () => {
  const lines = [iLine('', 'CR COM')];
  assert.strictEqual(findDataReferences(lines).length, 0);
});

run('findPrintDataReferences resolves op2 (not op1, which is a print-column number) for PRINT/PRINT,H/PRINT,A', () => {
  // Real shapes: "PRINT 1 TITLE", "PRINT,H 1 DATA1", "PRINT,A 50 DATA2 5".
  const lines = [iLine('', 'PRINT', '1', 'TITLE'), iLine('', 'PRINT,H', '1', 'DATA1'), iLine('', 'PRINT,A', '50', 'DATA2', '5')];
  const refs = findPrintDataReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['TITLE', 'DATA1', 'DATA2']
  );
});

run('findPrintDataReferences does not check PRINT,R (never has op2) or PRINT,J (different real semantics)', () => {
  const lines = [iLine('', 'PRINT,R', '21'), iLine('', 'PRINT,J', '31', '>60')];
  assert.strictEqual(findPrintDataReferences(lines).length, 0);
});

run('findPrintDataReferences resolves against the expanded implicit global catalogue (real DATE/TIME/NAME shapes)', () => {
  const lines = [iLine('', 'PRINT', '+1', 'DATE'), iLine('', 'PRINT', '+1', 'TIME'), iLine('', 'PRINT', '+1', 'NAME')];
  assert.strictEqual(findPrintDataReferences(lines).length, 0);
});

run('findGotoIrDataReferences resolves op3 (a range reference), not op1 (a branch label, checked elsewhere)', () => {
  // Real shape: "GOTO,IR SCHECK VALUE SIGNIF" -- SCHECK is a branch label
  // (findLabelReferences' job), SIGNIF is the range reference.
  const lines = [iLine('', 'GOTO,IR', 'SCHECK', 'VALUE', 'SIGNIF')];
  const refs = findGotoIrDataReferences(lines);
  assert.deepStrictEqual(
    refs.map((r) => r.label),
    ['SIGNIF']
  );
});

run('findGotoIrDataReferences excludes the special comparison keywords RANGE/RANGE2 (206+4 of 210 real "unresolved" instances)', () => {
  const lines = [iLine('', 'GOTO,IR', 'FIN', 'VALUE', 'RANGE'), iLine('', 'GOTO,IR', 'FIN', 'VALUE', 'RANGE2')];
  assert.strictEqual(findGotoIrDataReferences(lines).length, 0);
});

run('findDataReferences excludes the implicit built-in TCPNAME box (real GROUP TCPNAME shape)', () => {
  const lines = [iLine('', 'GROUP', 'TCPNAME')];
  assert.ok(isImplicitDataLabel('TCPNAME'));
  assert.strictEqual(findDataReferences(lines).length, 0);
});

run('findDataReferences does not treat SIGNOUT or MOVE,D operands as data references (rejected candidates)', () => {
  // Real shapes: "SIGNOUT 9966" (a test code, not a data label) and
  // "MOVE,D VALUE TV2" (VALUE is the special CRS-parsing keyword, not a
  // declared data box) -- neither keyword is in the whitelist.
  const lines = [iLine('', 'SIGNOUT', '9966'), iLine('', 'MOVE,D', 'VALUE', 'TV2')];
  assert.strictEqual(findDataReferences(lines).length, 0);
});

run('findDataReferences does not mistake a distant trailing comment for a blank GROUP/NORMAL operand (real HAEM/HISTO shape)', () => {
  // Real shape: "I NEXT     GROUP                               No" --
  // GROUP's own operand1 field is genuinely blank; "No" is a trailing
  // free-text comment many blank fields later, not an operand.
  const line = LN + 'I NEXT     GROUP' + ' '.repeat(31) + 'No';
  assert.strictEqual(findDataReferences([line]).length, 0);
});

run('findMissingDataOperands flags NORMAL/CR TEST/CR CRS/CR REQ used with a blank operand', () => {
  const lines = [iLine('', 'NORMAL'), iLine('', 'CR TEST'), iLine('', 'CR CRS'), iLine('', 'CR REQ')];
  const missing = findMissingDataOperands(lines);
  assert.deepStrictEqual(
    missing.map((m) => m.keyword),
    ['NORMAL', 'CR TEST', 'CR CRS', 'CR REQ']
  );
});

run('findMissingDataOperands does not flag a bare GROUP or CR COM with no operand (real, common patterns in production)', () => {
  const lines = [iLine('', 'GROUP'), iLine('', 'CR COM')];
  assert.strictEqual(findMissingDataOperands(lines).length, 0);
});

run('findMissingDataOperands does not flag NORMAL/CR TEST/CR CRS when a real operand is present', () => {
  const lines = [iLine('', 'NORMAL', 'RRANGE'), iLine('', 'CR TEST', 'FLK-P')];
  assert.strictEqual(findMissingDataOperands(lines).length, 0);
});

run('isGlobalDataFile detects the real GLOBAL header shape', () => {
  const globalFile = [LN + 'GLOBAL ALPHA DATA', dataLine('A', 'SPACE', '_')];
  const normalFile = [LN + 'T0302 Procalcitonin', dataLine('A', 'TITLE', 'x')];
  assert.strictEqual(isGlobalDataFile(globalFile), true);
  assert.strictEqual(isGlobalDataFile(normalFile), false);
});

console.log('all label-parser tests passed');
