/**
 * rainbowIndent.ts - 不同缩进层级用不同颜色显示前导空格.
 *
 * 类似 bracket pair colorization 但作用在缩进上：
 *   层级1: 红色, 层级2: 橙色, 层级3: 黄色, 层级4: 绿色, 层级5: 蓝色, 层级6: 紫色, 层级7+: 循环
 *
 * 检测到 indent-rainbow 扩展时自动跳过，避免冲突.
 */

import * as vscode from 'vscode';
import { parseCmmTree } from '../utils/parseTree';

const COLORS = [
  'rgba(255, 50, 50, 0.35)',
  'rgba(255, 140, 20, 0.35)',
  'rgba(230, 230, 20, 0.35)',
  'rgba(50, 210, 50, 0.35)',
  'rgba(50, 140, 255, 0.35)',
  'rgba(160, 100, 255, 0.35)',
  'rgba(255, 100, 170, 0.35)',
];

let decorationTypes: vscode.TextEditorDecorationType[] = [];
let activeEditor: vscode.TextEditor | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** 检查 indent-rainbow 扩展是否已安装并激活 */
function hasIndentRainbowExtension(): boolean {
  return vscode.extensions.all.some(
    ext => (ext.id.toLowerCase().includes('indent-rainbow') || ext.id.toLowerCase().includes('indentrainbow'))
  );
}

export function activateRainbowIndent(context: vscode.ExtensionContext): void {
  if (hasIndentRainbowExtension()) return;

  decorationTypes = COLORS.map(color =>
    vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      isWholeLine: false,
    })
  );
  context.subscriptions.push(...decorationTypes);

  const changeHandler = vscode.workspace.onDidChangeTextDocument(e => {
    if (activeEditor && e.document === activeEditor.document) {
      scheduleUpdate();
    }
  });

  const editorHandler = vscode.window.onDidChangeActiveTextEditor(editor => {
    activeEditor = editor;
    if (editor && editor.document.languageId === 'cmm') {
      updateDecorations(editor);
    }
  });

  const visibleHandler = vscode.window.onDidChangeTextEditorVisibleRanges(() => {
    if (activeEditor) scheduleUpdate();
  });

  if (vscode.window.activeTextEditor?.document.languageId === 'cmm') {
    activeEditor = vscode.window.activeTextEditor;
    updateDecorations(activeEditor);
  }

  context.subscriptions.push(changeHandler, editorHandler, visibleHandler);
}

function scheduleUpdate(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (activeEditor) updateDecorations(activeEditor);
  }, 80);
}

function updateDecorations(editor: vscode.TextEditor): void {
  if (editor.document.languageId !== 'cmm') return;

  const lines = editor.document.getText().split('\n');
  const nodes = parseCmmTree(lines);

  const decoRanges: vscode.Range[][] = decorationTypes.map(() => []);

  for (const node of nodes) {
    if (node.indent <= 0) continue;
    const colorIndex = (node.indent - 1) % decorationTypes.length;
    const indentEnd = lines[node.lineIndex].search(/\S|$/);
    if (indentEnd <= 0) continue;
    decoRanges[colorIndex].push(
      new vscode.Range(
        new vscode.Position(node.lineIndex, 0),
        new vscode.Position(node.lineIndex, indentEnd)
      )
    );
  }

  for (let i = 0; i < decorationTypes.length; i++) {
    editor.setDecorations(decorationTypes[i], decoRanges[i]);
  }
}
