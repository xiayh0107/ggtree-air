# ggtree-air — Agent 安装与首次使用指南

> 本文是写给 Agent 的。请替用户完成安装、环境检查、Skill 配置和首次工作流，不要把命令转交给用户。

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

只有存在多个同样可信的生物学输入时才询问用户。否则自动创建：

```bash
ggtree-air auto \
  --input <tree-or-fasta> \
  [--metadata <matching-table>] \
  --out results/<meaningful-name> \
  --no-open
```

距离矩阵文件名不明确时显式使用 `--dist`。

若用户只是体验，可从真实案例中选择：

```bash
ggtree-air recipes list
ggtree-air recipes run mammal-traits --out results/mammal --force
```

## 5. 打开画布，不让用户管理端口

```bash
ggtree-air open --workspace <workspace>
```

`open` 会复用健康服务或选择空闲端口，并自动打开浏览器。只向用户报告“画布已打开”和必要的科学说明，不要求用户复制 URL 或选择端口。

## 6. 保持等待，自动响应浏览器 Action

打开浏览器后不要结束 Agent 回合。运行：

```bash
ggtree-air actions wait \
  --workspace <workspace> \
  --agent <your-agent-name> \
  --timeout 3600
```

用户在浏览器提交指令后，该命令会返回并自动 claim Action。随后：

1. 运行 `actions running`；
2. 读取 Action 中的源文件、用户原话和可选 selection；
3. 根据 `ggtree-phylo` Skill 修改/生成 R 代码；
4. 用 `actions progress` 上报少量、人类可读的阶段；
5. 发布候选 preview；
6. 实际检查图片；
7. 根据用户要求提交一个或多个真实文件；
8. 再次进入 `actions wait`。

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
  --workspace <workspace> \
  --message "<诚实、可理解的原因>"
```

## 完成检查

- Runtime 与 R 环境通过检查；
- canonical Skill 已加载；
- 首个工作区和画布已经打开；
- Agent 正在 `actions wait`，而不是结束回合；
- 用户不需要手动执行任何安装或运行命令；
- 每个 Action 的执行过程会在画布里流式显示；
- 只提交真实变化的产物。
