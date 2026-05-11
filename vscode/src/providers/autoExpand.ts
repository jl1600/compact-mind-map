/**
 * autoExpand.ts - 选中整行时自动扩展到子树.
 *
 * 用户在cmm文件里选中整行（比如三击选中一行，或者鼠标从行首拖到行尾），
 * 自动把selection扩展到该节点的整个子树范围.
 *
 * 这样用户直接拖拽就带着整棵子树走，不需要额外操作.
 *
 * 防止无限循环：用一个flag标记是程序自己改的selection，跳过处理.
 */

import * as vscode from 'vscode';
import { parseCmmTree, findNodeAtLine } from '../utils/parseTree';

// flag：程序自己改selection时设为true，跳过这次监听回调
// 导出给其他模块用：命令改selection前先调suppressNext()防止autoExpand二次干扰
let isProgrammaticSelection = false;

/**
 * 抑制下一次selection变化触发的autoExpand.
 * 在命令里改selection之前调用.
 */
export function suppressNext(): void {
  isProgrammaticSelection = true;
}

/**
 * 注册selection变化监听.
 * 只在cmm语言文件上生效.
 */
export function autoExpandSelectionToSubtree(context: vscode.ExtensionContext): void {
  const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
    // 只处理cmm文件
    if (event.textEditor.document.languageId !== 'cmm') return;
    // 程序自己改的，跳过
    if (isProgrammaticSelection) {
      isProgrammaticSelection = false;
      return;
    }

    const editor = event.textEditor;
    const document = editor.document;
    const sel = event.selections[0];
    if (!sel) return;

    // 检测是否选中了完整的行：
    // selection从行首(字符0)开始，到某行末尾结束
    // 也就是说 start.character === 0 且 end.character === 该行的text.length
    if (sel.start.character !== 0) return;

    const endLine = document.lineAt(sel.end.line);
    // end.character等于行文本长度才算选中到行尾
    // 注意：如果是多行选中，中间的行自然被完整覆盖，只要start从行首、end到行尾就行
    if (sel.end.character !== endLine.text.length) return;

    // 选中的是完整行（可能多行），找到selection起始行的节点
    const allLines = document.getText().split('\n');
    const nodes = parseCmmTree(allLines);
    const node = findNodeAtLine(nodes, sel.start.line);
    if (!node) return;

    // 子树只有一行就不需要扩展
    if (node.subtreeEnd === node.lineIndex) return;

    // 已经选中了整个子树也不需要扩展
    // 条件放宽：只要selection覆盖了子树范围就跳过（允许end character不完全匹配）
    const lastLine = document.lineAt(node.subtreeEnd);
    if (sel.start.line <= node.lineIndex && sel.end.line >= node.subtreeEnd) {
      return;
    }

    // 扩展selection到子树范围
    isProgrammaticSelection = true;
    editor.selection = new vscode.Selection(
      new vscode.Position(node.lineIndex, 0),
      new vscode.Position(node.subtreeEnd, lastLine.text.length)
    );
  });

  context.subscriptions.push(disposable);
}
