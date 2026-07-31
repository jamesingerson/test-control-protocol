'use strict';

const assert = require('assert');
const { buildWorkspaceIndex } = require('../src/workspaceIndex');

const LN = ' '.repeat(7);
function iLine(label, ...fields) {
  return LN + 'I ' + label.padEnd(9) + fields.map((f) => f.padEnd(9)).join('').trimEnd();
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

run('buildWorkspaceIndex collects test codes across multiple documents (real files bundle many per physical file)', () => {
  const documents = [
    { uri: 'a.tcp', lines: [LN + 'T0302 Procalcitonin', iLine('', 'END')] },
    { uri: 'b.tcp', lines: [LN + 'T0400 Other', iLine('', 'END'), LN + 'Q0500 Flag', iLine('', 'END')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual([...index.testCodes].sort(), ['0302', '0400', '0500']);
});

run('buildWorkspaceIndex collects macro-body labels across documents, keyed by macro name', () => {
  const documents = [
    {
      uri: 'MACRO',
      lines: [
        LN + 'D DRUGMCR',
        iLine('CONT', 'GOTO,EQ', 'DCHECK', 'VALIDATE', '1'),
        iLine('DCHECK', 'ERROR,OR', '1', 'VALUE', 'IRANGE'),
        iLine('ENDMCR', 'END'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.ok(index.macroLabels.has('DRUGMCR'));
  assert.deepStrictEqual([...index.macroLabels.get('DRUGMCR')].sort(), ['CONT', 'DCHECK', 'ENDMCR']);
});

run('buildWorkspaceIndex merges labels for the same macro name defined in more than one document', () => {
  const documents = [
    { uri: 'a', lines: [LN + 'D SHAREMAC', iLine('FOO', 'END')] },
    { uri: 'b', lines: [LN + 'D SHAREMAC', iLine('BAR', 'END')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual([...index.macroLabels.get('SHAREMAC')].sort(), ['BAR', 'FOO']);
});

run('buildWorkspaceIndex includes a macro body\'s data declarations (A/N/R/S/H), not just its branch labels', () => {
  const documents = [
    {
      uri: 'MACRO',
      lines: [LN + 'D SOMEMAC', dataLine('N', 'REF', '0.10', '5.00'), iLine('', 'END')],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual([...index.macroLabels.get('SOMEMAC')].sort(), ['REF']);
});

run('buildWorkspaceIndex flags a test code declared in more than one file', () => {
  const documents = [
    { uri: 'BIO', lines: [LN + 'T4692 Something', iLine('', 'END')] },
    { uri: 'HAEM', lines: [LN + 'T4692 Something Else', iLine('', 'END')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual(index.duplicateTestCodes.get('T4692'), ['BIO', 'HAEM']);
});

run('buildWorkspaceIndex flags a test code declared twice in the SAME file (real BOPSEARCH Q9029 shape)', () => {
  const documents = [
    {
      uri: 'BOPSEARCH',
      lines: [
        LN + 'Q9029 SEARCH FOR ESR STD STATISTICS',
        iLine('', 'END'),
        LN + 'Q9029 Search for Sendaways / numbers done',
        iLine('', 'END'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual(index.duplicateTestCodes.get('Q9029'), ['BOPSEARCH', 'BOPSEARCH']);
});

run('buildWorkspaceIndex does not flag a test code declared only once', () => {
  const documents = [{ uri: 'BIO', lines: [LN + 'T0302 Procalcitonin', iLine('', 'END')] }];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.duplicateTestCodes.has('T0302'), false);
});

run('buildWorkspaceIndex disregards REJECT.DJS entirely for duplicate-test-code purposes (real MICRO/REJECT.DJS shape)', () => {
  const documents = [
    { uri: 'MICRO', lines: [LN + 'T2631 Something', iLine('', 'END')] },
    { uri: 'REJECT.DJS', lines: [LN + 'T2631 Rejection notice text', iLine('', 'END')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.duplicateTestCodes.has('T2631'), false);
});

run('buildWorkspaceIndex still resolves REJECT.DJS-only codes for testCodes (GOTCP existence checks are unaffected)', () => {
  const documents = [{ uri: 'REJECT.DJS', lines: [LN + 'T2631 Rejection notice text', iLine('', 'END')] }];
  const index = buildWorkspaceIndex(documents);
  assert.ok(index.testCodes.has('2631'));
});

run('buildWorkspaceIndex matches REJECT.DJS case-insensitively and by basename, not substring, of a full path/URI', () => {
  const documents = [
    { uri: 'C:/repos/TCP/reject.djs', lines: [LN + 'T9999 x', iLine('', 'END')] },
    { uri: 'C:/repos/TCP/MICRO', lines: [LN + 'T9999 y', iLine('', 'END')] },
    { uri: 'C:/repos/TCP/NOT-REJECT.DJS-BACKUP', lines: [LN + 'T8888 x', iLine('', 'END')] },
    { uri: 'C:/repos/TCP/OTHER', lines: [LN + 'T8888 y', iLine('', 'END')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.duplicateTestCodes.has('T9999'), false);
  assert.deepStrictEqual(index.duplicateTestCodes.get('T8888'), ['NOT-REJECT.DJS-BACKUP', 'OTHER']);
});

run('buildWorkspaceIndex collects data labels from the real GLOBAL header shape, workspace-wide', () => {
  const documents = [
    {
      uri: 'GLOBAL',
      lines: [LN + 'GLOBAL ALPHA DATA', dataLine('A', 'SPACE', '_'), dataLine('A', 'DASH', '-')],
    },
    { uri: 'BIO', lines: [LN + 'T0302 Procalcitonin', dataLine('A', 'TITLE', 'x')] },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.deepStrictEqual([...index.globalDataLabels].sort(), ['DASH', 'SPACE']);
});

run('buildWorkspaceIndex: macroEndsInEnd is true only for a macro whose own body\'s last opcode is END', () => {
  const documents = [
    {
      uri: 'MACRO',
      lines: [
        LN + 'D DRUGMCR',
        iLine('CONT', 'GOTO,EQ', 'DCHECK', 'VALIDATE', '1'),
        iLine('ENDMCR', 'END'),
        LN + 'D NOTERM',
        iLine('', 'MOVE', '1', 'TV1'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.macroEndsInEnd.has('DRUGMCR'), true);
  assert.strictEqual(index.macroEndsInEnd.has('NOTERM'), false);
});

run('buildWorkspaceIndex: terminalTestCodes resolves a test that ends in a literal END', () => {
  const documents = [{ uri: 'BIO', lines: [LN + 'T0302 Procalcitonin', iLine('', 'END')] }];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.terminalTestCodes.has('0302'), true);
});

run('buildWorkspaceIndex: terminalTestCodes resolves a bare GOTCP chain to a test that itself ends in END (real MICRO shape)', () => {
  const documents = [
    {
      uri: 'MICRO',
      lines: [
        LN + 'T3034 Child Urine',
        iLine('', 'GOTCP', '3030'),
        LN + 'T3030 Urine',
        iLine('', 'END'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.terminalTestCodes.has('3034'), true);
});

run('buildWorkspaceIndex: terminalTestCodes follows a multi-hop bare GOTCP chain', () => {
  const documents = [
    {
      uri: 'A',
      lines: [
        LN + 'T0001 First',
        iLine('', 'GOTCP', '0002'),
        LN + 'T0002 Second',
        iLine('', 'GOTCP', '0003'),
        LN + 'T0003 Third',
        iLine('', 'END'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.terminalTestCodes.has('0001'), true);
});

run('buildWorkspaceIndex: terminalTestCodes does not resolve a GOTCP cycle (mutual reference, never reaches END)', () => {
  const documents = [
    {
      uri: 'A',
      lines: [
        LN + 'T0001 First',
        iLine('', 'GOTCP', '0002'),
        LN + 'T0002 Second',
        iLine('', 'GOTCP', '0001'),
      ],
    },
  ];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.terminalTestCodes.has('0001'), false);
  assert.strictEqual(index.terminalTestCodes.has('0002'), false);
});

run('buildWorkspaceIndex: terminalTestCodes does not resolve a GOTCP to a target that does not exist anywhere', () => {
  const documents = [{ uri: 'A', lines: [LN + 'T0001 First', iLine('', 'GOTCP', '9999')] }];
  const index = buildWorkspaceIndex(documents);
  assert.strictEqual(index.terminalTestCodes.has('0001'), false);
});

console.log('all workspace-index tests passed');
