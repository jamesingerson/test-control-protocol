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

console.log('all workspace-index tests passed');
