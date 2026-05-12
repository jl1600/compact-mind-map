/**
 * extension.ts - cmm-editor-support 插件入口.
 *
 * activate时注册所有provider和命令:
 *   - FoldingRangeProvider: indent折叠
 *   - HoverProvider: 路径预览（hover任意位置显示根到当前节点路径）
 *   - 命令: moveSubtreeUp/Down（Alt+Up/Down带子树整体移动）
 *   - selection监听: 选中整行时自动扩展到子树（拖拽带子树）
 *   - 装饰器: rainbow缩进（检测到indent-rainbow插件则跳过）
 *
 * sticky scroll不需要额外provider:
 *   VSCode内置sticky scroll基于folding range工作,
 *   我们的FoldingRangeProvider已经按indent层级返回了正确范围,
 *   用户开editor.stickyScroll.enabled就自动生效.
 *
 * 所有provider只在语言ID为 "cmm" 的文件上生效.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CmmFoldingProvider } from './providers/folding';
import { CmmHoverProvider } from './providers/hover';
import { moveSubtreeUp, moveSubtreeDown, indentSubtreeRight, indentSubtreeLeft, selectSubtree } from './commands/moveSubtree';
import { autoExpandSelectionToSubtree } from './providers/autoExpand';
import { CmmFileNesting } from './features/fileNesting';
import { CmmExplorer, CmmFileNode } from './features/cmmExplorer';
import { CmmIgnore } from './features/cmmIgnore';
import { activateRainbowIndent } from './providers/rainbowIndent';
import { CmmDefinitionProvider } from './providers/definition';
import { CmmPreviewProvider } from './providers/preview';

export function activate(context: vscode.ExtensionContext) {
  // rainbow缩进: 不同层级用不同颜色
  activateRainbowIndent(context);

  // @引用 Ctrl+Click 跳转到被引用的文件 (cmm文件 + markdown文件都支持)
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    [{ language: 'cmm' }, { language: 'markdown' }],
    new CmmDefinitionProvider()
  );
  context.subscriptions.push(definitionProvider);

  // indent折叠
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    { language: 'cmm' },
    new CmmFoldingProvider()
  );
  context.subscriptions.push(foldingProvider);

  // 路径预览（hover任意位置显示从根到当前节点的完整路径）
  const hoverProvider = vscode.languages.registerHoverProvider(
    { language: 'cmm' },
    new CmmHoverProvider()
  );
  context.subscriptions.push(hoverProvider);

  // 拉线拖拽：Alt+Up/Down带子树整体移动，Alt+Left/Right带子树调整indent
  const moveUpCmd = vscode.commands.registerTextEditorCommand(
    'cmm.moveSubtreeUp',
    () => moveSubtreeUp()
  );
  const moveDownCmd = vscode.commands.registerTextEditorCommand(
    'cmm.moveSubtreeDown',
    () => moveSubtreeDown()
  );
  const indentRightCmd = vscode.commands.registerTextEditorCommand(
    'cmm.indentSubtreeRight',
    () => indentSubtreeRight()
  );
  const indentLeftCmd = vscode.commands.registerTextEditorCommand(
    'cmm.indentSubtreeLeft',
    () => indentSubtreeLeft()
  );
  context.subscriptions.push(moveUpCmd, moveDownCmd, indentRightCmd, indentLeftCmd);

  // 选中子树
  const selectCmd = vscode.commands.registerTextEditorCommand(
    'cmm.selectSubtree',
    () => selectSubtree()
  );
  context.subscriptions.push(selectCmd);

  // 选中整行时自动扩展到子树：拖拽就带子树走
  autoExpandSelectionToSubtree(context);

  // .cmmignore 解析和文件过滤
  const cmmIgnore = new CmmIgnore();
  context.subscriptions.push({ dispose: () => { cmmIgnore.dispose(); } });

  // 目录树嵌套: 读取cmm文件里的@引用, 自动让被引用的cmm文件折叠到父文件下面
  const fileNesting = new CmmFileNesting(cmmIgnore);
  fileNesting.activate();
  // deactivate 时清掉我们写的 pattern
  context.subscriptions.push({
    dispose: () => { fileNesting.dispose(); }
  });

  // CMM Explorer侧边栏: TreeView自定义树视图, 支持无限递归嵌套
  const cmmExplorer = new CmmExplorer(cmmIgnore);
  const treeView = vscode.window.createTreeView('cmmExplorer', {
    treeDataProvider: cmmExplorer,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push({ dispose: () => { cmmExplorer.dispose(); } });

  // 右键菜单: Add to .cmmignore / Add to .gitignore
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.addToCmmignore', (node: CmmFileNode) => {
      appendToIgnoreFile('.cmmignore', node.relativePath);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.addToGitignore', (node: CmmFileNode) => {
      appendToIgnoreFile('.gitignore', node.relativePath);
    }),
  );

  // 右键菜单: Open to the Side
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.openToSide', (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const absPath = path.join(folders[0].uri.fsPath, node.relativePath);
      vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(doc => {
        vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
      });
    }),
  );

  // 右键菜单: Copy Path
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.copyPath', (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const absPath = path.join(folders[0].uri.fsPath, node.relativePath);
      vscode.env.clipboard.writeText(absPath);
      vscode.window.showInformationMessage(`已复制: ${absPath}`);
    }),
  );

  // 右键菜单: Copy Relative Path
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.copyRelativePath', (node: CmmFileNode) => {
      vscode.env.clipboard.writeText(node.relativePath);
      vscode.window.showInformationMessage(`已复制: ${node.relativePath}`);
    }),
  );

  // 右键菜单: Reveal in File Explorer (系统文件管理器)
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.revealInFileExplorer', (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const absPath = path.join(folders[0].uri.fsPath, node.relativePath);
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(absPath));
    }),
  );

  // 右键菜单: Reveal in VSCode Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.revealInVSCodeExplorer', (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const absPath = path.join(folders[0].uri.fsPath, node.relativePath);
      vscode.commands.executeCommand('workbench.files.action.showActiveFileInExplorer', vscode.Uri.file(absPath));
    }),
  );

  // 右键菜单: Open Containing Folder (系统文件管理器打开所在目录)
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.openContainingFolder', (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const dir = node.refType === 'directory'
        ? path.join(folders[0].uri.fsPath, node.relativePath)
        : path.dirname(path.join(folders[0].uri.fsPath, node.relativePath));
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),
  );

  // 右键菜单: Rename
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.renameFile', async (node: CmmFileNode) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      const oldAbsPath = path.join(folders[0].uri.fsPath, node.relativePath);
      const newName = await vscode.window.showInputBox({
        prompt: `重命名 ${node.relativePath}`,
        value: node.label,
      });
      if (!newName || newName === node.label) { return; }
      const dir = path.dirname(oldAbsPath);
      const newAbsPath = path.join(dir, newName);
      try {
        fs.renameSync(oldAbsPath, newAbsPath);
        vscode.window.showInformationMessage(`已重命名为 ${newName}`);
      } catch (err) {
        vscode.window.showErrorMessage(`重命名失败: ${err}`);
      }
    }),
  );

  // 思维导图预览
  const previewProvider = new CmmPreviewProvider();
  context.subscriptions.push(
    vscode.commands.registerCommand('cmm.showPreview', () => previewProvider.showPreview(true)),
    vscode.commands.registerCommand('cmm.showPreviewToSide', () => previewProvider.showPreviewToSide()),
    vscode.workspace.onDidChangeTextDocument(e => previewProvider.onDocumentChanged(e.document)),
    { dispose: () => previewProvider.dispose() },
  );
}

/**
 * 把一个相对路径追加到 workspace 根目录的 ignore 文件.
 * 文件不存在则创建, 已有同名行则跳过.
 */
function appendToIgnoreFile(ignoreFileName: string, relativePath: string): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return; }

  const filePath = path.join(folders[0].uri.fsPath, ignoreFileName);
  const line = relativePath.endsWith('/') ? relativePath : relativePath;

  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
    // 已存在相同行则跳过
    if (content.split('\n').some(l => l.trim() === line)) {
      vscode.window.showInformationMessage(`${line} 已在 ${ignoreFileName} 中`);
      return;
    }
    // 确保末尾有换行
    if (!content.endsWith('\n')) {
      content += '\n';
    }
  }

  fs.writeFileSync(filePath, content + line + '\n', 'utf-8');
  vscode.window.showInformationMessage(`已添加 ${line} 到 ${ignoreFileName}`);
  // 打开 ignore 文件让用户看到
  vscode.workspace.openTextDocument(filePath).then(doc => {
    vscode.window.showTextDocument(doc, { preserveFocus: true });
  });
}

export function deactivate() {}
