/**
 * cmmExplorer.ts - CMM Explorer侧边栏, 用TreeView API自定义树视图.
 *
 * 绕开VSCode原生file nesting的一层递归限制, 自己画树, 支持无限层级.
 * 树的层级完全由cmm文件里的@引用关系驱动.
 *
 * 做的事:
 *   1. 扫描workspace里所有*.cmm.md文件
 *   2. 从每个文件里提取@引用 (cmm文件, 目录, 其他任意文件)
 *   3. 构建树: 没被任何cmm@引用的文件作为根节点, 有@引用的按引用关系挂子节点
 *   4. 点击节点打开对应文件
 *   5. 监听文件变更, 实时刷新树
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CmmIgnore } from './cmmIgnore';

// ---- 树节点 ----

type RefType = 'cmm' | 'directory' | 'file';

export class CmmFileNode {
  constructor(
    /** 文件或目录的workspace相对路径 */
    readonly relativePath: string,
    /** 显示名 */
    readonly label: string,
    /** 引用类型 */
    readonly refType: RefType,
    /** 这个节点来自哪个cmm文件的@引用 (根节点为undefined) */
    readonly parentCmm?: string,
  ) {}

  /** cmm文件: 有@引用子节点则可展开; 目录: 天然可展开; 其他文件: 不可展开 */
  get canExpand(): boolean {
    return this.refType === 'cmm' || this.refType === 'directory';
  }
}

// ---- @引用提取 ----

// 匹配 @后面跟一个路径, 路径里可以有中文/英文/下划线/短横线/点号/斜杠/
// 但排除纯概念引用 (没有扩展名也没有/后缀的)
// 能匹配:
//   @xxx.cmm.md       → cmm子文件
//   @xxx.md            → 普通文件
//   @src/utils/        → 目录 (以/结尾)
//   @app.py:20-40      → 行范围引用 (取文件部分)
// 不匹配:
//   @概念名            → 纯概念引用 (无扩展名无/)
//   @ARCHITECTURE      → 同上
const REFERENCE_REGEX = /@([\w\u4e00-\u9fff\-./][\w\u4e00-\u9fff\-./]*?(?:\.[\w\u4e00-\u9fff\-]+)+|[\w\u4e00-\u9fff\-./]+\/)/g;

// 行范围后缀: :20-40 或 :20
const LINE_RANGE_SUFFIX = /:\d+(?:-\d+)?$/;

/**
 * 从cmm文件文本里提取所有@文件/目录引用.
 * 返回去重后的引用路径列表 (workspace相对路径).
 */
function extractReferences(
  text: string,
  cmmRelativePath: string,
  nameToPaths: Map<string, string[]>,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(REFERENCE_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // 去掉行范围后缀
    let ref = match[1].replace(LINE_RANGE_SUFFIX, '');
    if (!ref || seen.has(ref)) { continue; }

    // 尝试解析为workspace里的实际文件/目录
    const resolved = resolveReference(ref, cmmRelativePath, nameToPaths);
    if (resolved && resolved !== cmmRelativePath && !seen.has(resolved)) {
      seen.add(resolved);
      refs.push(resolved);
    }
  }

  return refs;
}

/**
 * 把@引用的路径解析为workspace相对路径.
 * 优先精确匹配, 找不到则按文件名模糊匹配.
 */
function resolveReference(
  ref: string,
  fromPath: string,
  nameToPaths: Map<string, string[]>,
): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) { return undefined; }

  // 1. ref本身就是workspace相对路径, 精确匹配文件或目录
  for (const folder of workspaceFolders) {
    const fullPath = path.join(folder.uri.fsPath, ref);
    if (fs.existsSync(fullPath)) {
      return ref;
    }
  }

  // 2. ref可能是相对路径, 相对于fromPath所在目录
  const fromDir = path.dirname(fromPath);
  const relativeToFile = path.join(fromDir, ref);
  for (const folder of workspaceFolders) {
    const fullPath = path.join(folder.uri.fsPath, relativeToFile);
    if (fs.existsSync(fullPath)) {
      // 归一化路径
      return relativeToFile.replace(/\\/g, '/');
    }
  }

  // 3. ref可能是文件名 (不含路径), 按文件名查 nameToPaths
  const fileName = ref.replace(/\/$/, ''); // 去掉末尾/
  const candidates = nameToPaths.get(fileName);
  if (candidates && candidates.length > 0) {
    return findClosestPath(fromPath, candidates);
  }

  return undefined;
}

