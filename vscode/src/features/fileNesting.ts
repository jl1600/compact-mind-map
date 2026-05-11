/**
 * fileNesting.ts - 根据cmm文件里的@引用, 自动配置VSCode目录树嵌套显示.
 *
 * VSCode的 explorer.fileNetting 功能可以让文件在目录树里折叠到父文件下面,
 * 就像 README.md 下面折叠所有 .md 文件那样.
 *
 * 这个模块做的事:
 *   1. 扫描 workspace 里所有 *.cmm.md 文件
 *   2. 用正则从每个文件里提取 @xxx.cmm.md 文件引用
 *   3. 构建 父文件 -> 子文件列表 的嵌套关系
 *   4. 把这个关系写进 explorer.fileNesting.patterns (workspace settings)
 *   5. 监听文件变更, @引用改了就实时更新
 *
 * 单例多引用: 同一个子文件可以被多个父文件@引用,
 * 那这个子文件会同时嵌套在多个父文件下面, 点哪个展开都是同一个物理文件.
 */

import * as vscode from 'vscode';
import { CmmIgnore } from './cmmIgnore';

// 匹配 @xxx.cmm.md 格式的文件引用
// 支持: 英文、中文、下划线、短横线、点号
// 不匹配 @概念名 这种不带 .cmm.md 后缀的概念引用
const REFERENCE_REGEX = /@([\w\u4e00-\u9fff\-][\w\u4e00-\u9fff\-]*\.cmm\.md)/g;

export class CmmFileNesting {
  // 记住我们往 settings 里写了哪些 key,
  // 更新时只清除我们写的 key, 不动用户手动配的其他 pattern
  private managedKeys: Set<string> = new Set();

  private disposables: vscode.Disposable[] = [];
  private cmmIgnore: CmmIgnore;

  // 防抖计时器, 避免文件频繁变更时疯狂扫描
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 激活: 初始扫描 + 注册文件监听.
   * 在 extension.ts 的 activate 里调用.
   */
  constructor(cmmIgnore: CmmIgnore) {
    this.cmmIgnore = cmmIgnore;
  }

