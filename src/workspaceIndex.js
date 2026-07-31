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
  findTestBlocks,
  findMacroDefinitions,
  findLabelDefinitions,
  findDataDeclarations,
  findOpcodeFields,
  findGotcpReferences,
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

// A block is terminal "on its own terms" if it has no instructions at all
// (a link stub, e.g. `T0010 H911 Link` -- title + comment only, a
// documented real pattern), its own last instruction is a literal `END`,
// or it ends by invoking a macro whose OWN body's last instruction is
// `END` (the same label-injection mechanism already used for GOTO/data
// references, applied here to "does this macro's body terminate").
// Deliberately does NOT itself resolve a trailing GOTCP -- that requires
// following the target workspace-wide, see resolveTerminalCode below.
function isBaseTerminal(info, macroEndsInEnd) {
  if (!info.hasInstructions) return true;
  if (info.lastOp === 'END') return true;
  if (info.lastOp && macroEndsInEnd.has(info.lastOp)) return true;
  return false;
}

// GOTCP is only a genuine terminator if the target it jumps to ALSO
// terminates -- it is not "a get out of jail free card" (direct user
// instruction, after the initial design considered any GOTCP sufficient).
// Only a BARE, unconditional `GOTCP` qualifies as a *candidate* terminator
// at all: a conditional variant (`GOTCP,EQ` etc.) as a block's last
// instruction only transfers control when its condition holds -- if it
// doesn't, execution still runs off the end of the block, which is
// exactly the bug this check exists to catch. (Confirmed moot against the
// real corpus: zero blocks end on a conditional GOTCP variant today --
// this is a correctness rule for the future, not a current false-negative
// fix.) Resolves recursively (a target can itself end in a bare GOTCP to
// a third test) with cycle detection -- an unresolvable target (not found
// anywhere in the workspace) or a cycle counts as NOT terminal, the same
// as any other genuinely dead end.
function resolveTerminalCode(code, blocksByCode, macroEndsInEnd, memo, stack) {
  if (memo.has(code)) return memo.get(code);
  if (stack.has(code)) return false;
  const blocks = blocksByCode.get(code);
  if (!blocks || blocks.length === 0) return false;
  stack.add(code);
  let result = false;
  for (const info of blocks) {
    if (isBaseTerminal(info, macroEndsInEnd)) {
      result = true;
      break;
    }
    if (info.gotcpTargetCode && resolveTerminalCode(info.gotcpTargetCode, blocksByCode, macroEndsInEnd, memo, stack)) {
      result = true;
      break;
    }
  }
  stack.delete(code);
  memo.set(code, result);
  return result;
}

/**
 * @param {Array<{uri: string, lines: string[]}>} documents
 * @returns {{ testCodes: Set<string>, macroLabels: Map<string, Set<string>>, globalDataLabels: Set<string>, duplicateTestCodes: Map<string, string[]>, macroEndsInEnd: Set<string>, terminalTestCodes: Set<string> }}
 */
function buildWorkspaceIndex(documents) {
  const testCodes = new Set();
  const macroLabels = new Map();
  const globalDataLabels = new Set();
  const testCodeFiles = new Map();
  const macroEndsInEnd = new Set();
  const blocksByCode = new Map();

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

      const bodyOpcodes = findOpcodeFields(body);
      if (bodyOpcodes.length > 0 && bodyOpcodes[bodyOpcodes.length - 1].text === 'END') {
        macroEndsInEnd.add(macro.name);
      }
    }

    if (isGlobalDataFile(doc.lines)) {
      for (const decl of findDataDeclarations(doc.lines)) globalDataLabels.add(decl.label);
    }

    // For the "every test ends with a terminal instruction" check below --
    // records each block's own last opcode and, if it's a bare GOTCP, the
    // 4-digit code it targets (workspace-wide resolution happens after
    // every document has been scanned, since the target is very often in
    // a different physical file).
    for (const block of findTestBlocks(doc.lines)) {
      const blockLines = doc.lines.slice(block.startLine, block.endLine);
      const opcodes = findOpcodeFields(blockLines);
      const lastOpcode = opcodes.length > 0 ? opcodes[opcodes.length - 1] : null;
      let gotcpTargetCode = null;
      if (lastOpcode && lastOpcode.text === 'GOTCP') {
        const gotcpRefs = findGotcpReferences(blockLines);
        const lastGotcpRef = gotcpRefs.find((ref) => ref.line === lastOpcode.line);
        if (lastGotcpRef) gotcpTargetCode = lastGotcpRef.code.replace(/\D/g, '').padStart(4, '0');
      }
      const code = block.name.slice(1);
      if (!blocksByCode.has(code)) blocksByCode.set(code, []);
      blocksByCode.get(code).push({
        hasInstructions: opcodes.length > 0,
        lastOp: lastOpcode ? lastOpcode.text : null,
        gotcpTargetCode,
      });
    }
  }

  const duplicateTestCodes = new Map();
  for (const [code, files] of testCodeFiles) {
    if (files.length > 1) duplicateTestCodes.set(code, files);
  }

  const terminalTestCodes = new Set();
  const terminalMemo = new Map();
  for (const code of blocksByCode.keys()) {
    if (resolveTerminalCode(code, blocksByCode, macroEndsInEnd, terminalMemo, new Set())) {
      terminalTestCodes.add(code);
    }
  }

  return { testCodes, macroLabels, globalDataLabels, duplicateTestCodes, macroEndsInEnd, terminalTestCodes };
}

module.exports = { buildWorkspaceIndex };
