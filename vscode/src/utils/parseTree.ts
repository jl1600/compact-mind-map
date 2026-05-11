/**
 * parseTree - 把cmm文件的缩进结构解析成树.
 *
 * cmm文件里每一行要么是空行要么是节点, 节点的层级由前导空格的缩进决定.
 * 这个解析器把所有行解析成 CmmNode 数组, 每个节点知道自己的层级、文本、子树范围.
 *
 * 后续所有功能（折叠、hover路径、拖拽子树）都依赖这个解析结果.
 *
 * indent层级计算: 空格数 / 2 (cmm标准是每层2空格)
 * 比如 "    foo" 是2个空格 = 层级1, "      bar" 是6个空格 = 层级3
 */

// cmm节点: 文件里一行非空内容就是一个节点
export interface CmmNode {
  // 这一行的行号, 0-based (和vscode.TextDocument.lineAt一致)
  lineIndex: number;
  // 缩进层级: 空格数 / 2. 根节点(无缩进)=0
  indent: number;
  // 这一行的文本内容（去掉前导空格后的）
  text: string;
  // 子树范围: 从本行到子树最后一行（含）的行号范围
  subtreeEnd: number;
}

/**
 * 解析整个文档的cmm结构.
 *
 * @param lines 文档所有行的文本数组（不含换行符）
 * @returns CmmNode数组, 每个非空行对应一个节点
 *
 * 用法:
 *   const nodes = parseCmmTree(document.getText().split('\n'));
 *   // nodes[0] 是第一个非空行
 *   // nodes[0].subtreeEnd 告诉你它的子树到哪一行结束
 */
export function parseCmmTree(lines: string[]): CmmNode[] {
  const nodes: CmmNode[] = [];

  // 第一遍: 解析每一行, 计算indent和text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 空行跳过, 不算节点
    if (line.trim().length === 0) continue;

    // indent = 前导空格数 / 2
    // 用 firstNonWhitespaceCharacterIndex 比自己数空格靠谱
    const indent = Math.floor(line.search(/\S|$/) / 2);
    const text = line.trim();

    nodes.push({ lineIndex: i, indent, text, subtreeEnd: i });
  }

  // 第二遍: 计算每个节点的 subtreeEnd
  // subtreeEnd = 从当前节点往下, 直到遇到同级或更浅缩进的节点为止
  // 也就是说 subtreeEnd 包含当前节点 + 所有缩进更深的连续子节点
  for (let i = 0; i < nodes.length; i++) {
    let end = nodes[i].lineIndex;
    for (let j = i + 1; j < nodes.length; j++) {
      // 子节点的indent必须严格大于当前节点
      if (nodes[j].indent <= nodes[i].indent) break;
      end = nodes[j].lineIndex;
    }
    nodes[i].subtreeEnd = end;
  }

  return nodes;
}

/**
 * 根据行号找对应的CmmNode.
 *
 * @param nodes parseCmmTree的输出
 * @param lineIndex 行号(0-based)
 * @returns 对应的CmmNode, 如果该行是空行或不存在则返回undefined
 */
export function findNodeAtLine(nodes: CmmNode[], lineIndex: number): CmmNode | undefined {
  return nodes.find(n => n.lineIndex === lineIndex);
}

/**
 * 获取从根到指定节点的路径.
 *
 * @param nodes parseCmmTree的输出
 * @param lineIndex 行号(0-based)
 * @returns 路径数组, 从根到当前节点, 每个元素是节点的text
 *
 * 用法:
 *   const path = getPathToLine(nodes, 15);
 *   // path = ["图谱平台", "图谱构建", "实体问题连线", "逻辑"]
 */
export function getPathToLine(nodes: CmmNode[], lineIndex: number): CmmNode[] {
  const target = findNodeAtLine(nodes, lineIndex);
  if (!target) return [];

  const path: CmmNode[] = [];
  // 从nodes数组里往回找, 找到所有indent比当前小的祖先
  // 祖先的indent必须严格递减: 父=indent-1, 祖父=indent-2, ...
  let currentIndent = target.indent;

  // 先把目标节点自己加进去
  path.unshift(target);

  // 从目标节点往前遍历, 找祖先
  const targetIdx = nodes.indexOf(target);
  for (let i = targetIdx - 1; i >= 0; i--) {
    // 祖先的indent必须严格小于当前寻找的层级
    // 而且必须是恰好小1（直接父），这样能跳过堂兄弟
    if (nodes[i].indent === currentIndent - 1) {
      path.unshift(nodes[i]);
      currentIndent = nodes[i].indent;
    }
  }

  return path;
}