  activate(): void {
    // 确保 file nesting 功能本身是开着的
    const config = vscode.workspace.getConfiguration('explorer');
    const enabled = config.get<boolean>('fileNesting.enabled');
    if (enabled === false) {
      config.update('fileNesting.enabled', true, vscode.ConfigurationTarget.Workspace);
    }

    // 初始扫描一次
    this.scheduleRefresh();

    // 监听 cmm 文件保存 (只在保存时刷新, 避免每次按键都全量扫描)
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this.isCmmFile(doc.uri)) {
        this.scheduleRefresh();
      }
    }, undefined, this.disposables);

    // 监听 cmm 文件创建和删除 (新增/删掉了文件, 引用关系可能变了)
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.cmm.md');
    watcher.onDidCreate(() => this.scheduleRefresh());
    watcher.onDidDelete(() => this.scheduleRefresh());
    this.disposables.push(watcher);

    // 监听 workspace 变化 (切换了项目)
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.scheduleRefresh();
    }, undefined, this.disposables);

    // .cmmignore 或 settings 变更 → 重新过滤
    this.cmmIgnore.onDidChange(() => {
      this.scheduleRefresh();
    }, undefined, this.disposables);
  }

  /**
   * 清理: 插件 deactivate 时调用, 把我们写的 pattern 清掉.
   */
  async dispose(): Promise<void> {
    this.disposables.forEach(d => d.dispose());
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    // 清掉我们管理的 pattern, 恢复用户原始配置
    await this.cleanPatterns();
  }

  // ---- 内部方法 ----

  /**
   * 判断 URI 是不是 cmm 文件.
   */
  private isCmmFile(uri: vscode.Uri): boolean {
    return uri.path.endsWith('.cmm.md');
  }

  /**
   * 防抖刷新: 500ms 内多次触发只执行最后一次.
   * 编辑文件时每次按键都会触发 onDidChangeTextDocument,
   * 加防抖避免频繁扫描.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refresh();
    }, 500);
  }

  /**
   * 主流程: 扫描 -> 提取@引用 -> 构建嵌套 -> 更新 settings.
   */
  private async refresh(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    // 1. 找 workspace 里所有 *.cmm.md 文件, 过滤被忽略的
    const cmmFiles = (await vscode.workspace.findFiles('**/*.cmm.md'))
      .filter(uri => !this.cmmIgnore.isIgnored(this.getRelativePath(uri)));
    if (cmmFiles.length === 0) return;

    // 2. 建立 文件名 -> [workspace相对路径] 的映射
    //    同名文件可能在不同目录下存在, 所以值是数组
    const nameToPaths = new Map<string, string[]>();
    for (const uri of cmmFiles) {
      const relativePath = this.getRelativePath(uri);
      // 从路径里取出文件名 (最后一个 / 后面的部分)
      const fileName = uri.path.split('/').pop() || '';
      if (!nameToPaths.has(fileName)) {
        nameToPaths.set(fileName, []);
      }
      nameToPaths.get(fileName)!.push(relativePath);
    }

    // 3. 读取每个 cmm 文件的 @引用, 构建嵌套关系
    //    nestingMap: 父文件的相对路径 -> 它@引用的子文件的相对路径列表
    const nestingMap = new Map<string, string[]>();

    for (const uri of cmmFiles) {
      const relativePath = this.getRelativePath(uri);
      const references = await this.extractReferences(uri, nameToPaths);
      if (references.length > 0) {
        nestingMap.set(relativePath, references);
      }
    }

    // 4. 写进 settings
    await this.updateNestingPatterns(nestingMap);
  }

  /**
   * 从一个 cmm 文件里提取所有 @文件引用.
   *
   * 返回被引用文件的 workspace 相对路径数组.
   * 同一个文件被引用多次只记一次.
   */
  private async extractReferences(
    fileUri: vscode.Uri,
    nameToPaths: Map<string, string[]>
  ): Promise<string[]> {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const text = doc.getText();
    const references: string[] = [];
    // 用来去重: 同一个文件被@多次只记一次
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    // 每次调用 exec 前要重新创建 RegExp, 因为 exec 有内部状态 (lastIndex)
    const regex = new RegExp(REFERENCE_REGEX.source, 'g');

    while ((match = regex.exec(text)) !== null) {
      // match[1] 是 @ 后面的文件名, 如 "数字中国26_浪潮数据工厂.cmm.md"
      const refFileName = match[1];
      const paths = nameToPaths.get(refFileName);
      if (paths && paths.length > 0) {
        // 同名文件选离当前文件最近的 (共享最长路径前缀)
        const currentPath = this.getRelativePath(fileUri);
        const bestPath = this.findClosestPath(currentPath, paths);
        // 不要把自己引用自己算进去
        if (bestPath !== currentPath && !seen.has(bestPath)) {
          seen.add(bestPath);
          references.push(bestPath);
        }
      }
    }

    return references;
  }

  /**
   * 在多个同名文件中, 选离当前文件路径最近的一个.
   *
   * "最近" = 两个路径共享的最长目录前缀.
   * 比如:
   *   当前文件: cmm/数字中国26整理/交付/2号馆/云基华海/数据编织/xxx.cmm.md
   *   候选A:    cmm/数字中国26整理/交付/2号馆/云基华海/知识图谱/yyy.cmm.md
   *   候选B:    cmm/其他目录/yyy.cmm.md
   *   候选A共享前缀更长 (5级 vs 2级), 选A.
   */
  private findClosestPath(currentPath: string, candidates: string[]): string {
    if (candidates.length === 1) return candidates[0];

    let bestPath = candidates[0];
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = this.sharedPathPrefixLength(currentPath, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestPath = candidate;
      }
    }

    return bestPath;
  }

  /**
   * 计算两个路径共享多少级目录前缀.
   */
  private sharedPathPrefixLength(a: string, b: string): number {
    const partsA = a.split('/');
    const partsB = b.split('/');
    let count = 0;
    const minLen = Math.min(partsA.length, partsB.length);
    for (let i = 0; i < minLen; i++) {
      if (partsA[i] === partsB[i]) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * 把 URI 转成相对于 workspace 根的路径.
   *
   * 比如 workspace 根是 /home/user/project,
   * 文件是 /home/user/project/cmm/foo.cmm.md,
   * 返回 "cmm/foo.cmm.md".
   */
  private getRelativePath(uri: vscode.Uri): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return uri.path;

    for (const folder of workspaceFolders) {
      // folder.uri.path 末尾没有 /
      if (uri.path.startsWith(folder.uri.path + '/')) {
        return uri.path.slice(folder.uri.path.length + 1);
      }
      // 也可能是 workspace 根目录下的文件 (路径完全匹配)
      if (uri.path === folder.uri.path) {
        return uri.path.split('/').pop() || '';
      }
    }

    return uri.path;
  }

  /**
   * 更新 explorer.fileNesting.patterns 配置.
   *
   * 只动我们管理的那些 key, 不动用户手动配的.
   * 先清除上次写的旧 key, 再写入新的.
   */
  private async updateNestingPatterns(
    nestingMap: Map<string, string[]>
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('explorer');
    // 读取当前的 patterns, 拷贝成普通对象 (config.get返回Proxy, 不能直接delete)
    const rawPatterns = config.get<Record<string, string>>('fileNesting.patterns') || {};
    const currentPatterns: Record<string, string> = { ...rawPatterns };

    // 清除我们上次管理的 key (这些 key 对应的文件可能已经被删除或改了引用)
    for (const key of this.managedKeys) {
      delete currentPatterns[key];
    }

    // 写入新的 pattern
    const newKeys = new Set<string>();
    for (const [parent, children] of nestingMap) {
      // value 是逗号+空格分隔的子文件路径列表
      // VSCode file nesting 会把这些文件折叠到 parent 下面显示
      currentPatterns[parent] = children.join(', ');
      newKeys.add(parent);
    }

    // 记住这次写了哪些 key, 下次 refresh 时只清这些
    this.managedKeys = newKeys;

    // 写回 workspace settings (只影响当前项目, 不影响全局)
    await config.update(
      'fileNesting.patterns',
      currentPatterns,
      vscode.ConfigurationTarget.Workspace
    );
  }

  /**
   * 清掉所有我们管理的 pattern (插件 deactivate 时调用).
   */
  private async cleanPatterns(): Promise<void> {
    if (this.managedKeys.size === 0) return;

    const config = vscode.workspace.getConfiguration('explorer');
    const rawPatterns = config.get<Record<string, string>>('fileNesting.patterns') || {};
    const currentPatterns: Record<string, string> = { ...rawPatterns };

    for (const key of this.managedKeys) {
      delete currentPatterns[key];
    }
    this.managedKeys.clear();

    await config.update(
      'fileNesting.patterns',
      currentPatterns,
      vscode.ConfigurationTarget.Workspace
    );
  }
}
