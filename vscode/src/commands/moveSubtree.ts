/**
 * moveSubtree.ts - 子树移动命令.
 *
 * 上/下：和同级的兄弟块互换位置，子树跟着走
 * 左/右：调整整棵子树的indent，每层加减2空格
 *
 * 类似xmind：拖一个节点，它的所有子节点自动跟着动.
 * 在纯文本编辑器里用快捷键代替鼠标拖拽.
 *
 * Alt+Up: 当前节点+子树和上面的兄弟块互换
 * Alt+Down: 当前节点+子树和下面的兄弟块互换
 * Alt+Right / Tab: 整棵子树indent+2（变成上一个兄弟的子节点）
 * Alt+Left / Shift+Tab: 整棵子树indent-2（往上提一层，最少到0）
 */

import * as vscode from 'vscode';
import { parseCmmTree, findNodeAtLine } from '../utils/parseTree';
import { suppressNext } from '../providers/autoExpand';

// cmm标准每层缩进2空格
const INDENT_SIZE = 2;

/**
 * 找到光标所在节点的"逻辑节点"（可能光标在空行上，往回找最近的节点）.
 */
function findCurrentNode(nodes: ReturnType<typeof parseCmmTree>, cursorLine: number) {
  // 先精确匹配
  let node = findNodeAtLine(nodes, cursorLine);
  if (node) return node;

  // 光标在空行上，往上找最近的节点
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].lineIndex <= cursorLine) {
      // 确认这个节点的子树范围包含cursorLine
      if (cursorLine <= nodes[i].subtreeEnd) {
        return nodes[i];
      }
    }
  }
  return undefined;
}

/**
 * 提取子树的所有行文本（包含中间的空行）.
 * 从node.lineIndex到node.subtreeEnd，中间可能有空行也一并提取.
 */
function extractSubtreeLines(
  allLines: string[],
  node: { lineIndex: number; subtreeEnd: number }
): string[] {
  return allLines.slice(node.lineIndex, node.subtreeEnd + 1);
}

/**
 * 上移：和上面的兄弟块互换.
 * 兄弟块 = indent <= 当前节点，紧挨着上面的节点+它的子树.
 * 两个块之间的空行归上面的块，互换后空行保持在两个块中间.
 */
export async function moveSubtreeUp(): Promise<void> {
  // 获取当前活动的文本编辑器实例
  const editor = vscode.window.activeTextEditor;
  if (!editor) return; // 没有打开的编辑器，直接返回

  // 获取文档对象和全部文本行
  const document = editor.document;
  const allLines = document.getText().split('\n'); // 按换行符拆成字符串数组
  const nodes = parseCmmTree(allLines); // 解析cmm树结构，得到所有节点信息

  // 取光标所在行号（0-based）
  const cursorLine = editor.selection.active.line;
  // 找到光标所在的节点（可能在空行上，会往上回溯找最近的节点）
  const node = findCurrentNode(nodes, cursorLine);
  if (!node) return; // 找不到对应的cmm节点，无法操作

  // 在nodes数组里找到当前节点的索引，用于定位前后兄弟
  const nodeIdx = nodes.indexOf(node);
  if (nodeIdx <= 0) return; // 已经是nodes数组的第一个元素，没有更上面的节点了

  // 找上面同级的兄弟节点：
  // 从当前节点往前遍历，跳过所有缩进更深（indent更大）的节点（那些是别人的子节点）
  // 停在第1个 indent <= 当前节点indent 的位置，即"平级或更浅的兄弟"
  let prevNodeIdx = nodeIdx - 1;
  while (prevNodeIdx >= 0 && nodes[prevNodeIdx].indent > node.indent) {
    prevNodeIdx--; // 跳过子节点继续往上找
  }
  if (prevNodeIdx < 0) return; // 往前没找到同级节点，无法互换

  // 获取上面兄弟节点的完整信息（包含其子树范围）
  const prevNode = nodes[prevNodeIdx];

  // 用当前节点把allLines切成前后两半：
  // ┌──────────────────────────────────────────┐
  // │ firstHalf  │ currBlock  │ secondHalf    │
  // │ (0 ~ 当前节 │ (当前节点+ │ (子树结束后)   │
  // │  点之前)    │   子树)     │               │
  // └──────────────────────────────────────────┘
  // 在firstHalf中找兄弟节点，互换currBlock和prevBlock后重新拼合
  const firstHalf = allLines.slice(0, node.lineIndex); // 当前节点之前的所有行
  const currBlock = allLines.slice(node.lineIndex, node.subtreeEnd + 1); // 当前节点+子树
  const secondHalf = allLines.slice(node.subtreeEnd + 1); // 当前子树之后的所有行

  // 在firstHalf中定位兄弟块和它周围的三个子部分：
  // ┌──────────────────────────────────────────┐
  // │ beforePrev  │ prevBlock │ gapLines │(这里是currBlock的位置)│
  // └──────────────────────────────────────────┘
  const prevBlockStart = prevNode.lineIndex; // 兄弟块在firstHalf中的起始行
  const prevBlockEnd = prevNode.subtreeEnd; // 兄弟块子树结束行
  const beforePrev = firstHalf.slice(0, prevBlockStart); // 兄弟块之前的内容
  const prevBlock = firstHalf.slice(prevBlockStart, prevBlockEnd + 1); // 兄弟块+子树
  const gapLines = firstHalf.slice(prevBlockEnd + 1); // 兄弟块和currBlock之间的空白行

  // 重新排序：beforePrev + currBlock + gap + prevBlock + secondHalf
  // currBlock和prevBlock互换，空白行保持在中间
  const newLines = [...beforePrev, ...currBlock, ...gapLines, ...prevBlock, ...secondHalf];
  const newText = newLines.join('\n'); // 用换行符重新组合成完整文本

  // 替换整个文档（避免局部range替换导致的split/join换行数不一致）
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(allLines.length - 1, allLines[allLines.length - 1].length)
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, newText);
  await vscode.workspace.applyEdit(edit);

  // 互换后选中交换后的整棵子树（它现在在prev原来的位置）
  const newSubtreeStart = beforePrev.length; // currBlock的新起始行
  const newSubtreeEnd = newSubtreeStart + currBlock.length - 1; // currBlock的新结束行
  const firstLineText = currBlock[0]; // currBlock第一行的文本
  const textStart = firstLineText.search(/\S/); // 找到第一个非空白字符的位置（锚点）
  suppressNext(); // 抑制下一次自动展开，避免选中时意外触发
  editor.selection = new vscode.Selection(
    new vscode.Position(newSubtreeEnd, newLines[newSubtreeEnd].length), // anchor: 子树最后一行末尾
    new vscode.Position(newSubtreeStart, textStart >= 0 ? textStart : 0) // active: 子树第一行有字符处
  );
}

