# cmm-editor-support

CMM (Compact Mind Map) 编辑器增强插件。

@cmm编辑器支持.cmm.md

## 支持的编辑器

- VSCode (`vscode/`) — 已实现
- PyCharm (`pycharm/`) — 占位，尚未开始

## VSCode 插件功能

| 功能 | 状态 | 说明 |
|------|------|------|
| Rainbow 缩进 | ✅ | 不同层级缩进用不同颜色显示 |
| 缩进折叠 | ✅ | 按 indent 层级折叠/展开 |
| Sticky Scroll | ✅ | 基于 folding range 自动生效 |
| 路径预览 (Hover) | ✅ | hover 任意位置显示根到当前节点路径 |
| @引用跳转 (Go to Definition) | ✅ | Ctrl+Click / F12 在 @引用上跳转到目标文件 |
| 拉线拖拽 (Alt+方向键) | ✅ | 子树整体移动/调整缩进 |
| 自动选中子树 | ✅ | 选中整行自动扩展到子树 |
| File Nesting | ✅ | 原生目录树一层嵌套（基于@引用） |
| CMM Explorer 侧边栏 | ✅ | TreeView 自定义视图，支持递归嵌套和回环 |
| 文件忽略 (.cmmignore) | ✅ | gitignore 风格的忽略规则，过滤不需要的 cmm 文件 |
| 右键菜单 | ✅ | Open to Side / Rename / Copy Path / Copy Relative Path / Reveal / Add to ignore |

## 安装（VSCode）

```bash
cd vscode
npm install
npm run compile
npx vsce package --allow-missing-repository
code --install-extension cmm-editor-support-0.1.0.vsix
```

或从 `vscode/` 目录直接按 F5 启动调试。

## cmm skill 软链接

本项目同时维护 cmm 紧凑思维导图的 Claude Code skill 文件。把 skill 链接到 Claude 的 skill 目录即可使用：

```bash
ln -s ~/github_repos/cmm-editor-support/cmm紧凑思维导图 ~/.claude/skills/cmm紧凑思维导图
```

## 文件忽略 (.cmmignore)

在 workspace 根目录创建 `.cmmignore` 文件，用 gitignore 语法忽略不需要的 cmm 文件：

```
# 忽略测试目录
test/
# 忽略特定模式
*.test.cmm.md
# 取消忽略
!important.cmm.md
```

也可以在 VSCode settings 里配置 `cmm.ignorePatterns`，或通过 `cmm.useDefaultIgnore` 关闭内置默认忽略 (node_modules/ 等)。

CMM Explorer 里右键文件可以直接 "Add to .cmmignore" 或 "Add to .gitignore"。

## 开发

```bash
cd vscode
npm run watch    # 监听文件变更自动编译
```

## 项目结构

```
cmm-editor-support/
├── cmm紧凑思维导图/                # Claude Code skill 文件
│   └── SKILL.md
├── vscode/
│   ├── src/
│   │   ├── extension.ts          # 插件入口
│   │   ├── providers/            # Folding / Hover / AutoExpand / RainbowIndent
│   │   ├── commands/             # Alt+方向键 拖拽命令
│   │   ├── features/             # FileNesting / CmmExplorer / CmmIgnore
│   │   └── utils/                # parseTree 解析器
│   ├── cmm/                      # 设计讨论 cmm 文件
│   ├── test/                     # 测试用例 cmm 文件
│   ├── media/                    # 图标资源
│   ├── .vscodeignore             # vsix打包排除规则
│   └── package.json              # 插件清单
├── pycharm/                      # PyCharm 插件（待开发）
└── README.md
```
