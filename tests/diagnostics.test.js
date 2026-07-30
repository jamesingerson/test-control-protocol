'use strict';

const assert = require('assert');
const { computeDiagnostics } = require('../src/diagnostics');

const LN = ' '.repeat(7);
function iLine(label, ...fields) {
  return LN + 'I ' + label.padEnd(9) + fields.map((f) => f.padEnd(9)).join('').trimEnd();
}
function titleLine(code, name) {
  return LN + code + ' ' + name;
}
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

run('flags an undefined label reference (Assembly Error 14 shape)', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'GOTO', 'MISSING'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].code, 'undefined-label');
  assert.strictEqual(diags[0].severity, 'error');
  assert.ok(diags[0].message.includes('MISSING'));
});

run('does not flag a label reference resolved within the same block', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'GOTO', 'FIN'), iLine('FIN', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('flags every occurrence of a duplicate label (Assembly Error 5 shape)', () => {
  const lines = [
    titleLine('T0302', 'Procalcitonin'),
    iLine('FIN', 'COMMENT', 'A'),
    iLine('FIN', 'COMMENT', 'B'),
    iLine('', 'END'),
  ];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 2);
  assert.ok(diags.every((d) => d.code === 'duplicate-label'));
  assert.strictEqual(diags[0].line, 1);
  assert.strictEqual(diags[1].line, 2);
});

run('scopes checks per T/Q block: a duplicate/undefined label in one block does not leak into another', () => {
  const lines = [
    titleLine('T0302', 'Procalcitonin'),
    iLine('FIN', 'COMMENT', 'A'),
    iLine('', 'END'),
    titleLine('T0400', 'Other'),
    iLine('FIN', 'COMMENT', 'B'), // same label name, different block -- not a duplicate
    iLine('', 'GOTO', 'FIN'), // resolves within this block
    iLine('', 'END'),
  ];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('resolves a reference to a label injected by an invoked macro (real BIO/DRUGMCR shape)', () => {
  const lines = [
    titleLine('T0750', 'Digoxin'),
    iLine('CHKAB', 'GOTO,EQ', 'CONT', 'ABN-RSLT', '0'),
    iLine('DRUGM', 'DRUGMCR'),
    iLine('FIN', 'REMAUTH'),
    iLine('', 'END'),
  ];
  const macroLabels = new Map([['DRUGMCR', new Set(['CONT', 'DCHECK', 'ENDMCR'])]]);
  const diagsWithoutIndex = computeDiagnostics(lines);
  assert.strictEqual(diagsWithoutIndex.length, 1);
  assert.strictEqual(diagsWithoutIndex[0].code, 'undefined-label');

  const diagsWithIndex = computeDiagnostics(lines, { macroLabels });
  assert.strictEqual(diagsWithIndex.length, 0);
});

run('flags a GOTCP target with no matching test code in the workspace index', () => {
  const lines = [titleLine('T0400', 'Other'), iLine('', 'GOTCP', 'T9999', 'START'), iLine('', 'END')];
  const diags = computeDiagnostics(lines, { testCodes: new Set(['0302', '0500']) });
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].code, 'gotcp-not-found');
  assert.strictEqual(diags[0].severity, 'warning');
});

run('does not flag a GOTCP target that matches a workspace test code', () => {
  const lines = [titleLine('T0400', 'Other'), iLine('', 'GOTCP', 'T0302', 'START'), iLine('', 'END')];
  const diags = computeDiagnostics(lines, { testCodes: new Set(['0302', '0500']) });
  assert.strictEqual(diags.length, 0);
});

run('skips GOTCP validation entirely when no testCodes index is supplied', () => {
  const lines = [titleLine('T0400', 'Other'), iLine('', 'GOTCP', 'T9999', 'START'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('does not check content outside any T/Q block (macro-only files, GLOBAL headers, etc.)', () => {
  const lines = [LN + 'D SOMEMAC', iLine('', 'GOTO', 'NOWHERE'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('flags an undefined data reference (NORMAL/CR TEST/CR CRS/GROUP whitelist, Assembly Error 8/10 shape)', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'NORMAL', 'MISSING'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].code, 'undefined-data-reference');
  assert.strictEqual(diags[0].severity, 'warning');
  assert.ok(diags[0].message.includes('MISSING'));
});

run('does not flag a data reference resolved by a declaration in the same block', () => {
  const lines = [
    titleLine('T0302', 'Procalcitonin'),
    dataLine('R', 'RRANGE', '1.00', '2.00'),
    iLine('', 'NORMAL', 'RRANGE'),
    iLine('', 'END'),
  ];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('resolves a data reference injected by an invoked macro', () => {
  const lines = [
    titleLine('T0302', 'Procalcitonin'),
    iLine('', 'SOMEMAC'),
    iLine('', 'GROUP', 'REF'),
    iLine('', 'END'),
  ];
  const macroLabels = new Map([['SOMEMAC', new Set(['REF'])]]);
  const diagsWithoutIndex = computeDiagnostics(lines);
  assert.strictEqual(diagsWithoutIndex.length, 1);
  assert.strictEqual(diagsWithoutIndex[0].code, 'undefined-data-reference');

  const diagsWithIndex = computeDiagnostics(lines, { macroLabels });
  assert.strictEqual(diagsWithIndex.length, 0);
});

run('resolves a data reference against the workspace-wide GLOBAL data labels', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'GROUP', 'SPACE'), iLine('', 'END')];
  const diagsWithoutIndex = computeDiagnostics(lines);
  assert.strictEqual(diagsWithoutIndex.length, 1);

  const diagsWithIndex = computeDiagnostics(lines, { globalDataLabels: new Set(['SPACE']) });
  assert.strictEqual(diagsWithIndex.length, 0);
});

run('does not flag the implicit built-in TCPNAME box', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'GROUP', 'TCPNAME'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('does not flag SIGNOUT or MOVE,D operands as data references (outside the whitelist)', () => {
  const lines = [
    titleLine('T0302', 'Procalcitonin'),
    iLine('', 'SIGNOUT', '9966'),
    iLine('', 'MOVE,D', 'VALUE', 'TV2'),
    iLine('', 'END'),
  ];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

run('flags NORMAL/CR TEST/CR CRS used with a blank operand (Assembly Error 7 shape)', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'NORMAL'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].code, 'missing-data-operand');
  assert.strictEqual(diags[0].severity, 'warning');
  assert.ok(diags[0].message.includes('NORMAL'));
});

run('does not flag a bare GROUP with no operand (real, common pattern, excluded by design)', () => {
  const lines = [titleLine('T0302', 'Procalcitonin'), iLine('', 'GROUP'), iLine('', 'END')];
  const diags = computeDiagnostics(lines);
  assert.strictEqual(diags.length, 0);
});

console.log('all diagnostics tests passed');
