/**
 * hover.ts - cmm文件的路径预览.
 *
 * 鼠标悬停在cmm文件任意位置（包括缩进空白区）时,
 * 显示从根节点到当前行的完整路径, 格式: 根 > 子 > 孙 > 当前行
 *
 * 用StickyLineProvider不行, 那个是sticky scroll用的.
 * 这里用HoverProvider, 但要处理"hover在缩进空白区也能触发"的问题.
 *
 * VSCode默认行为: hover在行尾空白区不触发hover.
 * 解决办法: 在provideHover里, 只要光标在这一行的范围内(0到行尾)都算hover.
 *           实际上HoverProvider的position参数本身就是鼠标位置,
 *           我们只要拿到position对应的行号就行, 不管position在这行的哪个列.
 */

import * as vscode from 'vscode';
import { parseCmmTree, getPathToLine } from '../utils/parseTree';

export class CmmHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    // 拿到鼠标所在行
    const lineIndex = position.line;
    const lines = document.getText().split('\n');

    // 空行不显示路径
    if (lines[lineIndex].trim().length === 0) {
      return undefined;
    }

    const nodes = parseCmmTree(lines);
    const path = getPathToLine(nodes, lineIndex);

    if (path.length === 0) {
      return undefined;
    }

    // 拼路径: 根 > 子 > 孙 > 当前
    // 每个节点只取text（去掉缩进后的内容）
    const pathText = path.map(n => n.text).join(' > ');

    // hover的范围: 整行（从行首到行尾）
    // 这样不管鼠标在这行的哪个位置都会触发
    const range = document.lineAt(lineIndex).range;

    return new vscode.Hover(pathText, range);
  }
}
