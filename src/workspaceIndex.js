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
//    inject the invoked macro's own labels into the calling block at
//    assembly time. Macro definitions (`D <name>`) commonly live in a
//    shared file (e.g. production's MACRO) separate from the test scripts
//    that call them, so resolving "is this label actually defined, once
//    macro expansion is accounted for" also requires a workspace-wide scan.
//
// Confirmed against real production data (C:\repos\TCP, read-only): a
// single physical file can bundle hundreds of T/Q-delimited test scripts
// (e.g. BIO has 623), and macro bodies are genuinely cross-referenced from
// many different files.

const { findTestBlocks, findMacroDefinitions, findLabelDefinitions } = require('./labelParser');

/**
 * @param {Array<{uri: string, lines: string[]}>} documents
 * @returns {{ testCodes: Set<string>, macroLabels: Map<string, Set<string>> }}
 */
function buildWorkspaceIndex(documents) {
  const testCodes = new Set();
  const macroLabels = new Map();

  for (const doc of documents) {
    for (const block of findTestBlocks(doc.lines)) {
      // block.name is e.g. "T0302" or "Q0500" -- the code is the 4 digits.
      testCodes.add(block.name.slice(1));
    }

    for (const macro of findMacroDefinitions(doc.lines)) {
      const body = doc.lines.slice(macro.startLine, macro.endLine);
      const labels = findLabelDefinitions(body).map((d) => d.label);
      if (!macroLabels.has(macro.name)) macroLabels.set(macro.name, new Set());
      const set = macroLabels.get(macro.name);
      for (const label of labels) set.add(label);
    }
  }

  return { testCodes, macroLabels };
}

module.exports = { buildWorkspaceIndex };
