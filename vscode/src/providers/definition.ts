/**
 * definition.ts - @引用 Ctrl+Click 跳转.
 *
 * 在 cmm 文件里, Ctrl+Click 或 F12 在 @xxx.cmm.md 引用上时,
 * 跳转到被引用的文件. 支持相对路径和文件名匹配.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 和 cmmExplorer.ts 保持一致的 @引用正则
const REFERENCE_REGEX = /@([\w\u4e00-\u9fff\-./][\w\u4e00-\u9fff\-./]*?(?:\.[\w\u4e00-\u9fff\-]+)+|[\w\u4e00-\u9fff\-./]+\/)/g;
const LINE_RANGE_SUFFIX = /:\d+(?:-\d+)?$/;

export class CmmDefinitionProvider implements vscode.DefinitionProvider {

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const line = document.lineAt(position.line).text;
    const charOffset = position.character; // 行内偏移, 不是文档偏移

    // 找到光标位置所在的 @引用
    let match: RegExpExecArray | null;
    const regex = new RegExp(REFERENCE_REGEX.source, 'g');
    while ((match = regex.exec(line)) !== null) {
      const start = match.index + 1; // 跳过@本身
      const end = match.index + match[0].length;
      if (charOffset >= start && charOffset <= end) {
        let ref = match[1].replace(LINE_RANGE_SUFFIX, '');
        if (!ref) { continue; }

        const targetUri = this.resolveReference(ref, document.uri);
        if (targetUri) {
          return new vscode.Location(targetUri, new vscode.Position(0, 0));
        }
      }
    }

    return undefined;
  }

  private resolveReference(ref: string, fromUri: vscode.Uri): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return undefined; }

    // 1. ref 是相对路径, 精确匹配
    for (const folder of folders) {
      const fullPath = path.join(folder.uri.fsPath, ref);
      if (fs.existsSync(fullPath)) {
        return vscode.Uri.file(fullPath);
      }
    }

    // 2. ref 相对于当前文件所在目录
    const fromDir = path.dirname(fromUri.fsPath);
    const relativeToFile = path.join(fromDir, ref);
    if (fs.existsSync(relativeToFile)) {
      return vscode.Uri.file(relativeToFile);
    }

    // 3. ref 是文件名, 在 workspace 里搜索
    const fileName = ref.replace(/\/$/, '');
    for (const folder of folders) {
      const found = this.findFileRecursive(folder.uri.fsPath, fileName);
      if (found) {
        return vscode.Uri.file(found);
      }
    }

    return undefined;
  }

  /**
   * 递归搜索文件名, 限制搜索深度避免太慢.
   */
  private findFileRecursive(dir: string, fileName: string, depth: number = 0): string | undefined {
    if (depth > 5) { return undefined; }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === fileName) {
          return path.join(dir, entry.name);
        }
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          const found = this.findFileRecursive(path.join(dir, entry.name), fileName, depth + 1);
          if (found) { return found; }
        }
      }
    } catch {
      // 权限不足等, 跳过
    }
    return undefined;
  }
}
