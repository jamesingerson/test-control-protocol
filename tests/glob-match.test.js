'use strict';

const assert = require('assert');
const { matchesGlob } = require('../src/globMatch');

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

run('matches a file directly inside the associated folder, regardless of workspace root (the real reported bug)', () => {
  // This is the exact real pattern from C:\repos\TCP\.vscode\settings.json.
  // The bug: feeding this same string into vscode.workspace.findFiles()
  // matches workspace-RELATIVE paths, and when the workspace root IS
  // C:\repos\TCP, no relative path contains a "TCP" segment at all -- so
  // findFiles silently found nothing. matchesGlob operates on the file's
  // full absolute path instead, exactly like files.associations itself
  // does, so it must match here.
  const pattern = '**/TCP/**/*';
  assert.ok(matchesGlob('C:/repos/TCP/HAEM', pattern));
  assert.ok(matchesGlob('C:/repos/TCP/CONTROL', pattern));
  assert.ok(matchesGlob('C:/repos/TCP/MACRO', pattern));
});

run('matches when TCP is a nested subfolder rather than the workspace root', () => {
  const pattern = '**/TCP/**/*';
  assert.ok(matchesGlob('C:/repos/testlisv10-tcp/TCP/HAEM', pattern));
  assert.ok(matchesGlob('/home/user/projects/TCP/scripts/HAEM', pattern));
});

run('does not match a path with no TCP segment at all', () => {
  const pattern = '**/TCP/**/*';
  assert.strictEqual(matchesGlob('C:/repos/OTHER/HAEM', pattern), false);
});

run('is case-insensitive, matching Windows path conventions', () => {
  assert.ok(matchesGlob('c:/repos/tcp/haem', '**/TCP/**/*'));
});

run('single "*" does not cross a path separator', () => {
  assert.strictEqual(matchesGlob('C:/repos/TCP/sub/HAEM', '**/TCP/*'), false);
  assert.ok(matchesGlob('C:/repos/TCP/HAEM', '**/TCP/*'));
});

console.log('all glob-match tests passed');
