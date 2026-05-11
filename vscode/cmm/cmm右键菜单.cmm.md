## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

cmm右键菜单
  ✓现状
    CMM Explorer侧边栏里右键文件只有两个自定义菜单项
      Add to .cmmignore
      Add to .gitignore
    缺少原生文件管理器常见的操作: 开到侧边、复制路径、在系统文件管理器里显示等
  ✓右键菜单项(全部已实现)
    ✓Open to the Side
      在侧边编辑器打开文件(split editor)
      菜单分组: navigation，仅文件类型显示(when viewItem =~ /cmmFile/)
    ✓Copy Path
      复制绝对路径到剪贴板
    ✓Copy Relative Path
      复制workspace相对路径到剪贴板
    ✓Reveal in File Explorer
      在系统文件管理器(Nautilus/Finder/Explorer)里定位到文件
    ✓Reveal in VSCode Explorer
      在VSCode内置文件浏览器里选中并高亮该文件
    ✓Open Containing Folder
      系统文件管理器打开文件所在目录
    ✓Add to .cmmignore / Add to .gitignore
      菜单分组: 1_modification
    ✓Rename
      弹出输入框重命名文件，菜单分组: 1_modification
  ✓实现
    自注册命令，不依赖VSCode内置explorer命令(内置命令when clause绑死explorer view)
    extension.ts注册8个命令(2个ignore + openToSide + copyPath + copyRelativePath + revealInExplorer + revealInVSCodeExplorer + openContainingFolder + renameFile)
    package.json commands加8个，menus.view/item/context加8个
    菜单分组: navigation / 1_modification / 2_utilities
    cmmExplorer.ts的resourceUri修成绝对路径(Uri.file)，command也改为直接用resourceUri
  blast radius
    cmmExplorer.ts: resourceUri从Uri.parse改Uri.file，onDidChangeTextDocument→onDidSaveTextDocument
    fileNesting.ts: onDidChangeTextDocument→onDidSaveTextDocument
    extension.ts: 新增7个命令 + DefinitionProvider注册
    providers/definition.ts: 新文件，@引用Ctrl+Click跳转
    package.json: commands加7个+Rename，menus加8个条目
    README.md: 右键菜单说明更新
    test.cmm.md: 右键菜单引用更新，加@引用跳转条目
