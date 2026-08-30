# ggtree-air — Agent 安装与首次使用指南

> 本文是写给 Agent 的。请替用户完成安装、环境检查、Skill 配置和首次工作流，不要把命令转交给用户。不要使用 Context7 或底层 ggtree 文档替代本文；远程私有仓库不可访问时只允许回退到当前 checkout 的本地文档。

## 目标

完成后，用户应该只需要在浏览器画布里查看产物、输入自然语言修改，并在需要时点选、框选或涂鸦。用户不需要管理端口、R 包、CLI 参数或 Action 状态。

## 1. 获取并安装 Runtime

如果当前已经位于 ggtree-air 源码仓库：

```bash
npm ci
npm run pack:runtime
npm install -g ./dist/ggtree-air-*.tgz
```

如果不在源码仓库，且有 GitHub 仓库访问权限：

```bash
npm install -g github:xiayh0107/ggtree-air
```

确认：

```bash
ggtree-air --help
ggtree-air check
```

## 2. 配置 R 科学绘图环境

缺失核心依赖时，由你执行：

```bash
ggtree-air setup-r --with-recipes
```

只有用户提供未对齐 FASTA、确实需要重比对时才使用：

```bash
ggtree-air setup-r --all
```

再次运行 `ggtree-air check`。不要让用户逐个安装 R 包。

## 3. 安装或加载内置 Skill

先查看 canonical Skill：

```bash
ggtree-air skills path
ggtree-air skills list
```

Pi：

```bash
ggtree-air skills install ggtree-phylo --agent pi --force
```

其他 Agent：

```bash
ggtree-air skills install ggtree-phylo --agent claude --force
ggtree-air skills install ggtree-phylo --agent codex --force
ggtree-air skills install ggtree-phylo --agent agents --force
```

不支持这些约定目录时，读取 `ggtree-air skills path` 返回的 `SKILL.md`，或使用 `--target <skill-directory>`。

安装后必须读取完整 Skill，并遵循其中的 Action 消费、进度上报、图形检查和 Artifact 提交协议。

## 4. 创建首次工作流

检查用户当前工作目录，寻找：

- `.nwk` / `.newick` / `.tree` / `.nex` / `.nexus` / `.phyloxml`；
- `.dist` / `.matrix`；
- `.fa` / `.fasta` / `.fna` / `.faa`；
- 与 tip id 匹配的 `.csv` / `.tsv` metadata。

只有存在多个同样可信的生物学输入时才询问用户。否则创建只包含真实输入的任务画布；不要先跑 Recipe 生成无关的 fan/rectangular 产物：

```bash
ggtree-air workspace create \
  --out results/<meaningful-name> \
  --title "<用户的具体任务>"

ggtree-air artifacts import --workspace results/<meaningful-name> \
  --file <reference-figure> --role reference

ggtree-air artifacts import --workspace results/<meaningful-name> \
  --file <tree> --file <metadata> --role user-input
```

Renderer recipes 只用于集成测试，不得包装成用户—Agent 历史。

## 5. 打开画布，不让用户管理端口

选择与你当前执行环境一致的托管 adapter：

```bash
ggtree-air open --workspace <workspace> --agent pi
ggtree-air open --workspace <workspace> --agent codex
ggtree-air open --workspace <workspace> --agent claude
```

不能判断时使用 `--agent auto`；它会探测安装、认证和 CLI 兼容性。`open` 会复用同一 adapter 的健康服务或选择空闲端口，并自动打开浏览器。只向用户报告“画布已打开”和必要的科学说明，不要求用户复制 URL 或选择端口。

## 6. 让真实 Agent 响应浏览器 Action

默认 managed 模式会在用户提交节点指令后启动选定的 Pi、Codex CLI 或 Claude Code，不需要外层 Agent 再执行 `actions wait`。通过 `GET /api/agents` 确认全部 adapter 的安装、认证、兼容性以及当前选择。

**Codex Desktop、Claude Code 对话和 Pi 对话不得选择 `none`，也不得用后台 `actions wait` 冒充持久连接。** 对话客户端可能在工具回合结束、会话压缩或用户切页时终止后台命令；一旦如此，画布会失去消费者。

只有由用户自己管理、能够保证进程生命周期的独立 Agent daemon，才可以明确使用 `GGTREE_AIR_AGENT=none`，并由该外部进程保持等待：

```bash
ggtree-air actions wait \
  --workspace <workspace> \
  --agent <your-agent-name> \
  --timeout 3600
```

外部模式下该命令返回并自动 claim Action。无论哪种模式，随后都必须由真实 Agent：

1. 运行 `actions running`；
2. 读取 Action 中的源文件、用户原话和可选 selection；
3. 根据 `ggtree-phylo` Skill 修改/生成 R 代码；
4. 用 `actions progress` 上报少量、人类可读的阶段；
5. 发布候选 preview；
6. 实际检查图片；
7. 根据用户要求提交一个或多个真实文件；
8. external 模式再次进入 `actions wait`；managed 模式由服务等待下一次节点指令。

不要调用程序内的旧自然语言 Planner 代替 Agent 判断。

## 7. Action 执行模板

```bash
ggtree-air actions running <id> \
  --workspace <workspace> --agent <name>

ggtree-air actions progress <id> \
  --workspace <workspace> --agent <name> \
  --phase inspect --percent 15 \
  --message "正在检查源图和标注区域"

# 修改 R、渲染、检查候选

ggtree-air actions progress <id> \
  --workspace <workspace> --agent <name> \
  --phase preview --percent 75 \
  --message "候选已生成，正在检查标签重叠" \
  --preview <candidate.png>

ggtree-air artifacts commit <id> \
  --workspace <workspace> --agent <name> \
  --file <final.png>
```

用户明确要求多个候选时，可以提交多个 `--file`。否则默认只提交一个真正变化的产物。

无法完成时：

```bash
ggtree-air actions fail <id> \
  --workspace <workspace> --agent <name> \
  --message "<诚实、可理解的原因>"
```

## 完成检查

- Runtime 与 R 环境通过检查；
- canonical Skill 已加载；
- 首个工作区和画布已经打开；
- 对话客户端使用匹配的 managed adapter，且画布明确显示“Agent 已连接”；
- 只有真正独立的 Agent daemon 才允许使用 external `actions wait`；
- 用户不需要手动执行任何安装或运行命令；
- 每个 Action 的执行过程会在画布里流式显示；
- 只提交真实变化的产物。
