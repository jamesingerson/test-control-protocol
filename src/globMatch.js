'use strict';

// Minimal glob matcher supporting the subset of syntax used in
// `files.associations` patterns: `**` (any number of path segments,
// including zero) and `*` (any characters within a single segment, no `/`).
//
// Needed because `vscode.workspace.findFiles(pattern)` matches its glob
// against each file's path RELATIVE TO THE WORKSPACE ROOT, while
// `files.associations` matches against a file's FULL path -- these are not
// the same check, and feeding a files.associations pattern straight into
// findFiles can silently return nothing.
//
// Confirmed as a real, live false positive: a user's workspace root was
// `C:\repos\TCP` itself (opened directly, not a parent folder), with
// `"files.associations": {"**/TCP/**/*": "testcontrolprotocol"}`. Every
// file's workspace-relative path (`HAEM`, `MACRO`, `CONTROL`, ...) has no
// `TCP` segment at all -- the workspace root's own name is excluded from
// relative paths -- so `findFiles('**/TCP/**/*')` matched zero files, and
// the workspace index silently degraded to only the currently-open
// document(s). A GOTCP reference in the open file `CONTROL` targeting a
// test code actually defined in the (unopened) file `HAEM` was flagged as
// not found, even though it's a legitimate, common cross-file reference.
// The SAME pattern correctly assigns the language to individual files
// because VS Code checks it against each file's full path for that
// purpose, not the workspace-relative path -- hence highlighting worked
// while workspace-wide discovery silently didn't.
function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') i++;
      source += '.*';
    } else if (char === '*') {
      source += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(char)) {
      source += '\\' + char;
    } else {
      source += char;
    }
  }
  return new RegExp('^' + source + '$', 'i');
}

/**
 * @param {string} filePath an absolute path, forward slashes
 * @param {string} pattern a files.associations-style glob pattern
 * @returns {boolean}
 */
function matchesGlob(filePath, pattern) {
  return globToRegExp(pattern).test(filePath);
}

module.exports = { matchesGlob };
