# zqq-015 · 成语字源与语义DNA图谱

纯前端成语字源考据与语义拓扑分析系统。用户输入任意成语，系统拆解为四字金石甲骨字形溯源、典故出处时间轴与原文引证、语义流变路径，并测算生成该成语的"语义DNA"（本义/引申义/比喻义占比环形图及核心义原），支持任意两个成语的语义亲缘度交叉比对演算。

## 架构说明（分层架构：核心层 / 端口层 / 适配器层）

- `src/core`：领域模型（`OracleChar`、`AllusionSource`、`SemanticEvolutionStep`、`SemanticDNA`、`IdiomProfile`、`KinshipResult`）与欧氏DNA几何距离、义原Jaccard相似度算法。
- `src/ports`：端口层契约（`IdiomRepositoryPort` 典籍成语检索端口、`KinshipPort` 亲缘度比对端口、`CorrectionRepositoryPort` 纠错提案仓储端口）。
- `src/adapters`：适配器层（内置甲骨文字典与通用汉字语义生成适配器、亲缘比对分析适配器、`LocalCorrectionRepository` 基于 localStorage 的本机纠错仓储）。
- `src/ui`：原生 CSS 宣纸墨韵古典视觉呈现层，包含金石甲骨卡片、历史时间轴、语义DNA甜甜圈图表与双词亲缘竞技场。

## 用户纠错提交流程

在任意资料卡（单字字形卡、典故出处、语义流变节点、成语现代释义）上均可发起字形 / 年代 / 释义三类修订，严格走三步流程：

1. **编辑并保存草稿**：权威原文以只读形式对照展示，修订内容先落为「草稿」（localStorage，可随时找回、可反复修改）。
2. **差异预览**：字符级 LCS 算法逐字渲染删除（红）/ 新增（绿）差异，并并排对照原文与建议；确认提交前必须填写文献 / 出处佐证并勾选承诺。
3. **确认提交**：草稿转为「待审核」，进入**本地审核中心**队列；可在结论出具前随时**撤销**（转为「已撤销」留痕），或以历史提案为蓝本**重新起草**。

关键约束：

- 本地审核状态有 `draft 草稿 / submitted 待审核 / withdrawn 已撤销` 三种，直接显示在对应资料卡上（徽标可点开提案详情）。
- 所有提案是独立于权威词典的**旁路数据**（存储键 `zqq015.correction-proposals.v1`），系统只读取 `IdiomProfile` 做原文快照，**任何环节都不会回写或覆盖权威词条**。
- 头部「本地审核中心」按待审核 / 草稿箱 / 已撤销分组管理全部本机提案。

## 测试

```bash
npm test          # 核心状态机+LCS差异+仓储（35 项）与 jsdom 交互冒烟（36 项）
```

## 本地运行

```bash
npm install
npm run dev
```

## 构建验证

```bash
npm run build
```

## Docker 容器化部署

```bash
docker compose up --build
```
访问：`http://localhost:8015`
