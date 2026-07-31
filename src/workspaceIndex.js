'use strict';

// Builds the two workspace-wide lookups the diagnostics layer needs, from a
// plain list of already-read documents -- no `vscode` dependency, so this is
// unit-testable with plain Node (see tests/workspace-index.test.js). The
// thin `vscode`-aware wrapper (src/extension.js) is responsible for finding
// and reading files and handing them to this module as {uri, lines}.
//
// Two things must be resolved workspace-wide rather than per-document:
//
// 1. GOTCP targets are 4-digit test codes that refer to a *different* TCP
//    script, possibly (usually) in a different physical file -- checking
//    "does this code exist" requires having scanned every file for T/Q
//    headers first.
// 2. Macro invocations (see labelParser.js's findOpcodeFields) textually
//    inject the invoked macro's own declarations into the calling block at
//    assembly time -- both branch labels (I-line own-labels) AND data
//    declarations (A/M/N/R/S/H-line own-labels), since a macro body can
//    contain either. Macro definitions (`D <name>`) commonly live in a
//    shared file (e.g. production's MACRO) separate from the test scripts
//    that call them, so resolving "is this name actually defined, once
//    macro expansion is accounted for" also requires a workspace-wide scan.
// 3. The real `GLOBAL` file declares A-line data labels that are available
//    everywhere in the workspace, not scoped to any block (see
//    labelParser.js's isGlobalDataFile) -- these must be collected
//    workspace-wide too, from whichever file(s) carry the GLOBAL header.
//
// Confirmed against real production data (C:\repos\TCP, read-only): a
// single physical file can bundle hundreds of T/Q-delimited test scripts
// (e.g. BIO has 623), and macro bodies are genuinely cross-referenced from
// many different files.

const {
  findTestCodeDeclarations,
  findMacroDefinitions,
  findLabelDefinitions,
  findDataDeclarations,
  isGlobalDataFile,
} = require('./labelParser');

// REJECT.DJS is not a compiled TCP source at all -- it only contains
// rejection-notice text fragments (a `.DJS` extension, not a real script),
// which happens to reuse the same 4-digit numbering scheme as genuine T/Q
// test codes purely by coincidence. Confirmed against the real corpus: 17
// of the original 32 workspace-wide "duplicate" test codes found were
// entirely REJECT.DJS/MICRO pairs (T2631-T2647) -- excluding REJECT.DJS
// from contributing to the duplicate-test-code map drops these 17 false
// positives, leaving the 15 genuine cross-file/same-file duplicates (see
// TODO.md's "Duplicate test-code definitions" section). Matched against
// the basename only (not a substring test), case-insensitively.
function isDisregardedFile(uri) {
  return /(^|[\\/])reject\.djs$/i.test(uri);
}

// Extracts a short display name from a document identifier for use in
// diagnostic messages -- `doc.uri` is a full (possibly percent-encoded)
// vscode Uri string in the real extension (e.g.
// "file:///c%3A/repos/TCP/BIO"), but just a plain filename in tests.
function basename(uri) {
  const withoutQuery = uri.split(/[?#]/)[0];
  const last = withoutQuery.split(/[\\/]/).pop();
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * @param {Array<{uri: string, lines: string[]}>} documents
 * @returns {{ testCodes: Set<string>, macroLabels: Map<string, Set<string>>, globalDataLabels: Set<string>, duplicateTestCodes: Map<string, string[]> }}
 */
function buildWorkspaceIndex(documents) {
  const testCodes = new Set();
  const macroLabels = new Map();
  const globalDataLabels = new Set();
  const testCodeFiles = new Map();

  for (const doc of documents) {
    const disregarded = isDisregardedFile(doc.uri);
    for (const decl of findTestCodeDeclarations(doc.lines)) {
      // decl.code is e.g. "T0302" or "Q0500" -- the code is the 4 digits.
      testCodes.add(decl.code.slice(1));
      if (disregarded) continue;
      if (!testCodeFiles.has(decl.code)) testCodeFiles.set(decl.code, []);
      testCodeFiles.get(decl.code).push(basename(doc.uri));
    }

    for (const macro of findMacroDefinitions(doc.lines)) {
      const body = doc.lines.slice(macro.startLine, macro.endLine);
      const names = [...findLabelDefinitions(body), ...findDataDeclarations(body)].map((d) => d.label);
      if (!macroLabels.has(macro.name)) macroLabels.set(macro.name, new Set());
      const set = macroLabels.get(macro.name);
      for (const name of names) set.add(name);
    }

    if (isGlobalDataFile(doc.lines)) {
      for (const decl of findDataDeclarations(doc.lines)) globalDataLabels.add(decl.label);
    }
  }

  const duplicateTestCodes = new Map();
  for (const [code, files] of testCodeFiles) {
    if (files.length > 1) duplicateTestCodes.set(code, files);
  }

  return { testCodes, macroLabels, globalDataLabels, duplicateTestCodes };
}

module.exports = { buildWorkspaceIndex };
