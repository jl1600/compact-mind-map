import * as vscode from 'vscode';
import { parseCmmTree } from '../utils/parseTree';

export class CmmPreviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private currentDoc: vscode.TextDocument | undefined;
  private activeLine = 0;
  private lastMovedLine = -1;
  private disposables: vscode.Disposable[] = [];
  private onChangeSelection: vscode.Disposable | undefined;

  async showPreview(sideBySide = true): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'cmm') {
      vscode.window.showWarningMessage('CMM Preview is only available for .cmm.md files');
      return;
    }

    if (this.panel) {
      this.revealAndBind(editor, sideBySide);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'cmmPreview',
      'CMM Preview',
      {
        viewColumn: sideBySide ? vscode.ViewColumn.Beside : editor.viewColumn!,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentDoc = undefined;
      this.onChangeSelection?.dispose();
      this.onChangeSelection = undefined;
    });

    this.panel.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'navigate':
          this.navigateToLine(msg.lineIndex);
          break;
        case 'ready':
          this.pushUpdate();
          break;
        case 'drop':
          this.handleDrop(msg.srcLine, msg.dstLine, msg.insertBefore);
          break;
      }
    }, null, this.disposables);

    this.panel.webview.html = getWebviewContent();
    this.bindEditor(editor);
  }

  private revealAndBind(editor: vscode.TextEditor, sideBySide: boolean): void {
    this.panel!.reveal(
      sideBySide ? vscode.ViewColumn.Beside : editor.viewColumn,
      true
    );
    this.bindEditor(editor);
  }

  private bindEditor(editor: vscode.TextEditor): void {
    this.currentDoc = editor.document;
    this.activeLine = editor.selection.active.line;
    this.pushUpdate();

    this.onChangeSelection?.dispose();
    this.onChangeSelection = vscode.window.onDidChangeTextEditorSelection(e => {
      if (this.panel && this.currentDoc && e.textEditor.document.uri.toString() === this.currentDoc.uri.toString()) {
        this.activeLine = e.selections[0].active.line;
        this.panel.webview.postMessage({
          type: 'highlight',
          lineIndex: this.activeLine,
        });
      }
    });
  }

  private pushUpdate(): void {
    if (!this.panel || !this.currentDoc) return;
    const text = this.currentDoc.getText();
    const lines = text.split('\n');
    const nodes = parseCmmTree(lines);
    this.panel.webview.postMessage({
      type: 'update',
      lines,
      nodes,
      activeLine: this.activeLine,
      movedLine: this.lastMovedLine,
    });
    this.lastMovedLine = -1;
  }

  onDocumentChanged(document: vscode.TextDocument): void {
    if (this.panel && this.currentDoc && document.uri.toString() === this.currentDoc.uri.toString()) {
      this.currentDoc = document;
      this.pushUpdate();
    }
  }

  private navigateToLine(lineIndex: number): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== this.currentDoc?.uri.toString()) return;
    const pos = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private handleDrop(srcLine: number, dstLine: number, insertBefore: boolean): void {
    if (!this.currentDoc) return;
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === this.currentDoc!.uri.toString()
    );
    if (!editor) return;

    const document = editor.document;
    const allLines = document.getText().split('\n');
    const nodes = parseCmmTree(allLines);
    const srcNode = nodes.find(n => n.lineIndex === srcLine);
    if (!srcNode || srcLine === dstLine) return;
    if (dstLine > srcNode.lineIndex && dstLine <= srcNode.subtreeEnd) return;

    const srcStart = srcNode.lineIndex;
    const srcEnd = srcNode.subtreeEnd;
    const srcBlock = allLines.slice(srcStart, srcEnd + 1);

    // Find effective target node at dstLine (walk up if target is deeper than src)
    let target: typeof srcNode | undefined;
    for (const n of nodes) {
      if (n.lineIndex <= dstLine && dstLine <= n.subtreeEnd) { target = n; }
    }
    if (!target) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].lineIndex < dstLine) { target = nodes[i]; break; }
      }
    }
    if (!target) { target = nodes[0]; }

    // Walk up to a node with indent <= srcNode.indent
    while (target.indent > srcNode.indent) {
      const idx = nodes.indexOf(target);
      let parent: typeof srcNode | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (nodes[i].indent < target.indent) { parent = nodes[i]; break; }
      }
      if (!parent) break;
      target = parent;
    }

    // Compute insert position in original document
    let insertLine = insertBefore ? target.lineIndex : target.subtreeEnd + 1;
    // Adjust if target was after src (since srcBlock will be removed)
    if (target.lineIndex > srcEnd) {
      insertLine -= srcBlock.length;
    }

    // Build new document: cut srcBlock, paste at insertLine
    const beforeSrc = allLines.slice(0, srcStart);
    const afterSrc = allLines.slice(srcEnd + 1);
    const reduced = beforeSrc.concat(afterSrc);
    const newLines = reduced.slice(0, insertLine).concat(srcBlock, reduced.slice(insertLine));
    const newText = newLines.join('\n');

    const fullRange = new vscode.Range(0, 0, allLines.length - 1, allLines[allLines.length - 1].length);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, newText);
    this.lastMovedLine = insertLine;
    vscode.workspace.applyEdit(edit).then(() => {
      this.activeLine = insertLine;
    });
  }

  showPreviewToSide(): void {
    this.showPreview(true);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.onChangeSelection?.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Courier New', 'Source Code Pro', monospace;
  font-size: 14px;
  line-height: 1.6;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0 40px 0;
}

