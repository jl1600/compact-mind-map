## !! 编辑规则
  `*` 开头的用户批注是不可删除的，改写任何段落时必须保留所有 `*` 批注
  已解决的批注改为 `✓` 开头并附解决方式，不删除
  新增的批注同样以 `*` 开头
  使用@语法引用其他源, 若需编辑, 在source of truth处编辑
  单文件层深控制在4-7层内，超出部分用@语法引用, 如用@文件名关联子cmm, 或其他@语法

跨仓库cmm引用
  背景
    团队开始adopt cmm了，多人多项目多机器
    当前@引用只支持workspace内相对路径，不够用了
    需要一个方案让不同仓库、不同机器上的cmm文件能互相引用
  现状
    @引用语法: @文件名.cmm.md 或 @目录/ 或 @概念名
    解析方式: 插件扫描workspace内所有*.cmm.md，正则提取@引用，按相对路径匹配
    范围: 仅限当前VSCode workspace内
  当前目标: 团队级跨仓库引用
    多人多项目，同团队内cmm互相引用
    场景: A项目的架构决策被B项目复用，C项目的API设计参考D项目
  方案: 直接路径引用 + 按需HTTP拉取
    语法
      @file.cmm.md → 本地文件引用(现有行为，不变)
      @host/namespace/repo/file.cmm.md → 远程引用，直接指定git仓库路径
      示例: @gitlab.example.com/team/awesome-project/ARCHITECTURE.cmm.md
    解析机制
      插件看@后面第一段是不是IP或域名区分本地/远程
      远程引用解析: host=girblab.example.com, repo=team/awesome-project, file=ARCHITECTURE.cmm.md
      分支: 默认main/master，可选指定 @host/ns/repo/file@branch
    按需拉取(agentic retrieve on need)
      不提前clone任何东西，用户hover/点击远程@引用时才拉取
      GitLab raw文件API: http://{host}/{namespace}/{repo}/-/raw/{branch}/{file}
      GitHub raw文件API: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file}
      单次HTTP GET拿到文件内容，不需要git，不需要磁盘缓存
      首次hover可能慢几百毫秒，session内缓存避免重复请求
    权限
      私有仓库需要token: 插件设置里配置GitLab/GitHub personal access token
      引用了看不到的cmm → 显示"无法访问: host/ns/repo/file (权限不足或不存在)"
  全域全模态
    cmm的indent结构不绑定内容格式，现在文字是起点，后续可扩展
    模态扩展
      靠后缀管理: 插件看@引用的文件后缀决定渲染方式
      .cmm.md → cmm节点树
      .node → 图谱节点(实体/概念)
      .edge → 图谱关系(实体间的连线)
      .png/.jpg → 图片预览
      .py/.ts → 代码高亮
      .drawio → 图表内联渲染
      .mp4 → 视频封面帧+播放
    挑战
      git对二进制不友好 → agentic retrieve解决: 二进制不存git，@引用URL按需拉取，git里只有一行文本
      全模态搜索: 图片OCR / 视频字幕 / 代码AST
  版本管理
    默认拉最新
    可选锁版本: @host/ns/repo/file.cmm.md@v1.2
    类似package-lock.json，可选cmm-lock.json记录精确commit hash
  演化阶段
    阶段0(当前): workspace内@引用，个人项目级
      @ARCHITECTURE.cmm.md 引用同目录下的文件
    阶段1: 远程引用(@host/ns/repo/file)，跨仓库跨团队
      @gitlab.example.com/team/project/ARCHITECTURE.cmm.md 引用别的仓库的cmm
    阶段2: 语义引用(@概念名搜所有可达cmm，聚合context)
      @REST API设计规范 没后缀→搜所有可达cmm仓库里提到这个概念的地方→聚合context呈现
    阶段3: 引用网络效应(像网页超链接一样自发传播)
      插件分析所有可达cmm的@引用关系，构建引用图谱
      哪个cmm被引用最多=最重要(PageRank)，推荐给用户
      用户顺着@引用链发现新知识: 看A→发现A@B→点进去看B→发现B@C→链式探索
    阶段4: 全模态知识网络(文字+图片+代码+视频统一组织)
      单个cmm节点下混合多模态引用:
        REST API设计
          @api-spec.cmm.md 基本设计
          @sequence.drawio 时序图
          @server.py:50-80 核心实现
          @demo.mp4 接口演示
