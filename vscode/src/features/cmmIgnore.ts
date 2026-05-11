/**
 * cmmIgnore.ts - .cmmignore 解析和文件过滤.
 *
 * 读取 workspace 根目录的 .cmmignore 文件,
 * 解析 gitignore 风格的 pattern,
 * 提供 isIgnored(relativePath) 判断文件是否应该被忽略.
 *
 * pattern 来源(按优先级从低到高):
 *   1. 内置默认忽略 (node_modules/ 等, 可通过 cmm.useDefaultIgnore 关闭)
 *   2. vscode settings 里的 cmm.ignorePatterns
 *   3. .cmmignore 文件
 *
 * 和 gitignore 一样, 后面的 pattern 覆盖前面的:
 *   最后一个匹配的 pattern 决定结果, !否定可以取消之前的忽略.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_IGNORES = [
  'node_modules/',
  '.git/',
  'out/',
  'dist/',
  'build/',
];

interface IgnoreRule {
  negate: boolean;
  regex: RegExp;
}

export class CmmIgnore {
  private rules: IgnoreRule[] = [];
  private disposables: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.load();
    this.watch();
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * 判断一个 workspace 相对路径是否应该被忽略.
   * 和 gitignore 语义一致: 最后一个匹配的 rule 决定结果.
   */
  isIgnored(relativePath: string): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.regex.test(relativePath)) {
        ignored = !rule.negate;
      }
    }
    return ignored;
  }

  private load(): void {
    this.rules = [];

    // 1. 内置默认忽略
    const config = vscode.workspace.getConfiguration('cmm');
    if (config.get<boolean>('useDefaultIgnore', true)) {
      for (const p of DEFAULT_IGNORES) {
        this.addRule(p);
      }
    }

    // 2. settings 里的 pattern
    for (const p of config.get<string[]>('ignorePatterns', [])) {
      this.addRule(p);
    }

    // 3. .cmmignore 文件
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        const f = path.join(folder.uri.fsPath, '.cmmignore');
        if (fs.existsSync(f)) {
          for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
            this.addRule(line);
          }
        }
      }
    }
  }

  private addRule(line: string): void {
    line = line.trim();
    if (!line) { return; }

    // \# → literal #, \! → literal !
    if (line.startsWith('\\#')) {
      line = '#' + line.slice(2);
    } else if (line.startsWith('#')) {
      return; // comment
    }
    let negate = false;
    if (line.startsWith('\\!')) {
      line = '!' + line.slice(2);
    } else if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }

    const regex = this.toRegex(line);
    if (regex) {
      this.rules.push({ negate, regex });
    }
  }

  /**
   * 把 gitignore 风格的 pattern 转为正则表达式.
   *
   * 匹配目标是 workspace 相对路径 (如 "cmm/foo.cmm.md", "test/A-架构总览.cmm.md").
   *
   * 规则:
   *   无路径分隔符的 pattern 匹配任意层级 (test/ → 任意位置的 test 目录)
   *   有路径分隔符的 pattern 相对于 workspace 根 (src/test/ → 只有根下的 src/test)
   *   末尾 / 表示目录 (匹配该目录下所有文件)
   *   ! 开头表示否定
   */
  private toRegex(pattern: string): RegExp | undefined {
    const isDirPattern = pattern.endsWith('/');
    let p = isDirPattern ? pattern.slice(0, -1) : pattern;
    if (!p) { return undefined; }

    const hasSlash = p.includes('/');

    let re: string;
    if (isDirPattern && !hasSlash) {
      // "test/" → 任意层级的 test 目录下的文件
      re = '(?:.*/)?' + globToRegexStr(p) + '/.*';
    } else if (isDirPattern && hasSlash) {
      // "src/test/" → workspace 根下的 src/test 目录
      re = globToRegexStr(p) + '/.*';
    } else if (!hasSlash) {
      // "*.test.cmm.md" → 匹配任意层级
      re = '(?:.*/)?' + globToRegexStr(p);
    } else {
      // "src/test/file.cmm.md" 或 "test/**" → 相对于 workspace 根
      re = globToRegexStr(p);
    }

    try {
      return new RegExp('^' + re + '$');
    } catch {
      return undefined;
    }
  }

  private watch(): void {
    // 监听 .cmmignore 文件变化
    const watcher = vscode.workspace.createFileSystemWatcher('**/.cmmignore');
    const reload = () => { this.load(); this._onDidChange.fire(); };
    watcher.onDidCreate(reload);
    watcher.onDidChange(reload);
    watcher.onDidDelete(reload);
    this.disposables.push(watcher);

    // 监听 settings 变化
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cmm')) { reload(); }
    }, undefined, this.disposables);
  }
}

// 把 glob pattern 转为正则字符串.
// 字符逐个处理, 避免 replace 链的顺序依赖问题.
//   *   → [^/]*   (除 / 外的任意字符)
//   **/ → 任意层级目录 (在函数内展开为正则)
//   **  → .*      (任意字符含 /)
//   ?   → [^/]    (除 / 外的单个字符)
//   .   → \.      (转义)
function globToRegexStr(glob: string): string {
  let result = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          // **/ → 零或多个目录
          result += '(?:.*/)?';
          i += 3;
        } else {
          // ** → 任意字符含 /
          result += '.*';
          i += 2;
        }
      } else {
        // * → 除 / 外的任意字符
        result += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      result += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      result += '\\' + c;
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}
