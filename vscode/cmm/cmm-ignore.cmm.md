## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

cmm ignore
  背景
    插件用 findFiles('**/*.cmm.md') 扫workspace内所有cmm文件
    没有任何过滤/忽略机制，所有.cmm.md无差别展示
    用户打开了不属于cmm系统的.cmm.md文件(测试文件、临时文件、其他工具的markdown碰巧以.cmm.md结尾)，全部刷出来
    CMM Explorer侧边栏和file nesting都受影响
  ✓需求
    用户能指定哪些文件/目录不参与cmm插件的扫描和展示
    不只是Explorer侧边栏，所有cmm功能(folding/hover/快捷键)都应尊重ignore规则
  ✓方案: .cmmignore文件
    放workspace根目录，语法和.gitignore一致
    每行一个pattern，支持glob语法: *、**、!
    空行和#注释行跳过
    默认内置忽略规则(用户没写.cmmignore时也生效)
      node_modules/
      .git/
      out/、dist/、build/
    示例 .cmmignore
      # 测试文件
      test/
      *.test.cmm.md
      # 临时笔记
      tmp/**
      # 取消忽略(和.gitignore一样!)
      !tmp/important.cmm.md
  ✓实现
    ✓新增 src/features/cmmIgnore.ts
      CmmIgnore类: 解析.cmmignore + settings + 默认规则
      isIgnored(relativePath): 逐条匹配rule列表，最后匹配的决定结果(和gitignore语义一致)
      globToRegexStr(): 逐字符把glob转正则，处理*、**、**/、?和正则特殊字符转义
      watch(): 监听.cmmignore文件变化和cmm settings变化，自动reload
      pattern来源优先级(低→高): 默认忽略 → settings → .cmmignore文件
    ✓cmmExplorer.ts改动
      构造函数接收CmmIgnore实例
      refreshData()里findFiles后用isIgnored过滤
      加cmmIgnore.onDidChange监听触发刷新
    ✓fileNesting.ts改动
      构造函数接收CmmIgnore实例
      refresh()里findFiles后用isIgnored过滤
      加cmmIgnore.onDidChange监听触发刷新
    ✓extension.ts改动
      创建CmmIgnore实例，传给CmmFileNesting和CmmExplorer
    ✓package.json改动
      contributes.configuration加cmm.ignorePatterns(string[])和cmm.useDefaultIgnore(boolean)
    ✓README.md改动
      功能表格加ignore行
      安装后面加.cmmignore使用说明
  ✓右键菜单
    ✓package.json
      commands加cmm.addToCmmignore和cmm.addToGitignore
      menus.view/item/context加两个命令，when=view==cmmExplorer
    ✓cmmExplorer.ts
      CmmFileNode改为export
      getTreeItem()里设contextValue=cmmFile/cmmDir控制菜单显示
    ✓extension.ts
      注册cmm.addToCmmignore和cmm.addToGitignore命令
      appendToIgnoreFile(): 追加路径到ignore文件，已有则跳过，追加后打开文件让用户确认
  blast radius
    新增 src/features/cmmIgnore.ts → cmmExplorer.ts和fileNesting.ts依赖
    cmmExplorer.ts: 构造函数签名变(加CmmIgnore参数)，导出CmmFileNode → extension.ts注册命令依赖
    fileNesting.ts: 构造函数签名变(加CmmIgnore参数) → extension.ts调用处同步
    extension.ts: import加CmmIgnore和CmmFileNode，新增addToCmmignore/addToGitignore命令注册
    package.json: commands加2个，menus加1个section，configuration加2个属性
    README.md: 功能表格+使用说明
    cmm编辑器支持.cmm.md: 编辑增强加ignore条目
