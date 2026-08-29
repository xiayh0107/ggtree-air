# ggtree-air

> **把系统发育树交给任意 Agent：它负责读数据、画图、打开节点画布，并持续处理你的点选、框选、涂鸦和文字修改，直到你满意。**

## 一句话开始

在存放树和关联数据的目录里打开你习惯的 Agent（Pi、Claude Code、Codex、OpenCode 等），复制这一句话：

```text
使用 ggtree-air 内置的 ggtree-phylo skill，读取当前目录里的树和关联数据，生成并打开节点式工作流；随后保持等待画布中的 Action，逐条修改、预览并提交真实产物，直到我说满意。
```

如果 Agent 没有自动加载 Skill，可以显式说：

```text
/skill:ggtree-phylo 完成当前目录的系统发育树可视化，并持续处理画布反馈直到我满意。
```

**用户不需要选择端口、记命令、写 R、理解 ggtree API，或者管理 revision。**

---

## 它是什么

ggtree-air 是一个让人和 Agent 围绕科研图片协作的节点画布。

```text
原始产物
   ↓
“配色太抢眼，缩小右侧色块”
   ↓
Agent 读取 Skill、数据、原图和选区
   ↓
新产物
```

画布上只有两类内容：

- **Artifact**：真实图片或文件；
- **Action**：用户的原话和可选视觉选区。

程序本身不内置模型，也不假装理解绘图需求。任何外部 Agent 都可以加载包内的标准 Skill，处理同一套 Action/Artifact 协议。

## 用户如何使用

### 1. 让 Agent 创建第一版

你只需要描述目标：

```text
把这个目录里的树和 metadata 做成适合论文的图，自动选择合理布局并打开给我看。
```

Agent 会负责：

- 找到 Newick/NEXUS/PhyloXML、距离矩阵或 FASTA；
- 识别匹配的 metadata；
- 调用 R/ggtree 生成第一版；
- 打开浏览器节点画布；
- 保持连接，等待你的下一条 Action。

### 2. 在产物旁直接说怎么改

点击产物节点的“修改”，输入一句话：

```text
配色柔和一点。
色块太大，缩小一些。
标签挤在一起了，重新安排间距。
把这个 clade 突出，但不要遮住 support。
```

发送后会创建一个 Action 节点。正在等待的 Agent 会自动收到它。

### 3. 需要时再标注

普通修改只需要一句话。

只有需要指出局部位置时才点击标注按钮：

```text
点选 | 框选 | 画笔
```

标注只是上下文附件；“怎么改”仍由自然语言表达。

### 4. 明确要求多个候选

默认一次 Action 只产生一个真正变化的产物。

当你明确说：

```text
试三个不同风格的配色。
分别给我一个保守版和一个展示版。
比较有标签和无标签两种方案。
```

同一个 Action 可以连接多个候选 Artifact：

```text
Action
 ├─ Candidate A
 ├─ Candidate B
 └─ Candidate C
```

### 5. 继续修改直到满意

从任意候选产物继续输入要求即可自然形成分支。旧产物不会被覆盖。

---

## Agent 工作时用户能看到什么

Action 节点会原地显示：

- 哪个 Agent 接收了任务；
- 当前阶段；
- 人类可读的进度文字；
- 进度条；
- 最近的执行步骤；
- 候选图片预览；
- 完成、失败或等待状态。

示例：

```text
正在检查源图和标注区域        15%
正在调整配色和图例层级        45%
已生成候选，正在检查重叠      75%
已提交 2 个产物              100%
```

如果没有 Agent 正在连接，Action 会诚实显示“等待 Agent”，不会生成假的结果。

---

## 为什么任何 Agent 都能使用

安装包直接包含：

```text
ggtree-air/
├── skills/ggtree-phylo/   # 标准 Agent Skill
├── frontend/              # 人机协作画布
├── renderer/r/            # ggtree 科学绘图能力
├── backend/               # 中立 Action/Artifact 协议
└── examples/              # 可复现案例
```

Skill 使用普通文件和 CLI 协议，不绑定特定模型厂商或 Agent SDK。

支持 Skill 自动发现的 Agent 可以直接加载包内 Skill；其他 Agent 可以获取 Skill 路径或安装到自己的 Skill 目录。

---

## 内置真实案例

案例数据来自固定 commit，并校验 SHA-256：

- **mammal-traits**：营养类型、体重和关联数据；
- **candida-auris**：抗真菌耐药和靶点突变；
- **hmp-microbiome**：334 tips、14 phyla、7 个身体部位轨道；
- **hpv58**：90 个完整基因组、8 个 lineage 和序列距离。

你可以直接对 Agent 说：

```text
用 hmp-microbiome 案例创建工作流并打开给我看，然后继续等待我的修改。
```

---

## 安装

当前开发版本可以从源码安装：

```bash
npm install -g ./dist/ggtree-air-0.5.0.tgz
ggtree-air setup-r --with-recipes
ggtree-air skills install ggtree-phylo --agent pi --force
```

公开 npm/GitHub Release 的分发说明见 [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)。

---

<details>
<summary><strong>给 Agent 和集成开发者的协议入口</strong></summary>

### 创建并打开工作区

```bash
ggtree-air auto --input tree.nwk --metadata traits.csv --out results/tree
ggtree-air open --workspace results/tree
```

### 打开前端后保持等待

Agent 不应结束回合并要求用户回来手动通知，而应阻塞等待浏览器 Action：

```bash
ggtree-air actions wait \
  --workspace results/tree \
  --agent my-agent \
  --timeout 3600
```

浏览器提交后，命令立即返回并原子 claim 该 Action。

### 流式进度

```bash
ggtree-air actions running <id> --workspace results/tree --agent my-agent

ggtree-air actions progress <id> \
  --workspace results/tree \
  --agent my-agent \
  --phase preview \
  --percent 75 \
  --message "候选已生成，正在检查标签重叠" \
  --preview candidate.png
```

### 提交一个或多个真实产物

```bash
ggtree-air artifacts commit <id> \
  --workspace results/tree \
  --agent my-agent \
  --file candidate-a.png \
  --file candidate-b.png
```

### 失败时诚实返回

```bash
ggtree-air actions fail <id> \
  --workspace results/tree \
  --message "无法从现有数据支持该修改"
```

### Skill

```bash
ggtree-air skills list
ggtree-air skills path
ggtree-air skills install ggtree-phylo --agent pi --force
```

Action/API Schema 位于 [`docs/schemas/`](docs/schemas/)。

</details>

---

## 科学边界

- NJ 默认是无根树，除非有明确 outgroup；
- branch length 代表输入距离，而不自动代表时间；
- 配色和 clade 标签是注释，不是统计证据；
- 有 bootstrap/posterior 时应展示支持度；
- topology 改变后必须重新验证 node id；
- FASTA/多序列比对质量决定下游树的可信度。

详细说明见 [`skills/ggtree-phylo/references/interpretation-guide.md`](skills/ggtree-phylo/references/interpretation-guide.md)。

## 开发状态

- 当前版本：`v0.5.0`
- 测试：Node、R、Playwright 全部通过
- npm audit：0 vulnerabilities
- 状态与边界：[`docs/STATUS.md`](docs/STATUS.md)
- 分发：[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)
