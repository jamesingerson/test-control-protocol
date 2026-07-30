'use strict';

// vscode-API wrapper for the label/GOTCP verification feature. Kept thin and
// deliberately un-unit-testable: all real logic lives in labelParser.js /
// diagnostics.js / workspaceIndex.js (plain functions, tested with plain
// Node -- see tests/*.test.js). This file only wires vscode events to those
// functions.

const vscode = require('vscode');
const { computeDiagnostics } = require('./diagnostics');
const { buildWorkspaceIndex } = require('./workspaceIndex');
const { matchesGlob } = require('./globMatch');

const LANGUAGE_ID = 'testcontrolprotocol';
const DOCUMENT_DEBOUNCE_MS = 500;
const INDEX_REBUILD_DEBOUNCE_MS = 1000;

function activate(context) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  context.subscriptions.push(diagnosticCollection);

  let workspaceIndex = { testCodes: new Set(), macroLabels: new Map() };
  let indexRebuildTimer;
  const documentRefreshTimers = new Map();

  // Real production TCP files have no fixed extension (e.g. BIO, MACRO,
  // GLOBAL) -- the only reliable way to find them workspace-wide is the
  // same mechanism VS Code itself uses to assign them this language:
  // `files.associations`. Any currently-open document already carrying this
  // language ID is included too, so a file opened without matching one of
  // these patterns (e.g. manually set via "Change Language Mode") still
  // contributes to the index.
  //
  // IMPORTANT: association patterns must NOT be passed straight into
  // `vscode.workspace.findFiles()` -- that API matches its glob against
  // each file's path RELATIVE TO THE WORKSPACE ROOT, while
  // `files.associations` matches against a file's FULL path. These produce
  // different results whenever the workspace root's own name would have
  // been part of the pattern (e.g. root = C:\repos\TCP with pattern
  // "**/TCP/**/*" -- no relative path ever contains a "TCP" segment, since
  // the root's name is excluded from every relative path, so findFiles
  // would silently match nothing even though the pattern correctly assigns
  // the language to individual files). Confirmed as a real false positive:
  // a GOTCP reference in an open file to a test code defined in a
  // different, unopened file was flagged as missing, because the
  // workspace-wide scan never found that other file. Fixed by scanning
  // broadly with findFiles('**/*') and matching each result's full path
  // ourselves via globMatch.js, the same way files.associations actually
  // works.
  function getAssociationPatterns() {
    const associations = vscode.workspace.getConfiguration('files').get('associations') || {};
    return Object.keys(associations).filter((pattern) => associations[pattern] === LANGUAGE_ID);
  }

  async function collectWorkspaceUris() {
    const uriMap = new Map();
    const patterns = getAssociationPatterns();
    if (patterns.length > 0) {
      const candidates = await vscode.workspace.findFiles('**/*');
      for (const uri of candidates) {
        const fsPath = uri.fsPath.replace(/\\/g, '/');
        if (patterns.some((pattern) => matchesGlob(fsPath, pattern))) {
          uriMap.set(uri.toString(), uri);
        }
      }
    }
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === LANGUAGE_ID) uriMap.set(doc.uri.toString(), doc.uri);
    }
    return [...uriMap.values()];
  }

  async function readLines(uri) {
    const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (openDoc) return openDoc.getText().split(/\r?\n/);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8').split(/\r?\n/);
  }

  async function rebuildWorkspaceIndex() {
    const uris = await collectWorkspaceUris();
    const documents = [];
    for (const uri of uris) {
      try {
        documents.push({ uri: uri.toString(), lines: await readLines(uri) });
      } catch {
        // Removed/unreadable between listing and reading -- the next
        // rebuild (triggered by the same filesystem event) will settle.
      }
    }
    workspaceIndex = buildWorkspaceIndex(documents);
  }

  function scheduleIndexRebuild() {
    clearTimeout(indexRebuildTimer);
    indexRebuildTimer = setTimeout(() => {
      rebuildWorkspaceIndex().then(refreshAllOpenDocuments);
    }, INDEX_REBUILD_DEBOUNCE_MS);
  }

  function toVscodeDiagnostic(descriptor) {
    const range = new vscode.Range(descriptor.line, descriptor.startCol, descriptor.line, descriptor.endCol);
    const severity =
      descriptor.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, descriptor.message, severity);
    diagnostic.code = descriptor.code;
    diagnostic.source = 'Test Control Protocol';
    return diagnostic;
  }

  function publishDiagnostics(document) {
    if (document.languageId !== LANGUAGE_ID) return;
    const lines = document.getText().split(/\r?\n/);
    const descriptors = computeDiagnostics(lines, workspaceIndex);
    diagnosticCollection.set(document.uri, descriptors.map(toVscodeDiagnostic));
  }

  function refreshAllOpenDocuments() {
    for (const doc of vscode.workspace.textDocuments) publishDiagnostics(doc);
  }

  function scheduleDocumentRefresh(document) {
    if (document.languageId !== LANGUAGE_ID) return;
    const key = document.uri.toString();
    clearTimeout(documentRefreshTimers.get(key));
    documentRefreshTimers.set(
      key,
      setTimeout(() => publishDiagnostics(document), DOCUMENT_DEBOUNCE_MS)
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => publishDiagnostics(document)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDocumentRefresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnosticCollection.delete(document.uri)),
    vscode.workspace.onDidSaveTextDocument(() => scheduleIndexRebuild()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('files.associations')) scheduleIndexRebuild();
    })
  );

  // Patterns in files.associations are arbitrary (a bare filename like
  // "BIO", a glob, anything) and can change at any time, so there's no
  // narrower watcher scope to use -- watch everything and let the debounced
  // rebuild's own glob matching decide what actually matters. The rebuild
  // itself only re-reads files that match a TCP association, so the cost of
  // an unrelated file changing is just one debounce timer reset.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => scheduleIndexRebuild()),
    watcher.onDidCreate(() => scheduleIndexRebuild()),
    watcher.onDidDelete(() => scheduleIndexRebuild())
  );

  rebuildWorkspaceIndex().then(refreshAllOpenDocuments);
}

function deactivate() {}

module.exports = { activate, deactivate };