.row {
  display: flex;
  align-items: baseline;
  cursor: pointer;
  min-height: 22px;
  white-space: pre;
  transition: background 0.1s;
}
.row:hover { background: #2a2a2a; }
.row.active { background: #37373d; }
.row.empty { color: transparent; pointer-events: none; }
.row.collapsed-hidden { display: none; }

.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  flex-shrink: 0;
  cursor: pointer;
  font-size: 12px;
  color: #888;
  user-select: none;
  line-height: 1;
}
.collapse-btn:hover { color: #ccc; }
.collapse-btn.no-children { visibility: hidden; }

.node-text { flex: 1; }
.node-text.special { color: #6a6a6a; font-style: italic; }
.node-text.reference { color: #61afef; text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px; }

.row.drag-over-before { border-top: 2px solid #61afef; }
.row.drag-over-after { border-bottom: 2px solid #61afef; }
.row.dragging { opacity: 0.4; }

@keyframes drop-highlight {
  from { background: #4a4a2a; }
  to { background: transparent; }
}
.row.drop-highlight { animation: drop-highlight 0.5s ease-out; }
</style>
</head>
<body>
<div id="container"></div>
<script>
const vscode = acquireVsCodeApi();

const INDENT_PX = 20;

let allLines = [];
let allNodes = [];
let nodeMap = {};
let collapsedNodes = {};
let activeLine = -1;
let dragSrcLine = -1;
let movedLine = -1;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'update') {
    allLines = msg.lines;
    allNodes = msg.nodes;
    activeLine = msg.activeLine;
    movedLine = msg.movedLine;
    collapsedNodes = {};
    buildNodeMap();
    render();
  } else if (msg.type === 'highlight') {
    activeLine = msg.lineIndex;
    highlightActive();
  }
});

function buildNodeMap() {
  nodeMap = {};
  for (const n of allNodes) {
    nodeMap[n.lineIndex] = n;
  }
}

function render() {
  const container = document.getElementById('container');
  container.innerHTML = '';

  const hidden = new Set();
  for (const [li, collapsed] of Object.entries(collapsedNodes)) {
    if (collapsed) {
      const node = nodeMap[parseInt(li)];
      if (node) {
        for (let i = node.lineIndex + 1; i <= node.subtreeEnd; i++) {
          hidden.add(i);
        }
      }
    }
  }

  for (let i = 0; i < allLines.length; i++) {
    const row = document.createElement('div');
    row.classList.add('row');
    if (i === activeLine) row.classList.add('active');
    if (i === movedLine) row.classList.add('drop-highlight');
    row.setAttribute('data-line', i);

    if (hidden.has(i)) {
      row.classList.add('collapsed-hidden');
      container.appendChild(row);
      continue;
    }

    const lineText = allLines[i];
    const node = nodeMap[i];
    const isEmpty = !node || lineText.trim().length === 0;

    if (isEmpty) {
      row.classList.add('empty');
      row.textContent = ' ';
      container.appendChild(row);
      continue;
    }

    const indent = node.indent;
    row.style.paddingLeft = (indent * INDENT_PX + 12) + 'px';

    // Collapse button
    const hasChildren = node.subtreeEnd > node.lineIndex;
    const btn = document.createElement('span');
    btn.classList.add('collapse-btn');
    if (!hasChildren) btn.classList.add('no-children');
    btn.textContent = collapsedNodes[node.lineIndex] ? '▶' : '▼';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      collapsedNodes[node.lineIndex] = !collapsedNodes[node.lineIndex];
      render();
    });
    row.appendChild(btn);

    // Text content
    const textSpan = document.createElement('span');
    textSpan.classList.add('node-text');
    if (node.text.startsWith('## !!')) textSpan.classList.add('special');
    if (/@\\S+/.test(node.text)) textSpan.classList.add('reference');
    textSpan.textContent = node.text;
    row.appendChild(textSpan);

    row.addEventListener('click', () => {
      vscode.postMessage({ type: 'navigate', lineIndex: node.lineIndex });
    });

    // Drag and drop
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      dragSrcLine = node.lineIndex;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.row.drag-over-before, .row.drag-over-after').forEach(r => {
        r.classList.remove('drag-over-before', 'drag-over-after');
      });
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.row.drag-over-before, .row.drag-over-after').forEach(r => {
        r.classList.remove('drag-over-before', 'drag-over-after');
      });
      const rect = row.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        row.classList.add('drag-over-before');
      } else {
        row.classList.add('drag-over-after');
      }
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-before', 'drag-over-after');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      row.classList.remove('drag-over-before', 'drag-over-after');
      const srcLine = dragSrcLine;
      const dstLine = parseInt(row.getAttribute('data-line'));
      dragSrcLine = -1;
      if (srcLine >= 0 && srcLine !== dstLine) {
        vscode.postMessage({ type: 'drop', srcLine, dstLine, insertBefore });
      }
    });

    container.appendChild(row);
  }
}

function highlightActive() {
  document.querySelectorAll('.row').forEach(el => {
    const line = parseInt(el.getAttribute('data-line'));
    if (line === activeLine) el.classList.add('active');
    else el.classList.remove('active');
  });
}

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
