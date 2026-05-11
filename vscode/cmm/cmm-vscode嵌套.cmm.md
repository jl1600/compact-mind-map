## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

cmm-vscode嵌套
  想要的效果
    根cmm在VSCode目录树里像文件夹，展开看到它@引用的子cmm
    子cmm展开看到子cmm自己@引用的孙cmm，层层递归
    @引用关系就是唯一的真相源，不搞第二套组织方式
    支持回环/互相引用: A@B且B@A，两边都能看到对方
  现有基础 @cmm编辑器支持.cmm.md
    已有功能: folding折叠、hover路径预览、子树拖拽移动、stickyScroll
    语言ID: cmm，文件名匹配: *cmm*
    入口: src/extension.ts，activate时注册provider和命令
    解析器: src/utils/parseTree.ts，按indent解析cmm结构
    在这个插件上直接加，不另起新插件
  实现思路: 插件读@引用驱动file nesting ✓已实现
    VSCode的file nesting是settings里的配置，pattern按文件名匹配
    插件负责：扫描cmm文件里的@引用 → 自动更新explorer.fileNesting.patterns
    不用改名，不用手动配，@写什么文件就嵌套什么文件
  已完成的工作 ✓
    新建 src/features/fileNesting.ts (CmmFileNesting类)
      activate时扫描workspace所有*.cmm.md
      正则提取 @xxx.cmm.md 文件引用（不碰 @概念名 概念引用）
      写入 explorer.fileNesting.patterns，只管自己写的key不动用户手动配的
      防抖500ms，监听文件编辑/创建/删除自动刷新
      deactivate时清掉自己写的pattern
      Proxy对象bug修复 ✓ config.get()返回Proxy不能直接delete, 先{...}拷贝再操作
    修改 src/extension.ts 引入并启动 CmmFileNesting
    编译通过，打包vsix安装成功
  测试结果 ✓一层生效，递归未生效
    cmm_图谱平台.cmm.md 展开能看到4个子文件：实体索引/实体问题连线/问题索引/章节索引
    实体问题连线.cmm.md 虽然有pattern（@了3个孙文件），但展不开
    原因: VSCode file nesting硬限制 — 已被嵌套的子文件不能再当父展开自己的子文件
    只支持一层递归：只有顶层（未被嵌套）的文件才能展开子文件
  README.md冲突 ✓已解决
    原settings里 "README.md": "*.md" 把所有md都吃掉了，cmm pattern没机会生效
    改为 "README.md": "LICENSE, CODEOWNERS" 排除*.md
  递归嵌套: TreeView自定义侧边栏 ✓方案确认并实现中
    决定绕开原生file nesting，用VSCode TreeView API自己画树
    现有fileNesting.ts保留给不想用侧边栏的场景，两套并存不冲突
    侧边栏视图名: CMM Explorer，放在活动栏（左侧图标面板）
    树的层级完全由@引用关系驱动，无限递归
    点击文件节点打开对应cmm文件
    点击目录节点（非叶cmm）展开/折叠子节点
    初始状态: 所有cmm文件都展示为根节点 ✓
      原设计是只展示未被@引用的文件作为根，但回环场景(互相引用)会导致所有文件都被过滤掉变成空树
      改为: 所有cmm文件都展示为根，@引用关系决定每个根下面的子节点
      这样A@B且B@A时，A和B都出现在根列表，各自展开能看到对方
    文件监听: 复用fileNesting.ts已有的文件变更监听逻辑
      cmm文件内容变更→重新解析@引用→刷新树
      cmm文件创建/删除→刷新树
    数据来源: 扫描workspace所有*.cmm.md，提取@引用关系
      引用提取: 扩展正则，不只匹配.cmm.md，还匹配任意文件路径和目录
        核心是支持 .cmm.md文件 + 目录/ 两种，其余文件类型靠正则自然覆盖
        正则设计成可扩展的，后续加新类型改一处就行
        不展示 @概念名（不带文件扩展名和/后缀的纯概念引用）
      同名文件处理: 沿用fileNesting.ts的findClosestPath逻辑，自动选路径最近的
        后续如果需要严格模式再加重名检测
    实现位置 ✓已完成初版
      新建 src/features/cmmExplorer.ts (CmmExplorer类)
        实现vscode.TreeDataProvider接口: getTreeItem / getChildren
        CmmFileNode树节点: 路径/名称/类型(cmm/directory/file)
        @引用扫描: REFERENCE_REGEX正则 + resolveReference解析 + findClosestPath消歧
        文件监听: onDidChangeTextDocument + createFileSystemWatcher + onDidChangeWorkspaceFolders
        防抖500ms刷新
      修改 package.json
        新增 viewsContainers.activitybar: cmm-explorer容器, icon指向media/icon.svg
        新增 views.cmm-explorer: cmmExplorer视图
        activationEvents新增 onView:cmmExplorer
      修改 src/extension.ts
        activate里 new CmmExplorer() + window.createTreeView('cmmExplorer', ...)
    树节点设计 ✓
      CmmFileNode: 代表一个被@引用的实体
        属性: 路径、名称、类型（cmm文件/目录/其他文件）
        可展开: cmm文件看有无@引用子节点，目录天然可展开，其他文件不可
        icon: 按类型用VSCode内置图标（文件夹图标/文件图标/cmm用file-symlink-file）
        点击行为: 打开文件(vscode.open command)
      collapsibleState: 有子节点时Collapsed(可展开)，叶子None
    活动栏图标 ✓
      初版用了codicon语法 $(file-symlink-file) 但activity bar不支持codicon
      改为 media/icon.svg (缩进树形SVG, 节点从左上到右下递进, 颜色渐变)
    与现有功能的关系
      fileNesting.ts继续工作，原生目录树里还展示一层嵌套（只管.cmm.md）
      CMM Explorer侧边栏是额外入口，展示全部@引用
      两套数据来源不同: fileNesting只管.cmm.md，Explorer管全部
    测试用例 ✓已创建在 vscode/test/
      A-架构总览.cmm.md: 根节点, @B和C
      B-数据模型.cmm.md: 被@引用, 同时@回A(互相引用), 也@D
      C-API设计.cmm.md: 被@引用, @B和D
      D-公共工具.cmm.md: 叶子, 被B和C同时@引用
      覆盖场景: 回环(A↔B), 菱形汇聚(A→C→B 和 A→B), 共享叶子(D)
    项目文件与cmm的满射关系
      README.md ✓已创建, @引用@cmm编辑器支持.cmm.md
        包含: 功能表格/安装步骤/开发指南/项目结构
        以后每个新增功能/模块都要同步更新README对应行
      .gitignore: out/加回, 用户自行编译, 不入库编译产物
      media/icon.svg: 活动栏图标资源
      .vscode/settings.json: VSCode工作区配置
    pycharm/ 占位
      当前是空目录（只有.gitkeep），PyCharm插件还没开始
      VSCode侧的TreeView方案做完后，PyCharm侧同理可实现
      PyCharm侧需要实现的功能应与VSCode侧保持对等:
        cmm语言识别/缩进折叠/hover路径预览/拉线拖拽/CMM Explorer树视图
      具体方案待定(可能用PyCharm Plugin SDK或外部工具集成)
  待验证 *
    Reload Window后侧边栏是否显示test/下的A/B/C/D四个文件
    展开A是否能看到B和C
    展开B是否能看到A(回环)和D
    展开C是否能看到B和D
    D是否为叶子(无展开箭头)
