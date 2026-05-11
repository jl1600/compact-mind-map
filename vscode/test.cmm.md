## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

cmm编辑器支持
  背景
    cmm格式是纯文本indent，目前没有任何编辑器增强，全靠肉眼读缩进
    团队有人用VSCode有人用PyCharm，不能绑死单一编辑器
  编辑增强
    rainbow缩进
      ✅ 已实现(rainbowIndent.ts)，不同层级缩进用不同颜色显示
    缩进折叠
      ✅ 按indent层级折叠/展开，规则是indent而不是花括号
    indent sticky scroll
      ✅ 不需要额外provider，内置sticky scroll基于folding range自动生效，已默认开启
    路径预览
      ✅ hover任意位置（含缩进空白区）显示根到当前节点路径
      鼠标悬停或选中节点时，显示从根到当前节点的完整路径
      在深层嵌套中不迷失上下文
    @引用跳转(Go to Definition)
      ✅ Ctrl+Click 或 F12 在 @xxx.cmm.md 上跳转到被引用文件
      支持相对路径、文件名匹配、当前文件目录下搜索
      providers/definition.ts
    拉线（全文缩进调整）
      ✅ 四方向快捷键完成
      Alt+Up/Down：子树整体上下移动（全文分割拼合，无多余换行和重复文本）
      Alt+Left/Right：子树整体加减indent
      所有方向执行后选中整棵子树，光标落在首行有字处
      禁用了VSCode内置的Alt+方向键避免冲突
      suppressNext()防止autoExpand二次干扰selection
      选中整行自动扩展到子树（autoExpand.ts），拖拽带子树走
      Ctrl+L手动选中子树
    冻结
      已确认的内容冻结保护
      类似Excel冻结窗格：冻结的行一直钉在上方或侧面，不随滚动消失
    tab自动补全
      tab键不只做缩进，还根据上下文补全节点内容
    cmm ignore @cmm-ignore.cmm.md
      ✅ .cmmignore文件: gitignore语法忽略不需要的cmm文件
      也支持settings.json里配cmm.ignorePatterns
      默认忽略node_modules/.git/out/dist/build
      CMM Explorer右键菜单: Add to .cmmignore / Add to .gitignore
      ✓右键菜单已扩展 @cmm右键菜单.cmm.md
        Open to the Side / Rename / Copy Path / Copy Relative Path / Reveal in File Explorer / Reveal in Explorer View / Open Containing Folder
      性能: onDidSaveTextDocument替代onDidChangeTextDocument，避免每次按键全量扫描
    CMM Explorer侧边栏 @cmm-vscode嵌套.cmm.md
      ✅ TreeView自定义视图, 绕开原生file nesting的一层限制
      支持递归嵌套和回环(互相引用)
      所有cmm文件按字典序排列
  高级交互
    模糊control
      每个词都是节点
      可以拖拽调整位置/层级
      也可以规范输入（structured input）
      也可以整理（reorganize）
      选择式拖拉拽：选中文本，解析选中的信息点/组→拖到目标位置→放下完成移动/重组
    导向选择
      用户思路导向：按用户当前思考方向组织
      社区自组织导向：按社区/算法自动聚合
  代码仓库
    独立仓库 /home/lgl/github_repos/cmm-editor-support
    README.md: 项目说明, @引用本cmm文件, 功能表格/安装/开发/结构
    vscode/ 目录：VSCode插件源码(编译产物不入库, 用户自行npm run compile)
      cmm/ : 设计讨论cmm文件(本项目级+子cmm)
      test/ : 测试用例cmm文件
      media/ : 图标资源
    pycharm/ 目录：空的(.gitkeep占位), PyCharm插件待开发
  跨仓库cmm引用 @跨仓库cmm引用.cmm.md
    部门adopt cmm后，需要跨仓库/跨机器引用方案
    规模层级: 个人→部门→公司→跨公司→全球
    具体方案在子cmm里讨论