/**
 * 下移：和下面的兄弟块互换.
 * 兄弟块 = indent <= 当前节点，紧挨着下面的节点+它的子树.
 * 两个块之间的空行归上面的块，互换后空行保持在两个块中间.
 */
export async function moveSubtreeDown(): Promise<void> {
  // 获取当前活动的文本编辑器实例
  const editor = vscode.window.activeTextEditor;
  if (!editor) return; // 没有打开的编辑器，直接返回

  // 获取文档对象和全部文本行
  const document = editor.document;
  const allLines = document.getText().split('\n'); // 按换行符拆成字符串数组
  const nodes = parseCmmTree(allLines); // 解析cmm树结构，得到所有节点信息

  // 取光标所在行号（0-based）
  const cursorLine = editor.selection.active.line;
  // 找到光标所在的节点（可能在空行上，会往上回溯找最近的节点）
  const node = findCurrentNode(nodes, cursorLine);
  if (!node) return; // 找不到对应的cmm节点，无法操作

  // 在nodes数组里找到当前节点的索引，用于定位前后兄弟
  const nodeIdx = nodes.indexOf(node);

  // 找下面同级的兄弟节点：
  // 从当前节点往后遍历，跳过所有缩进更深（indent更大）的节点（那些是当前节点的子节点）
  // 停在第1个 indent <= 当前节点indent 的位置，即"平级或更浅的兄弟"
  let nextNodeIdx = nodeIdx + 1;
  while (nextNodeIdx < nodes.length && nodes[nextNodeIdx].indent > node.indent) {
    nextNodeIdx++; // 跳过子节点继续往下找
  }
  if (nextNodeIdx >= nodes.length) return; // 后面没找到同级节点，无法互换

  // 获取下面兄弟节点的完整信息（包含其子树范围）
  const nextNode = nodes[nextNodeIdx];

  // 用当前节点把allLines切成前后两半：
  // ┌──────────────────────────────────────────┐
  // │ firstHalf  │ currBlock  │ secondHalf    │
  // │ (0 ~ 当前节 │ (当前节点+ │ (子树结束后)   │
  // │  点之前)    │   子树)     │               │
  // └──────────────────────────────────────────┘
  // 在secondHalf中找兄弟节点，互换currBlock和nextBlock后重新拼合
  const firstHalf = allLines.slice(0, node.lineIndex); // 当前节点之前的所有行
  const currBlock = allLines.slice(node.lineIndex, node.subtreeEnd + 1); // 当前节点+子树
  const secondHalf = allLines.slice(node.subtreeEnd + 1); // 当前子树之后的所有行

  // secondHalf中的偏移量（nextNode的绝对行号减去secondHalf的起始行号）
  const nextRelStart = nextNode.lineIndex - node.subtreeEnd - 1; // 兄弟块在secondHalf中的起始索引
  const nextRelEnd = nextNode.subtreeEnd - node.subtreeEnd - 1; // 兄弟块子树在secondHalf中的结束索引

  // 在secondHalf中定位兄弟块和它周围的三个子部分：
  // ┌──────────────────────────────────────────┐
  // │ gapLines │ nextBlock │ afterNext │
  // └──────────────────────────────────────────┘
  const gapLines = secondHalf.slice(0, nextRelStart); // currBlock和nextBlock之间的空白行
  const nextBlock = secondHalf.slice(nextRelStart, nextRelEnd + 1); // 兄弟块+子树
  const afterNext = secondHalf.slice(nextRelEnd + 1); // 兄弟块之后的内容

  // 重新排序：firstHalf + nextBlock + gap + currBlock + afterNext
  // currBlock和nextBlock互换，空白行保持在中间
  const newLines = [...firstHalf, ...nextBlock, ...gapLines, ...currBlock, ...afterNext];
  const newText = newLines.join('\n'); // 用换行符重新组合成完整文本

  // 替换整个文档（避免局部range替换导致的split/join换行数不一致）
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(allLines.length - 1, allLines[allLines.length - 1].length)
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, newText);
  await vscode.workspace.applyEdit(edit);

  // 互换后选中交换后的整棵子树（它被换到后面了）
  const newSubtreeStart = firstHalf.length + nextBlock.length + gapLines.length; // currBlock的新起始行
  const newSubtreeEnd = newSubtreeStart + currBlock.length - 1; // currBlock的新结束行
  const firstLineText = currBlock[0]; // currBlock第一行的文本
  const textStart = firstLineText.search(/\S/); // 找到第一个非空白字符的位置（锚点）
  suppressNext(); // 抑制下一次自动展开，避免选中时意外触发
  editor.selection = new vscode.Selection(
    new vscode.Position(newSubtreeEnd, newLines[newSubtreeEnd].length), // anchor: 子树最后一行末尾
    new vscode.Position(newSubtreeStart, textStart >= 0 ? textStart : 0) // active: 子树第一行有字符处
  );
}

