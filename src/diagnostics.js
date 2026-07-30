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
  findDataDeclarations,
  findDataReferences,
  findPrintDataReferences,
  findMissingDataOperands,
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
 * @param {Set<string>} [options.globalDataLabels] A-line data labels
 *   declared in the workspace's GLOBAL file, from buildWorkspaceIndex --
 *   available in every block regardless of local declarations.
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

    const opcodesInBlock = findOpcodeFields(blockLines);

    const knownLabels = new Set(defsByLabel.keys());
    if (opts.macroLabels) {
      for (const opcode of opcodesInBlock) {
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

    // Undefined data reference (Reference Manual Errors 8/10): an
    // instruction's data-reference operand should resolve to a declared
    // A/M/N/R/S/H label, exactly like a branch label does for GOTO -- but
    // scoped to a deliberately narrow keyword whitelist (see
    // labelParser.js's DATA_REFERENCE_RE and PRINT_DATA_REFERENCE_RE)
    // rather than every instruction, since most instructions' operands
    // were confirmed NOT to be data references when sampled against the
    // real corpus. Two different operand shapes feed this same check:
    // NORMAL/GROUP/CR-family have the reference at op1; PRINT/PRINT,H/
    // PRINT,A have it at op2 instead (op1 there is a print-column number).
    // Warning severity, not error: this check is newer and less
    // exhaustively validated than undefined-label.
    const knownDataLabels = new Set(findDataDeclarations(blockLines).map((d) => d.label));
    if (opts.macroLabels) {
      for (const opcode of opcodesInBlock) {
        const injected = opts.macroLabels.get(opcode.text);
        if (injected) {
          for (const label of injected) knownDataLabels.add(label);
        }
      }
    }
    if (opts.globalDataLabels) {
      for (const label of opts.globalDataLabels) knownDataLabels.add(label);
    }

    const dataRefs = [...findDataReferences(blockLines), ...findPrintDataReferences(blockLines)];
    for (const ref of dataRefs) {
      if (knownDataLabels.has(ref.label)) continue;
      diagnostics.push({
        line: block.startLine + ref.line,
        startCol: ref.startCol,
        endCol: ref.endCol,
        severity: 'warning',
        code: 'undefined-data-reference',
        message: `'${ref.label}' has no matching A/M/N/R/S/H data declaration in ${block.name}`,
      });
    }

    // Missing data operand (Reference Manual Error 7): NORMAL/CR TEST/CR
    // CRS never appear with a blank operand anywhere in the real corpus
    // (1656 combined uses) -- unlike GROUP, which is deliberately excluded
    // here (a bare GROUP with no operand is a legitimate, common pattern,
    // 101 real occurrences, not an omission). No workspace context needed:
    // a blank operand is wrong regardless of what's declared elsewhere.
    for (const missing of findMissingDataOperands(blockLines)) {
      diagnostics.push({
        line: block.startLine + missing.line,
        startCol: missing.startCol,
        endCol: missing.endCol,
        severity: 'warning',
        code: 'missing-data-operand',
        message: `'${missing.keyword}' is missing its data-reference operand in ${block.name}`,
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
