# cmm-editor-support

## 项目结构
- `vscode/test.cmm.md` 是本项目的主 cmm（项目级cmm），不是测试文件
- `vscode/cmm/` 下是子 cmm，按主题拆分的深入讨论
- `cmm紧凑思维导图/` 是 Claude Code skill 文件

## cmm 文件关系
- `test.cmm.md` = 主 cmm，功能全景 + 状态追踪
- 子 cmm 用 @语法从 test.cmm.md 引用
- `cmm/cmm编辑器支持.cmm.md` 是老版本主 cmm，内容已合并进 test.cmm.md，待清理

## 开发流程
- 改完代码要重新打包安装: `cd vscode && npm run compile && npx vsce package --allow-missing-repository && code --install-extension cmm-editor-support-0.1.0.vsix`