/**
 * 右移indent：整棵子树每行前面加2空格.
 * 类似WPS/Google Docs里的增加缩进，但整棵子树一起动.
 */
export async function indentSubtreeRight(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const document = editor.document;
  const allLines = document.getText().split('\n');
  const nodes = parseCmmTree(allLines);

  const cursorLine = editor.selection.active.line;
  const node = findCurrentNode(nodes, cursorLine);
  if (!node) return;

  // 子树范围：node.lineIndex到node.subtreeEnd
  const start = node.lineIndex;
  const end = node.subtreeEnd;

  // 每行前面加INDENT_SIZE个空格
  const edit = new vscode.WorkspaceEdit();
  for (let i = start; i <= end; i++) {
    const line = allLines[i];
    // 跳过空行
    if (line.trim().length === 0) continue;
    const pos = new vscode.Position(i, 0);
    edit.insert(document.uri, pos, ' '.repeat(INDENT_SIZE));
  }
  await vscode.workspace.applyEdit(edit);

  // 选中整棵子树，光标落在首行有字处
  const lastLineLen = document.lineAt(end).text.length;
  suppressNext();
  editor.selection = new vscode.Selection(
    new vscode.Position(end, lastLineLen),
    new vscode.Position(start, node.indent * INDENT_SIZE + INDENT_SIZE)
  );
}

/**
 * 左移indent：整棵子树每行前面减2空格（最少减到0）.
 * 类似WPS/Google Docs里的减少缩进，但整棵子树一起动.
 */
export async function indentSubtreeLeft(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const document = editor.document;
  const allLines = document.getText().split('\n');
  const nodes = parseCmmTree(allLines);

  const cursorLine = editor.selection.active.line;
  const node = findCurrentNode(nodes, cursorLine);
  if (!node) return;

  const start = node.lineIndex;
  const end = node.subtreeEnd;

  const edit = new vscode.WorkspaceEdit();
  for (let i = start; i <= end; i++) {
    const line = allLines[i];
    if (line.trim().length === 0) continue;
    // 计算这行有多少前导空格
    const leadingSpaces = line.search(/\S/);
    if (leadingSpaces === 0) continue; // 已经没缩进了，不动
    // 减掉INDENT_SIZE个空格，但最少减到0
    const removeCount = Math.min(INDENT_SIZE, leadingSpaces);
    const range = new vscode.Range(i, 0, i, removeCount);
    edit.delete(document.uri, range);
  }
  await vscode.workspace.applyEdit(edit);

  // 选中整棵子树，光标落在首行有字处
  const lastLineLen = document.lineAt(end).text.length;
  const newIndent = Math.max(0, node.indent - 1);
  suppressNext();
  editor.selection = new vscode.Selection(
    new vscode.Position(end, lastLineLen),
    new vscode.Position(start, newIndent * INDENT_SIZE)
  );
}

/**
 * 选中当前节点+整个子树.
 * 选中后可以用VSCode原生的鼠标拖拽移动整棵子树.
 * drop后用Alt+Left/Right调整缩进.
 */
export function selectSubtree(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const document = editor.document;
  const allLines = document.getText().split('\n');
  const nodes = parseCmmTree(allLines);

  const cursorLine = editor.selection.active.line;
  const node = findCurrentNode(nodes, cursorLine);
  if (!node) return;

  // 选中从节点行首到子树最后一行末尾
  const lastLine = document.lineAt(node.subtreeEnd);
  editor.selection = new vscode.Selection(
    new vscode.Position(node.lineIndex, 0),
    new vscode.Position(node.subtreeEnd, lastLine.text.length)
  );
}