/**
 * 在多个同名文件中选离当前文件路径最近的 (共享最长目录前缀).
 */
function findClosestPath(currentPath: string, candidates: string[]): string {
  if (candidates.length === 1) { return candidates[0]; }
  let best = candidates[0];
  let bestScore = 0;
  for (const c of candidates) {
    const score = sharedPrefixLength(currentPath, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function sharedPrefixLength(a: string, b: string): number {
  const pa = a.split('/');
  const pb = b.split('/');
  let count = 0;
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if (pa[i] === pb[i]) { count++; }
    else { break; }
  }
  return count;
}

// ---- TreeDataProvider ----

export class CmmExplorer implements vscode.TreeDataProvider<CmmFileNode> {

  private _onDidChangeTreeData = new vscode.EventEmitter<CmmFileNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private cmmIgnore: CmmIgnore;

  /** 缓存: cmm文件相对路径 -> 它@引用的子路径列表 */
  private childrenMap = new Map<string, string[]>();
  /** 缓存: 所有被其他cmm@引用的文件/目录路径集合 */
  private referencedPaths = new Set<string>();
  /** 缓存: 所有cmm文件相对路径 */
  private allCmmPaths: string[] = [];

  constructor(cmmIgnore: CmmIgnore) {
    this.cmmIgnore = cmmIgnore;
    console.log('[CMM Explorer] constructor called');
    this.setupWatchers();
    this.scheduleRefresh();
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
  }

  // ---- TreeDataProvider 接口 ----

  getTreeItem(element: CmmFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.canExpand
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    item.resourceUri = vscode.Uri.file(this.toAbsolutePath(element.relativePath));
    item.tooltip = element.relativePath;

    // 点击打开文件
    if (element.refType !== 'directory') {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [item.resourceUri],
      };
    }

    // 图标
    if (element.refType === 'directory') {
      item.iconPath = vscode.ThemeIcon.Folder;
    } else if (element.refType === 'cmm') {
      item.iconPath = new vscode.ThemeIcon('file-symlink-file');
    } else {
      item.iconPath = vscode.ThemeIcon.File;
    }

    // 右键菜单 contextValue, 用来控制菜单项显示
    item.contextValue = element.refType === 'directory' ? 'cmmDir' : 'cmmFile';

    return item;
  }

  async getChildren(element?: CmmFileNode): Promise<CmmFileNode[]> {
    if (!element) {
      // 根节点: 所有cmm文件都展示 (支持回环/互相引用场景)
      // 如果只展示未被@引用的文件, 回环会导致所有文件都被过滤掉变成空树
      await this.ensureData();
      const roots = this.allCmmPaths
        .map(p => this.makeNode(p, p))
        .sort((a, b) => a.label.localeCompare(b.label));
      console.log('[CMM Explorer] getChildren(root) =>', roots.map(n => n.label), 'total:', this.allCmmPaths.length);
      return roots;
    }

    // 非根: 展示这个节点的子引用
    await this.ensureData();
    const children = (this.childrenMap.get(element.relativePath) || [])
      .map(p => this.makeNode(p, element.relativePath))
      .sort((a, b) => a.label.localeCompare(b.label));
    console.log('[CMM Explorer] getChildren(', element.label, ') =>', children.map(c => c.label));
    return children;
  }

  // ---- 内部方法 ----

  private makeNode(refPath: string, parentCmm: string): CmmFileNode {
    const fileName = refPath.split('/').pop() || refPath;
    const isDir = refPath.endsWith('/');
    const isCmm = refPath.endsWith('.cmm.md');
    const refType: RefType = isDir ? 'directory' : isCmm ? 'cmm' : 'file';

    return new CmmFileNode(refPath, fileName, refType, parentCmm);
  }

  private toAbsolutePath(relativePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { return relativePath; }
    return path.join(workspaceFolders[0].uri.fsPath, relativePath);
  }

  private dataReady = false;

  private async ensureData(): Promise<void> {
    if (this.dataReady) { return; }
    await this.refreshData();
    this.dataReady = true;
  }

  private setupWatchers(): void {
    // cmm文件保存时刷新 (只在保存时刷新, 避免每次按键都全量扫描)
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.path.endsWith('.cmm.md')) {
        this.dataReady = false;
        this.scheduleRefresh();
      }
    }, undefined, this.disposables);

    // cmm文件创建/删除
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.cmm.md');
    watcher.onDidCreate(() => { this.dataReady = false; this.scheduleRefresh(); });
    watcher.onDidDelete(() => { this.dataReady = false; this.scheduleRefresh(); });
    this.disposables.push(watcher);

    // workspace切换
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.dataReady = false;
      this.scheduleRefresh();
    }, undefined, this.disposables);

    // .cmmignore 或 settings 变更 → 重新过滤
    this.cmmIgnore.onDidChange(() => {
      this.dataReady = false;
      this.scheduleRefresh();
    }, undefined, this.disposables);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    this.refreshTimer = setTimeout(() => {
      this.refreshData().then(() => {
        this._onDidChangeTreeData.fire(undefined);
      });
    }, 500);
  }

  private async refreshData(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('[CMM Explorer] no workspace folders');
      return;
    }

    // 找所有cmm文件, 过滤被忽略的
    const cmmFiles = (await vscode.workspace.findFiles('**/*.cmm.md'))
      .filter(uri => !this.cmmIgnore.isIgnored(this.getRelativePath(uri)));
    console.log('[CMM Explorer] found cmm files:', cmmFiles.length, cmmFiles.map(u => u.path));
    if (cmmFiles.length === 0) {
      this.allCmmPaths = [];
      this.childrenMap.clear();
      this.referencedPaths.clear();
      return;
    }

    // 文件名 -> [相对路径]
    const nameToPaths = new Map<string, string[]>();
    for (const uri of cmmFiles) {
      const rp = this.getRelativePath(uri);
      const name = uri.path.split('/').pop() || '';
      if (!nameToPaths.has(name)) { nameToPaths.set(name, []); }
      nameToPaths.get(name)!.push(rp);
    }

    // 也把非cmm文件加入nameToPaths (用于@引用解析)
    const allFiles = await vscode.workspace.findFiles('**/*');
    for (const uri of allFiles) {
      const rp = this.getRelativePath(uri);
      const name = uri.path.split('/').pop() || '';
      if (!nameToPaths.has(name)) { nameToPaths.set(name, []); }
      const arr = nameToPaths.get(name)!;
      if (!arr.includes(rp)) { arr.push(rp); }
    }

    // 也加入目录名
    // (通过遍历所有文件路径, 提取目录部分)
    const dirs = new Set<string>();
    for (const uri of allFiles) {
      const rp = this.getRelativePath(uri);
      const parts = rp.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/') + '/');
      }
    }
    for (const dir of dirs) {
      const name = dir.replace(/\/$/, '').split('/').pop() + '/';
      if (!nameToPaths.has(name)) { nameToPaths.set(name, []); }
      const arr = nameToPaths.get(name)!;
      if (!arr.includes(dir)) { arr.push(dir); }
    }

    this.allCmmPaths = cmmFiles.map(u => this.getRelativePath(u));
    this.childrenMap.clear();
    this.referencedPaths.clear();

    // 提取每个cmm文件的@引用
    for (const uri of cmmFiles) {
      const rp = this.getRelativePath(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const refs = extractReferences(text, rp, nameToPaths);
      if (refs.length > 0) {
        this.childrenMap.set(rp, refs);
        for (const ref of refs) {
          this.referencedPaths.add(ref);
        }
      }
    }

    this.dataReady = true;
    const roots = this.allCmmPaths.filter(p => !this.referencedPaths.has(p));
    console.log('[CMM Explorer] root nodes:', roots);
    console.log('[CMM Explorer] referencedPaths:', Array.from(this.referencedPaths));
  }

  private getRelativePath(uri: vscode.Uri): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return uri.path; }
    for (const folder of workspaceFolders) {
      if (uri.path.startsWith(folder.uri.path + '/')) {
        return uri.path.slice(folder.uri.path.length + 1);
      }
      if (uri.path === folder.uri.path) {
        return uri.path.split('/').pop() || '';
      }
    }
    return uri.path;
  }
}
