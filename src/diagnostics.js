'use strict';

// Pure diagnostic-computation logic for the label/GOTCP verification
// feature -- no `vscode` dependency (see src/labelParser.js for why), so
// it's unit-testable with plain Node (tests/diagnostics.test.js). The thin
// `vscode`-aware wrapper (src/extension.js) turns these plain descriptors
// into vscode.Diagnostic objects and publishes them to a
// DiagnosticCollection.
//
// Scoping rule, confirmed empirically against real production TCP files
// (C:\repos\TCP, read-only -- see src/workspaceIndex.js for detail): a
// label's scope is the single T/Q test-definition block it appears in, NOT
// the whole physical file. Checks below are run once per block, never
// across block boundaries. Macro (`D ...`) bodies are never checked
// directly -- they're templates that use their own parameter-placeholder
// convention (OP1/OP2/OP3/... substituted at assembly time by the caller's
// actual arguments), not literal labels or test codes, so validating them
// as if they were ordinary instructions produces false positives.

const {
  findTestBlocks,
  findLabelDefinitions,
  findLabelReferences,
  findGotcpReferences,
  findOpcodeFields,
} = require('./labelParser');

/**
 * @param {string[]} lines document text split into lines (no newline chars)
 * @param {object} [options]
 * @param {Map<string, Set<string>>} [options.macroLabels] macro name -> labels
 *   it defines, from buildWorkspaceIndex. A block invoking a known macro
 *   (any opcode field matching a key in this map) has that macro's labels
 *   added to its own known-label set before undefined-label checking.
 * @param {Set<string>} [options.testCodes] all 4-digit test codes found
 *   anywhere in the workspace, from buildWorkspaceIndex. When provided,
 *   GOTCP targets not present in this set are flagged.
 * @returns {Array<{line: number, startCol: number, endCol: number, severity: 'error'|'warning', code: string, message: string}>}
 */
function computeDiagnostics(lines, options) {
  const opts = options || {};
  const diagnostics = [];

  for (const block of findTestBlocks(lines)) {
    const blockLines = lines.slice(block.startLine, block.endLine);
    const defs = findLabelDefinitions(blockLines);
    const refs = findLabelReferences(blockLines);
    const gotcpRefs = findGotcpReferences(blockLines);

    const defsByLabel = new Map();
    for (const def of defs) {
      if (!defsByLabel.has(def.label)) defsByLabel.set(def.label, []);
      defsByLabel.get(def.label).push(def);
    }

    for (const [label, occurrences] of defsByLabel) {
      if (occurrences.length < 2) continue;
      for (const occ of occurrences) {
        diagnostics.push({
          line: block.startLine + occ.line,
          startCol: occ.startCol,
          endCol: occ.endCol,
          severity: 'error',
          code: 'duplicate-label',
          message: `Duplicate label '${label}' is defined ${occurrences.length} times in ${block.name}`,
        });
      }
    }

    const knownLabels = new Set(defsByLabel.keys());
    if (opts.macroLabels) {
      for (const opcode of findOpcodeFields(blockLines)) {
        const injected = opts.macroLabels.get(opcode.text);
        if (injected) {
          for (const label of injected) knownLabels.add(label);
        }
      }
    }

    for (const ref of refs) {
      if (knownLabels.has(ref.label)) continue;
      diagnostics.push({
        line: block.startLine + ref.line,
        startCol: ref.startCol,
        endCol: ref.endCol,
        severity: 'error',
        code: 'undefined-label',
        message: `Undefined label '${ref.label}' has no matching definition in ${block.name}`,
      });
    }

    if (opts.testCodes) {
      for (const gotcp of gotcpRefs) {
        const digits = gotcp.code.replace(/\D/g, '');
        if (digits && opts.testCodes.has(digits)) continue;
        diagnostics.push({
          line: block.startLine + gotcp.line,
          startCol: gotcp.startCol,
          endCol: gotcp.endCol,
          severity: 'warning',
          code: 'gotcp-not-found',
          message: `GOTCP target '${gotcp.code}' does not match any test code found in the workspace`,
        });
      }
    }
  }

  return diagnostics;
}

module.exports = { computeDiagnostics };
