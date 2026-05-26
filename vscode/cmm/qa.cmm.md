## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

cmm编辑器支持 QA
  .cmm.md文件语言识别为markdown而非cmm
    现象
      打开.cmm.md文件，右下角语言ID显示markdown而不是cmm
      预览命令不走cmm的preview.ts，走的是VS Code内置Markdown预览
      preview.ts:14的检查 editor.document.languageId !== 'cmm' 拦住了，弹出"CMM Preview is only available for .cmm.md files"
    根因
      VS Code文件类型检测优先匹配最末尾后缀
      .cmm.md以.md结尾，内置Markdown插件抢先认领
      package.json里注册的 extensions: [".cmm", ".cmm.md"] 不够，VS Code只看最后一个后缀
    解决
      在.vscode/settings.json加 files.associations 强制绑定
        "files.associations": { "*.cmm.md": "cmm" }
      这条优先级高于后缀匹配，能覆盖内置Markdown的认领
    教训
      VS Code对双后缀文件(.x.y)只看.y，不看.x
      extensions注册不能解决双后缀冲突，必须配合files.associations
      chain blast radius: 之前只改了package.json的extensions以为够了，漏了VS Code本身的优先级机制
