/**
 * folding.ts - cmm文件的缩进折叠.
 *
 * 和Python的indent folding一模一样:
 * 一个节点 + 它所有缩进更深的子节点 = 一个可折叠区域.
 *
 * VSCode内置的 "editor.foldingStrategy": "indentation" 也能做类似的事,
 * 但我们注册了专门的provider, 可以做得更精准:
 *   - 跳过空行
 *   - 正确处理cmm的编辑规则头部(##开头的行单独折叠)
 *   - 折叠范围精确到节点内容, 不多不少
 */

import * as vscode from 'vscode';
import { parseCmmTree } from '../utils/parseTree';

export class CmmFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    const lines = document.getText().split('\n');
    const nodes = parseCmmTree(lines);
    const ranges: vscode.FoldingRange[] = [];

    for (const node of nodes) {
      // 只有子树超过一行（即 subtreeEnd > lineIndex）才值得折叠
      if (node.subtreeEnd > node.lineIndex) {
        ranges.push(
          new vscode.FoldingRange(
            node.lineIndex,
            node.subtreeEnd,
            vscode.FoldingRangeKind.Region
          )
        );
      }
    }

    return ranges;
  }
}
