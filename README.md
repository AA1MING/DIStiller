# 需求分析蒸馏器 Demand Distiller

[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/vite-7-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![SQLite](https://img.shields.io/badge/sqlite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](https://nodejs.org/en/download)
[![Offline](https://img.shields.io/badge/offline-capable-4B5563)](#它最突出的三个特点)

> 把碎片化素材（对话、粘贴文本、txt/md/json/csv/docx、AI 对话导出、甚至整个项目 zip）蒸馏成产品机会与功能点，再产出可直接交付的 PM 资产：市场分析、PRD、交互原型、Word/PDF/LaTeX 成果文档、给 AI 编程 Agent 的开发提示词。

**替谁解决什么**：独立开发者、产品经理、创业团队手上常有一堆用户反馈、社群讨论、竞品评论和自己跟 AI 聊过的需求，却判断不出「下一步先做什么」。本工具不靠拍脑袋，而是把这些原始素材蒸馏成产品机会与可执行的功能点，再产出可直接交付的 PM 资产。

- **Windows 双击即用**：根目录 `一键启动.bat` 自动检测 Node、按需装依赖、挑可用端口、开浏览器。
- **不配 Key 也能跑**：意图识别、需求蒸馏、文档与提示词均有本地回退，整条链路离线不缺环；每条结论尽量引用素材原话作为证据。
- **一个对话 = 一个项目**：边聊边抽取需求信号，蒸馏后自动归成项目与功能点。
- **每人一个数据库**：借 `AsyncLocalStorage` 请求级上下文，每个用户的数据落在各自独立的 SQLite 文件里，适合本机/内网自托管。
- **内嵌 AI 编程用量仪表盘**：移植自开源项目 TokenTracker，可看本机 Claude Code / Codex 的 token、成本与会话明细。

> ⚠️ **环境前提**：实际需要 **Node ≥ 22.13.0**（`node:sqlite` 免 `--experimental-sqlite` 的起始版本）。`package.json` 与 `一键启动.bat` 里写的 `>=20.19` 偏低，详见[第十四节](#十四已知限制与注意点)第 12 条。

包名 `demand-distiller`，版本 `0.2.0`。前后端同仓：后端是零框架的 Node 原生 `http` 服务 + Node 内置 `node:sqlite`，前端是 React 19 + Vite 7 单页应用。默认面向本机/内网私有化使用，支持多用户账号，每个用户的数据落在各自独立的 SQLite 文件里。

仓库内还内嵌了一整套从开源项目 TokenTracker 移植（源码抄录 + 作用域化）的 AI 编程用量仪表盘，以及积分激励、模板市场、管理员后台等运营功能。

---

## 它最突出的三个特点

1. **全链路可离线跑通**：未配置 Key 或 Key 失效时，蒸馏走 `fallbackExtract`、意图识别走 `INTENT_RULES`、文档走模板拼装、开发提示词走 `buildLocalPrompt`，整条链路不依赖任何模型也能出结果，只是质量弱于接模型。
2. **证据只引用原话**：system prompt 强制「证据只引用素材原话，不得编造」，AI 未返回证据时用素材全文兜底；机会详情展示证据原文、来源与置信度。
3. **零框架后端 + 每人一个数据库**：后端只用 Node 原生 `http` 与 `node:sqlite`，业务代码统一 `import { db }`，靠 `AsyncLocalStorage` + `Proxy` 天然实现按用户隔离。

---

## 一、它解决什么问题

独立开发者、产品经理、创业团队常见的困境是：手上有一堆用户反馈、社群讨论、竞品评论、和自己跟 AI 聊过的需求，但**判断不出哪些需求是真的、值得先做**。

本项目的处理链路是一条流水线：

```
碎片素材 / AI 对话
   ↓ 意图识别（kura）        → signals 表：显性诉求、隐性意图、JTBD、反信号、置信度、6 类意图
   ↓ 需求蒸馏（icemark）      → opportunities 表：痛点、目标用户、8 项评分、证据链、MVP/PRD/验证实验
   ↓ 功能点落库                → features 表（默认 status=kept）
   ↓ 归入项目                  → projects 表（一个对话 = 一个项目）
   ↓ 产出资产                  → 市场分析 / PRD / HTML 原型 / Word·PDF·LaTeX 文档 / 开发提示词 / Wiki 星系图
```

未配置任何 AI 时，这条链路的每个环节都有本地回退实现：

| 环节 | 离线回退实现 |
| --- | --- |
| 需求蒸馏 | `server/services/distill.js` 的 `fallbackExtract`：按标点断句抽取候选需求 |
| 意图识别 | `server/services/kura.js` 的 `INTENT_RULES`：6 类意图关键词打分 |
| 市场分析 / PRD / 原型 | `server/services/analysis.js` 产出结构完整但内容为占位的文档（SWOT 各项为空、波特五力每项硬编码 `score: 50`、`overallScore: 50`） |
| 成果文档 | 把项目数据注入模板 HTML，不生成新正文 |
| 开发提示词 | `server/services/prompts.js` 的 `buildLocalPrompt`：六段固定结构模板拼装 |

---

## 二、界面与菜单：点进去能干什么

登录后左侧是功能菜单。**普通用户 14 项，管理员登录后菜单整体替换为 4 项管理功能**（不是叠加），普通用户看不到管理页，管理员也看不到蒸馏/文档等用户功能。

### 普通用户菜单

| 菜单 | 做什么 |
| --- | --- |
| **项目对话** | 核心起点。每个对话即一个项目。与 AI 项目经理流式聊天（思考过程可折叠、可取消生成、点消息即复制）。点「＋ 新建项目」填项目名称 / 项目简介 / 初始需求，建会话后会立刻把简介与需求作为第一条消息发给 AI。聊天中 AI 若识别出疑似需求，会自动抽出隐藏的 `<signal>` 标记入库，正文里不会显示标签 |
| **需求蒸馏** | 两条入口。① 勾选对话项目批量蒸馏（可勾选「统计并纳入全部历史 signal 作为补充证据」，也支持显示已蒸馏会话）；② 「导入素材蒸馏」支持上传 `.txt/.md/.json/.jsonl/.csv/.docx` 或直接粘贴文本，选来源类型（项目对话 / 手动问题 / 用户反馈素材 / 社群讨论 / 竞品评论）后先「解析」预览，再「蒸馏为功能点」。蒸馏完成会提示生成了几个项目，并可一键跳「项目管理」 |
| **功能点库** | 按来源会话分组展示全部功能点，显示总数与保留数；支持 ★ 收藏（可只看收藏）、删除、勾选多个功能点 + 填标题 → 「整合生成项目」 |
| **项目管理** | 两个 tab：「需求项目」与「实体项目」。需求项目可新建、编辑、查看/增删功能点（新建之外无导入界面入口）；实体项目可上传 zip 托管（仅存储），点「AI 阅读」由 AI 整理代码逻辑并自动提炼功能点，代码逻辑展开区只渲染前 4000 字符，超出部分以「…（截断显示）」提示 |
| **产品分析** | 选项目后一键产出：市场分析（SWOT / PESTEL / 波特五力 + 综合评分，带可视化）、产品需求文档 PRD、HTML 交互原型（iframe 预览 + 下载 HTML） |
| **文档生成** | 成果工作台。上传/选择模板 → 选项目 → 生成整份 HTML 文档 → iframe 预览 → 用自然语言让 AI 改（多轮对话式修改）→ 导出 Markdown / Word / PDF / LaTeX，每次生成或修改自动存历史版本，可载入、删除或导入回项目。页内含「模板市场」弹窗，用积分兑换他人模板 |
| **AI 提示词** | 选项目 + 选目标 AI 编程 Agent（卡片式，带吉祥物与动画），生成可粘贴的开发提示词，支持复制与下载 `.md` |
| **积分激励** | 提交获奖作品换积分：作品名称、说明、获奖信息必填，**获奖证据必须上传**，附件可选（单文件 ≤5MB，超出报错）。下方列出我的提交、状态、发放积分与管理员备注，待审核作品可自行删除 |
| **创作积分** | 积分榜前 20 名 + 我的排名。只统计审核通过发放的创作积分，不含充值、不扣消费 |
| **知识图谱** | Wiki 星系图：所有项目作为星团围绕中心旋转，功能点是环绕的子星，深色夜空风格。打开页面会自动为尚未生成知识库的项目补齐生成。点星星打开阅读面板（Markdown 渲染、mermaid 图表、相对链接应用内跳转、反向链接），右上有搜索框可定位并锁定相机 |
| **用量统计** | 内嵌的 TokenTracker 仪表盘：token 总量、计费 token、估算成本、模型分布、趋势与活动热力图。非 localhost 部署时会尝试拉起本机代理读取你本机的 Claude Code / Codex 实时数据 |
| **会话明细** | TokenTracker 会话页：本机 Claude Code / Codex 会话列表（标题、起止时间、时长、token、成本、轮次、可复制的 resume 命令） |
| **模型配置** | 统一配置 AI 接口：Provider（积分 / OpenAI / DeepSeek / OpenRouter / 自定义 OpenAI 兼容）、Base URL、Model、API Key、启用开关，每个 Provider 独立保存 Key；页内展示积分模型价格表与「每日每功能用量（近 14 天）」 |
| **个人中心** | 改昵称/邮箱/简介、改密码（其它设备会话自动失效）、查看积分、模拟充值（支付宝 / 微信，金额 1–1000000，即时到账） |

### 管理员菜单

| 菜单 | 做什么 |
| --- | --- |
| **用户管理** | 用户总览（注册用户数、作品数、已发放积分）、搜索、列表（角色 / 作品数 / 待审核 / 已通过 / 积分）、删除普通用户（级联清理） |
| **作品审核** | 按状态筛选，查看/下载作品附件与获奖证据，填写发放积分（0–100000）与备注，通过并发放或拒绝，删除作品 |
| **模板市场** | 市场统计（模板数 / 作品导入数 / 兑换次数 / 消耗积分 / 兑换用户）、手动上传文件上架模板、从已审核作品导入为模板、下架 |
| **模型管理** | 配置「积分模式」模型：模型名称、积分/1M token 价格、多个 Base URL、每个 URL 多把 API Key，并展示各接口的使用人数与调用次数 |

### 内置管理员账号

```
用户名：admin
密码：123456
```

源码位于 `server/services/auth.js`（`ADMIN_USERNAME` / `ADMIN_PASSWORD`），该账号在**每次服务启动时都会被强制校正**密码与角色：存在则 `UPDATE pass_hash/pass_salt/role='admin'`，不存在则插入。这是演示/教学取向的设计，正式对外部署前必须改造。

此外，源码中还存在几个**无任何可达菜单入口**的页面与组件：`src/pages/ImportPage.jsx`、`src/pages/IntentPmWorkbench.jsx`、`src/pages/ChangelogPage.jsx`，以及机会池组件 `src/components/Opportunities.jsx`、`src/components/OpportunityDetail.jsx`。其中后两者各有一条死导入（`MarketVisual.jsx` 导入了 `Opportunities`、`Opportunities.jsx` 导入了 `OpportunityDetail`，但都未真正渲染）。相关后端接口（`/api/opportunities`、`/api/intent/map`、`/api/pm/portfolio`、`/api/import/*`）都在，但没有可达的界面入口，属于历史遗留或待接线部分。

---

## 三、快速开始

### 环境要求

- Node.js **≥ 22.13.0** —— 这是实际门槛，不是 `package.json` 里写的 20.19。原因：`server/dao/db.js` 第一行直接 `import { DatabaseSync } from 'node:sqlite'`，而 `node:sqlite` 自 **v22.5.0** 才引入、且到 **v22.13.0**（v23 线为 v23.4.0）才不再需要 `--experimental-sqlite` 标志；仓库内未在任何地方传该标志。因此 v20.19–v22.12 上该 import 会抛 `ERR_UNKNOWN_BUILTIN_MODULE`，服务起不来。`package.json` 的 `engines` 与 `一键启动.bat` 的校验都写的 `>=20.19`，与实际不符，见第十四节第 12 条。
- npm
- 平台优先 Windows（一键启动脚本、本机代理协议注册均为 Windows 专用），其余平台可用命令行方式启动
- 可选：`xelatex`（PDF 导出走 LaTeX 编译时需要）、中文字体（pdfkit 回退渲染 PDF 时需要）

### 方式一：Windows 双击一键启动（推荐）

直接双击仓库根目录的 `一键启动.bat`。它会：

1. 切 UTF-8 代码页，检测 `node` / `npm` 并按 v20.19 校验（注意：该阈值低于实际所需的 v22.13.0）
2. `node_modules` 缺失或损坏时自动 `npm install`
3. 运行 `node scripts/dev.mjs`：读取 `netsh` 的系统 TCP 保留端口段（Windows 常把 8787 划入 Hyper-V/winnat 保留段，直接监听会报 `EACCES`），自动挑选可用端口，注入 `PORT` / `API_PORT` / `VITE_PORT`
4. 等待 `/api/health` 与前端就绪后自动打开浏览器
5. 控制台输出同时镜像写入 `log/`，只保留最近 30 次运行

支持的参数：

```bat
一键启动.bat              正常启动，依赖缺失自动安装
一键启动.bat --no-install  跳过依赖安装
一键启动.bat --reinstall   强制重新安装依赖
一键启动.bat --help        显示帮助
```

### 方式二：命令行

```bash
npm install
npm run dev          # concurrently 同时起后端 node server/index.js 与前端 vite
```

访问 Vite 打印的地址（开发态默认 5173，一键启动器默认 4173）。开发态由 Vite 把 `/api`、`/integrations`、`/functions` 代理到后端。

只跑其中一端：

```bash
npm run dev:api      # 仅后端，默认 http://localhost:8787
npm run dev:web      # 仅前端 Vite
```

### 方式三：生产模式

```bash
npm run build        # vite build，产物输出到 data/dist（不是默认的 dist/）
npm run start        # node server/index.js，同端口提供 API 并托管 data/dist 静态站点
```

生产模式下后端自己处理 `/api`、`/functions`、`/integrations` 与静态文件（自带 MIME 表、SPA 回退 `index.html`），不再经过 Vite 代理。首次使用流程：打开页面注册账号（2–32 位用户名、≥6 位密码）→ 进「模型配置」填 AI Provider 与 Key（不填也能跑，走本地启发式回退）→ 进「项目对话」新建项目聊几轮，或到「需求蒸馏」粘贴一段素材试试。

### 端口速查

| 对象 | 默认端口 | 说明 |
| --- | --- | --- |
| 后端 API | 8787 | `PORT` 可覆盖（`API_PORT` 只被 `vite.config.js` 读取作代理目标，不影响后端监听端口） |
| 前端（一键启动器） | 4173 | `scripts/dev.mjs` 的默认值，冲突时从 8862 起向上扫到 9999 |
| 前端（Vite 裸跑） | 5173 | `vite.config.js` 中 `VITE_PORT` 的默认值 |
| TokenTracker 本机数据代理 | 18788 | `scripts/tt-local-proxy.mjs`，仅绑定 127.0.0.1，`TT_PROXY_PORT` 可改 |
| 外部 OpenWiki 可视化服务 | 4321 | 仅在启用外部集成时需要，`OPENWIKI_PORT` 可改 |
| 外部 TokenTracker 服务 | 7681 | 仅在启用外部集成时需要，`TOKENTRACKER_PORT` 可改 |

一键启动器传的前端默认端口（4173）与 `.env.example` 注释、`vite.config.js` 回退值（5173）不一致，实际以启动器为准。

---

## 四、AI 模型配置

配置入口是「模型配置」页，落到用户库 `settings` 表的 `ai` 配置项。可选 Provider：

| Provider | 说明 |
| --- | --- |
| `points`（积分） | 平台自营模式。由管理员在「模型管理」里配置「模型 × 多 Base URL × 多 API Key」，用户只选模型，看不到 Key。计费固定为 **每 1M token = 100 积分**（`POINTS_RATE`） |
| `openai` | OpenAI 官方 |
| `deepseek` | DeepSeek（流式解析兼容 `reasoning_content` 思考过程） |
| `openrouter` | OpenRouter |
| `custom_openai` | 任意 OpenAI 兼容端点，自行填 Base URL 与 Model |

要点：

- 每个 Provider 的 Key 独立保存，切换 Provider 时自动切换对应 Key。
- 调用层不走任何第三方 AI SDK，直接用 `fetch` 调 `/chat/completions` 与 `/models`。
- 除设置页外，还支持**请求级临时覆盖**：请求头 `X-AI-Config` 可携带 `provider` / `baseUrl` / `model` / `embeddingModel` / `apiKey` / `apiKeys`（`apiKeys` 仅限 openai/deepseek/openrouter/custom_openai 四个键），该配置不落库、不共享，做字段白名单过滤。前端未使用此通道。
- 每次调用都会写 `ai_usage_log`，用于「每日每功能用量」与用量趋势统计。搜索全仓未发现任何硬性每日调用上限，现有机制只是记账与展示。
- 内置的统一提示词 `UNIFIED_SYSTEM_PROMPT`（`server/services/ai.js`）用 User 消息首行的 `[mode:xxx]` 切换能力，共 7 种模式：`chat` / `kura` / `icemark` / `deliverable` / `codeanalysis` / `analysis` / `prompt`。一个提示词承载整条业务链，模型侧零配置路由。
- 积分模式的端点分流是**进程内游标轮询**（`pointsCursor`），服务重启即归零；多实例部署时各实例各自计数。

---

## 五、核心链路细节（想改代码时看这里）

### 评分公式

`server/services/distill.js` 的 `computeOpportunityScore`，8 个 0–100 分维度加权后夹取到 0–100：

```
0.25 * 需求强度 + 0.2 * 痛点强度 + 0.1 * 证据质量 + 0.2 * 商业价值
+ 0.15 * 可行性 + 0.1 * 差异化 − 0.15 * 重复风险 − 0.1 * 市场风险
```

### 去重是两套机制

- **精确去重**：`normalizeText` 后取 SHA-256 存 `raw_items.hash`（UNIQUE）。命中且未传 `force` 时返回 `duplicated=true` 并复用旧 `raw_item`。
- **相似度**：`tokenize`（英文词 + 中文 bigram，带停用词表）后算 Jaccard，`> 0.12` 视为相似。`similarOpportunities` 取 top5 展示，机会星系取 top4 作邻居。

注意：精确去重命中后**仍会重新蒸馏并新建一条 opportunity**，它只复用原始素材、不阻止重复机会产生。这是代码的实际行为。

### 功能点状态机

`status ∈ {kept, dropped}`（默认 `kept`）与 `favorite ∈ {0,1}` 是两个正交字段。但接口层面：`PUT /api/features/:id/favorite` 有前端调用（功能点库），`POST /api/features/:id/status` 只在 `src/api.js` 里有封装、**没有界面入口**，「保留/舍弃」的 UI 位置未确认，宜按后端能力理解。

`syncFeatures` 在每次蒸馏或重新评估时，会**先 DELETE 该机会全部 features 再以 `kept` 重建**。因此用户在重新评估后对功能点的收藏编辑会丢失——这是当前实现的已知取舍。

### 项目自动重建

`rebuildProjects` 现在按「对话会话」分组（一个对话 = 一个项目），不再按相似度聚类；无会话归属的功能点归入「其他来源」。`auto=1` 的自动项目重建时全删重建，人工项目（`auto=0`）保留。

### 证据强制引用原文

system prompt 要求「证据只引用素材原话，不得编造」；`insertEvidence` 在 AI 未返回证据时用素材全文兜底。

### 流式 signal 过滤

`server/services/chat.js` 专门处理 `<signal>` 标签跨 SSE chunk 的半标签暂留（未闭合的 `<signal`、孤立的 `</signal>`、`<>` 残片都会被清除），保证标签绝不显示在正文里；`kura` 的意图分析在后台异步执行，不阻塞回复。

---

## 六、工程亮点（值得照抄的做法）

- **手写 ZIP 打包**：`server/utils/docx.js` 用 `node:zlib` 的 `crc32` 计算校验和，再手写本地文件头、中央目录与 EOCD，采用 store（不压缩）方式，全程不依赖第三方 zip 库。
- **原生 Word 目录域**：`docx.js` 与 `html.js` 写入 bookmark 与 `TOC \o "1-3" \h \z \u` 域，并在 `settings.xml` 注入 `<w:updateFields w:val="true"/>`，Word 打开后自动补齐页码；同时输出一份静态条目作占位，避免未更新域时目录为空。
- **自研模板解析器**：`server/utils/template.js` 用正则解析 `document.xml`，从 `pStyle` 的 Heading/标题样式或 `outlineLvl` 大纲级别推断标题层级（正文里的 `1.` / `1.1` 数字编号也识别为标题）；PDF 模板则用 `inflateSync` 解压流后抽取 `(..) Tj` / `[..] TJ` 文本操作符（扫描型 PDF 抽不到）。
- **PDF 三级降级链**：先 `htmlToLatex` 生成 `.tex` 用 `xelatex` 编译两遍（从 `main.log` 中筛 `!` 开头的错误行作为失败摘要）；失败则把 HTML 转 Markdown 后用 pdfkit 渲染兜底。
- **前端 SSE 手动解析**：`src/api.js` 按 `\n\n` 切分事件块、逐行取 `data:` 前缀后手工拼装，未使用 `EventSource`。

---

## 七、目录结构

```
DIStiller/
├── 一键启动.bat                 # Windows 一键启动入口（检测环境/装依赖/调 dev.mjs）
├── package.json                 # 唯一工程清单：name=demand-distiller，engines>=20.19（实际需 22.13+）
├── vite.config.js               # publicDir=src/public，outDir=data/dist，dev 代理 /api|/integrations|/functions
├── index.html                   # SPA 挂载点 + 防闪主题内联脚本 + 本地化 vendor 脚本
├── tailwind.config.cjs          # content 扫描 tt/ 与 wiki/ 子树（主应用页面不用 Tailwind）
├── postcss.config.cjs
├── .env.example                 # 仅声明 PORT=8787
├── .gitignore                   # 忽略 node_modules/ dist/ data/ depend/ .env log/
│
├── server/                      # 后端（约 7800 行，零框架）
│   ├── index.js                 # 唯一 HTTP 入口：CORS/鉴权/上下文装配/静态托管/路由分发
│   ├── controllers/             # 17 个 controller + routes.js（合并成扁平路由表）
│   │   ├── routes.js            # handlers 合并 + PUBLIC_KEYS 白名单
│   │   ├── auth.controller.js   # 注册/登录/注销/当前用户
│   │   ├── chat.controller.js   # 会话与 SSE 流式对话
│   │   ├── distillery.controller.js  # 蒸馏概览/批量蒸馏/素材解析与导入蒸馏
│   │   ├── features.controller.js    # 功能点列表/收藏/删除/整合成项目
│   │   ├── projects.controller.js    # 项目 CRUD/导入/repo 导入/Wiki/功能点状态/digest
│   │   ├── opportunities.controller.js # 机会池 CRUD/distill/reevaluate/status/pm-brief/标签
│   │   ├── intent.controller.js      # 意图地图/PM 组合/changelog
│   │   ├── analysis.controller.js    # 市场分析/PRD/原型
│   │   ├── deliverables.controller.js # 模板库/生成/修订/对话/导出/版本
│   │   ├── integrations.controller.js # OpenWiki 与 TokenTracker 生命周期
│   │   ├── tokentracker.controller.js
│   │   ├── works.controller.js / market.controller.js / admin.controller.js
│   │   ├── settings.controller.js / usage.controller.js / misc.controller.js
│   │   └── ...
│   ├── dao/
│   │   ├── db.js                # 每用户独立库 + AsyncLocalStorage + db Proxy + 幂等 migrate
│   │   └── global-db.js         # data/global.db：global_settings、points_model_usage
│   ├── middleware/
│   │   ├── auth.js              # requireAdmin
│   │   └── http.js              # send()/readBody()（500MB 上限）/readAiOverride()
│   ├── services/                # 24 个业务服务
│   │   ├── ai.js                # AI 抽象层、UNIFIED_SYSTEM_PROMPT、积分模型分流
│   │   ├── auth.js              # 账号/角色/会话，内置 admin
│   │   ├── chat.js              # 对话与 signal 解析、SSE
│   │   ├── distill.js           # 蒸馏核心：评分、parseJsonContent、fallbackExtract
│   │   ├── distillery.js        # 蒸馏工作台：概览/批量/单会话→项目
│   │   ├── kura.js              # 意图识别（[mode:kura] + INTENT_RULES 回退）
│   │   ├── intent.js            # 意图地图/机会星系/PM 组合/PM Brief
│   │   ├── dedup.js             # sha256 精确去重 + Jaccard 相似度
│   │   ├── projects.js / needs.js # 项目与功能点数据层
│   │   ├── analysis.js / deliverables.js / prompts.js  # 产出层
│   │   ├── import.js / repo-import.js / wiki-generate.js / wiki-graph.js
│   │   ├── integrations.js      # 子进程管理 + 反向代理
│   │   ├── tokentracker-local.js / tt-functions.js / tokentracker-api.js
│   │   ├── works.js / market.js / usage.js / auth.js
│   │   └── ...
│   └── utils/                   # 6 个纯手写工具
│       ├── docx.js              # Markdown→DOCX（手写 OOXML + crc32 + ZIP 打包）
│       ├── html.js              # 正则标签栈 HTML 解析、htmlToDocx、markToc
│       ├── pdf.js               # pdfkit 渲染 + 中文字体 + 手动画目录
│       ├── latex.js             # HTML→ctexart LaTeX、texToPdf（xelatex 编译两遍）
│       ├── template.js          # 模板解析（docx/pdf/txt/md/tex）
│       └── token-metrics.js     # token 估算与成本计算
│
├── src/                         # 前端（约 78000 行，其中 tt 子树约 44000 行）
│   ├── main.jsx                 # React 19 入口（含 @fontsource/geist-mono 全局引入）
│   ├── App.jsx                  # 信息架构中枢：baseNav(14) / ADMIN_NAV_ITEMS(4)、主题、页面分发
│   ├── api.js                   # fetch + Bearer token 客户端，含 SSE 手工解析
│   ├── styles.css               # 主应用样式与主题变量（未用组件库）
│   ├── pages/                   # 18 个页面（含 tt/DashboardPage、tt/SessionsPage）
│   ├── components/              # 通用组件 + wiki/WikiVisualizer + tt/ 子树
│   ├── components/tt/           # 抄录的 TokenTracker 组件、UI 原子、dashboard 视图
│   ├── hooks/tt/                # TT 数据 hooks（use-usage-data 等）
│   ├── lib/tt/                  # TT 数据层与工具（api.ts、copy.ts、i18n、定价等）
│   ├── contexts/tt/             # TT 的 Insforge/Auth 上下文
│   ├── content/tt/              # copy.csv(1473 条文案) + 5 语种 i18n JSON
│   ├── styles/                  # mascots.css、wiki/、tt/tt.css（作用域化后的 TT 样式）
│   ├── utils/                   # cache.js(60s TTL)、constants.js、markdown.jsx 等
│   └── public/                  # 静态资源（publicDir）；vendor/ 下 4 个本地化前端库
│
├── scripts/
│   ├── dev.mjs                  # 端口挑选 + 日志 + 就绪探测 + 开浏览器
│   ├── build-tt-css.mjs         # 把 TT 原版样式作用域化到 .tt-shell（手动执行）
│   ├── tt-local-proxy.mjs       # TokenTracker 本机数据代理（127.0.0.1:18788）
│   ├── start-tt-proxy.bat       # 一键启动本机代理
│   ├── register-tt-proxy.bat    # 注册/注销 tt-proxy:// 协议与登录自启
│   └── tt-proxy-handler.vbs     # 无窗口隐藏启动器
│
└── data/                        # 运行期数据（.gitignore 忽略，首次启动自动创建）
```

---

## 八、技术栈

**后端**

- Node 原生 `http`（无 Express/Koa/Fastify）、`node:sqlite` 的 `DatabaseSync`（无 better-sqlite3）、`node:async_hooks`（AsyncLocalStorage）、`node:crypto`（scrypt 加盐哈希）、`node:zlib`（crc32 / inflate）、原生 `fetch` 与 Web Streams
- 运行时 npm 依赖极少：`pdfkit`（仅 PDF 回退渲染）

**前端**

- React 19、react-router-dom 7（**仅**用于嵌入式 TT 子树的 `MemoryRouter`，主应用没有路由）、Vite 7
- 主应用不依赖任何组件库，纯 `styles.css` + CSS 变量 + 内联样式；界面文案硬编码中文，**没有国际化**
- `@base-ui/react`、`lucide-react`、`motion`、`@dnd-kit/*`、`date-fns`、`react-day-picker`、`clsx`、`tailwind-merge`、`@insforge/sdk` —— 只服务于 `tt/` 子树
- `@fontsource/geist-mono` 在 `src/main.jsx` 根入口全局引入（供 TT 仪表盘数字字体），不限于 tt 子树
- `package.json` 还声明了 `three`、`html-to-image` 两个依赖，但**全仓代码零 import**，属于未被引用的声明依赖

**开发依赖**

`vite`、`@vitejs/plugin-react`、`tailwindcss`、`postcss`、`autoprefixer`、`concurrently`

**外部集成（可选）**：OpenWiki（默认 `../depend/repos/openwiki-main`，端口 4321，知识可视化器与 CLI）与 TokenTracker（默认 `../depend/repos/TokenTracker-main`，端口 7681，上游用量统计服务与 Windows 桌宠），分别经 `/integrations/openwiki/*`、`/integrations/tokentracker/*` 反代。

**仓库现状（如实说明）**

- 无测试：全仓 409 个受版本控制文件（`server/` 约 7800 行 + `src/` 约 78000 行，其中 tt 子树约 44000 行）里没有 `*.test.*` / `*.spec.*` / `__tests__`，也没有 vitest/jest 配置，`package.json` 无 `test` 脚本。
- 无 CI：不存在 `.github/` 或任何工作流 yml/yaml。
- 无 lint/format：无 eslint/prettier/biome 配置，也无 `.editorconfig`。
- 无类型检查：没有 `tsconfig.json`，但存在 47 个 `.ts`（含 5 个 `.d.ts`），全部位于 `src/{contexts,hooks,lib}/tt` 之下，是移植 TokenTracker 时为标注接口引入的；靠 Vite/esbuild 仅擦除类型运行，从不做 `tsc` 校验。
- 无 LICENSE、无 Dockerfile（`vite.config.js` 注释提到 Docker 用预构建 dist，但仓库未附带任何容器配置）。
- 仓库仅在两处子目录存在 README（`src/components/tt/ui/foundation/README.md`、`src/public/achievements/README.md`），根目录原无 README。
- 当前 git 仓库尚无任何提交，全部文件处于暂存新增状态。

---

## 九、数据存储

存储引擎是 Node 内置 `node:sqlite` 的 `DatabaseSync`，WAL 模式，`foreign_keys=ON`。数据目录默认 `data/`（可用 `DD_DATA_DIR` 覆盖）。

| 文件 | 作用域 | 内容 |
| --- | --- | --- |
| `data/auth.db` | 全局 | 账号与会话：`users`（含 role/nickname/avatar/bio/email）、`sessions` |
| `data/distiller.db` | 迁移源 | 旧版单用户业务库，**首个注册用户会接管它**（`claimLegacyDataForFirstUser` 先 checkpoint 再拷贝为 `users/<id>.db`） |
| `data/users/<id>.db` | 每用户 | 该用户的全部业务数据（见下表） |
| `data/global.db` | 全局 | `global_settings`（含积分模型价格表）、`points_model_usage`（各 URL 使用人数与调用次数） |
| `data/works.db` | 全局 | `works`（作品提交/审核/积分）、`market_purchases`（兑换支出）、`point_recharges`（充值） |
| `data/market.db` | 全局 | `market_templates`（模板市场商品） |
| `data/repos/u<id>\|shared/*.zip` | 磁盘 | 托管的实体项目压缩包（按用户隔离） |
| `data/openwiki-projects/<id>/openwiki/` | 磁盘 | 原生生成的知识库（`index.md` + `features/<slug>.md`） |
| `data/dist/` | 磁盘 | 前端构建产物 |

用户库（`users/<id>.db`）主要表：

- `settings` — AI 配置与各 Provider 的 Key
- `chat_sessions` / `chat_messages`（`role`、`content`、`thinking`）
- `signals` — 疑似需求：`content`、`distilled`、`opportunity_id`、`intent_category`、`explicit_need`、`implicit_intent`、`jobs_to_be_done`、`anti_signals`、`confidence`、`analysis_model`
- `raw_items` — 原始素材：`text`、`hash`(sha256, UNIQUE)、`source_type/name/url`
- `sources`、`tags`、`opportunity_tags`
- `opportunities` — 产品机会：标题/摘要/问题陈述、`target_users` 等 JSON 列、8 个评分列、`opportunity_score`、`competitor_analysis`、`generated_assets`、`status`、`ai_model`
- `evidence` — 证据链：`quote`、`source_type`、`source_url`、`relevance_reason`、`confidence`
- `validation_experiments` — 验证实验：假设/实验/成功指标/时限/状态
- `opportunity_activity` — 活动时间线；`changelog_entries` — 状态变 shipped 时自动生成的草稿
- `features` — 功能点：`opportunity_id`（可空）、`session_id`、`title`、`description`、`priority`、`status`（kept/dropped）、`favorite`、`intent_category`、`source_type/name`
- `projects` — `title`、`theme`、`auto`（1 自动/0 人工）、`source`（demand/distill/manual/repo/import）、`repo_path`、`repo_status`、`code_logic`、`session_id`
- `project_features` — 项目 ↔ 功能点多对多
- `deliverable_versions` — 成果版本：`kind`、`version`、`markdown`、`html`、`feedback`、`imported`
- `templates` — 成果模板：`content`（解析文本）、`html_template`、`raw`（原始文件 base64）
- `ai_usage_log` — 调用记账：`step`、`model`、`input_tokens`、`output_tokens`、`duration_ms`、`ok`

**多用户隔离的机制**：请求进入后，`dbContext`（AsyncLocalStorage）携带「当前用户库」的句柄；业务代码统一 `import { db }`，而 `db` 是一个 `Proxy`，`get` 时从上下文取库、无上下文回退 `legacyDb`。因此各 service 无需任何改动就天然按人隔离。

积分余额**不落独立字段**，而是实时聚合：`已通过作品发放积分 + 充值 − 市场消费`。

### 备份、迁移与重置

- **完整备份**：把整个 `data/` 目录原样拷贝即可（含各用户库、全局库、token 计费库与托管 zip）。
- **全新重置**：删除 `data/` 目录，下次启动会重新建库；注册的首个账号会重新触发 `claimLegacyDataForFirstUser` 接管 `distiller.db`。
- **单用户迁移**：`data/users/<id>.db` 是该用户的全部业务数据，连同 `auth.db` 中的账号行一起拷贝即可迁移。
- 数据目录可用 `DD_DATA_DIR` 指向其它磁盘，便于部署与测试隔离。

---

## 十、脚本与环境变量

### npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | `concurrently -k` 同时启动 `node server/index.js` 与 `vite` |
| `npm run dev:api` | 只启动后端（默认 8787） |
| `npm run dev:web` | 只启动 Vite 前端 |
| `npm run build` | `vite build`，产物输出到 `data/dist` |
| `npm start` | 生产模式，`node server/index.js` 托管 `data/dist` 并提供 API |
| `npm run preview` | `vite preview` |

### 辅助脚本（非 npm 脚本）

| 命令 | 作用 |
| --- | --- |
| `一键启动.bat` | Windows 一键启动：检测 Node/npm、按需安装依赖、调用 `scripts/dev.mjs` |
| `node scripts/dev.mjs` | 端口挑选 + 日志 + 就绪探测 + 自动开浏览器 |
| `node scripts/build-tt-css.mjs` | 生成作用域化的 `src/styles/tt/tt.css`（**需手动执行**，不在任何 npm 脚本或构建钩子里） |
| `node scripts/tt-local-proxy.mjs` | 启动 TokenTracker 本机数据代理（默认 `127.0.0.1:18788`），幂等启动 |
| `scripts/start-tt-proxy.bat [端口]` | Windows 一键启动本机代理 |
| `scripts/register-tt-proxy.bat [-unregister]` | 注册/注销 `tt-proxy://` 自定义协议与登录自启（写 HKCU 注册表） |

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 后端监听端口 |
| `API_PORT` | — | 一键启动器注入，仅作 Vite 代理目标 |
| `VITE_PORT` | 5173 | Vite 开发端口 |
| `DD_DATA_DIR` | `./data` | 数据目录（部署/测试用） |
| `CJK_FONT` | `server/utils/pdf.js` 内的默认路径 | pdfkit 渲染 PDF 用的中文字体路径，Windows 下需自行指定 |
| `MINI_SYNC_USER` | `admin` | `/api/local-auth` 为其签发会话令牌（小程序免登录同步） |
| `OPENWIKI_DIR` | `../depend/repos/openwiki-main` | 外部 OpenWiki 仓库路径 |
| `OPENWIKI_PORT` | 4321 | OpenWiki 可视化服务端口 |
| `TOKENTRACKER_DIR` | `../depend/repos/TokenTracker-main` | 外部 TokenTracker 仓库路径（也用于加载定价数据） |
| `TOKENTRACKER_PORT` | 7681 | 外部 TokenTracker 服务端口 |
| `TT_DATA_HOME` | 用户主目录 | TokenTracker 扫描的会话日志根目录（默认 `~/.claude`、`~/.codex`） |
| `TT_PROXY_PORT` | 18788 | 本机数据代理端口 |

注意：一键启动器与 `scripts/dev.mjs` **不读取 `.env` 文件**（`server/index.js` 也只读 `process.env.PORT`），`.env.example` 仅作示例。

---

## 十一、HTTP 接口概览

后端全部接口由手写分发器处理，路由键形如 `'METHOD /api/path'`，先精确匹配、再按段数与 `:param` 模板回退匹配，未命中返回 404 `{error:'接口不存在'}`。当前共 **137 条 METHOD 前缀路由**（全部为 `/api/*`）；另有 `/functions/*` 由 `server/index.js` 单独分发（约 22 个路径处理器，不使用 `METHOD /path` 键），合并计数约 159 条。公开白名单只有 4 条：`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/health`、`GET /api/local-auth`。

按域概览：

| 前缀 | 条数 | 代表接口 |
| --- | --- | --- |
| `/api/projects` | 19 | 项目 CRUD、`/import`、`/import-repo`、`/rebuild`、`/:id/read`、`/:id/analysis`、`/:id/wiki`、`/:id/wiki-graph`、`/wiki-galaxy`、`/:id/candidates`、`/:id/features`、`/:id/digest` |
| `/api/integrations` | 15 | OpenWiki 与 TokenTracker 的 setup/start/stop/sync/task、状态与日志 |
| `/api/opportunities` | 12 | 机会池列表/详情/更新/删除、`/distill`、`/:id/reevaluate`、`/:id/status`、`/:id/pm-brief`、`/:id/activity`、标签与来源 |
| `/api/admin` | 11 | 作品列表/审核/删除、附件与证据、用户列表/删除、积分统计与积分模型 |
| `/api/points` | 8 | `/me`、`/leaderboard`、`/works`、`/recharge`、`/recharges` |
| `/api/deliverables` | 8 | `/generate`、`/revise`、`/chat`、`/export`、`/save`、`/versions`（含导入） |
| `/api/chat` | 8 | 会话 CRUD、`/:id/messages`、`/:id/stream`（SSE）、`/:id/signals`、`/:id/distill` |
| `/api/market` | 7 | 模板列表/我的、预览、兑换、管理员上架/导入作品/下架 |
| `/api/auth` | 4 | 注册/登录/注销/`me` |
| `/api/templates` | 4 | 模板库列表/上传/删除/下载 |
| `/api/settings` | 4 | `GET`/`PUT /api/settings/ai`、`/ai/test`、`/ai/models` |
| `/api/features` | 4 | 列表、`/:id/status`、`/:id/favorite`、`/:id`（DELETE） |
| `/api/usage` | 3 | `/trend`、`/daily`、`/summary` |
| `/api/analysis` | 3 | `/market`、`/prd`、`/prototype` |
| 其他 | — | `/api/distillery/*`、`/api/import/*`、`/api/intent/map`、`/api/pm/portfolio`、`/api/changelog`、`/api/tokentracker/*`、`/api/profile/*`、`/api/tags`、`/api/sources`、`/api/health`、`/api/local-auth` |
| `/functions/*` | 22 | 原版 TokenTracker 数据接口（无需登录，格式对齐其 `local-api.js`），供内嵌仪表盘直接消费 |

请求体上限 500MB（用于 zip/docx/pdf 的 base64 上传），超限返回 413。

---

## 十二、安全与隐私

**认证**：密码使用 scrypt 加盐哈希存储，校验时走 `timingSafeEqual`。会话以 Bearer token 承载，改密码会令其它设备会话失效。

**已知薄弱点（部署前须评估）**：

- 无 HTTPS、无 CSRF 防护、无速率限制。
- 内置管理员凭据 `admin` / `123456` 硬编码在源码里，且每次启动强制重置。
- **用户 API Key 明文存储**：Key 直接写入每个用户的 `settings` 表 `ai` 配置项，未见加密。任何能读到 `data/users/<id>.db` 的人都能取出 Key，请只在可信环境运行并妥善保护数据目录。
- **会读取本机日志**：TokenTracker 组件默认扫描 `~/.claude`、`~/.codex` 下的会话日志（`TT_DATA_HOME` 可改根目录），用于「用量统计 / 会话明细」。把服务开在多人可达的地址前，请先明确这一点。
- 充值/支付是模拟的，未接真实支付网关（详见第十四节）。

---

## 十三、部署与运维

仓库不带 Docker/容器配置，生产/内网部署的推荐路径如下：

```bash
# 1) 准备环境（实际需 Node ≥ 22.13.0，见第三节说明）
npm install            # 或 npm ci（有 lockfile 时更快）
npm run build          # 前端产物输出到 data/dist
# 2) 启动服务（API 与静态站点同端口）
PORT=8787 npm start
```

- **反向代理**：在服务器前置 Nginx/Caddy，把 `/`、`/api/`、`/functions/`、`/integrations/` 一并转发到 `127.0.0.1:8787` 即可，后端已自带静态托管与 SPA 回退，不需要另配前端静态目录。
- **持久化**：把 `data/` 目录挂到持久盘并定期备份；容器化时同理作为数据卷。
- **账号初始化**：服务启动时自动创建/校正内置 `admin` 管理员账号；首个通过界面注册的账号会接管旧版 `distiller.db`。生产环境请立即登录 `admin` 改密码，或直接改造 `server/services/auth.js` 里的硬编码逻辑。
- **平台差异**：一键启动与本机代理（`tt-proxy://` 协议、VBS 隐藏启动、HKCU 自启）仅 Windows 可用；Linux/macOS 部署用命令行方式启动，本机代理改用 `node scripts/tt-local-proxy.mjs` 手动运行。
- **可选依赖**：PDF 走 LaTeX 编译需要服务器安装 `xelatex`；pdfkit 回退渲染需要 `CJK_FONT` 指定的中文字体（默认路径是 Linux 路径，Windows/自定义环境务必用 `CJK_FONT` 覆盖）。
- **外部集成**：OpenWiki / TokenTracker 两个外部服务是可选组件，不启用时不要设置相应环境变量即可。

---

## 十四、已知限制与注意点

1. **功能点编辑会在重新评估后丢失**：`syncFeatures` 每次蒸馏/重评先删后建，用户对功能点的收藏状态不保留。
2. **去重不阻止重复机会**：命中 `raw_items.hash` 只复用素材并回传 `duplicated=true`，仍会新建 opportunity。
3. **「保留/舍弃」缺界面入口**：`POST /api/features/:id/status` 有后端与 api 封装，但没有 UI 调用点（未确认产品意图）。
4. **存在未接线页面**：`ImportPage.jsx`、`IntentPmWorkbench.jsx`、`ChangelogPage.jsx` 以及机会池组件 `Opportunities.jsx` / `OpportunityDetail.jsx` 都没有可达菜单入口；后两者仅各有一条来自 `MarketVisual.jsx` / `Opportunities.jsx` 的死导入（import 了但未渲染）。对应接口可用但没有菜单入口。
5. **需求项目无导入入口**：`POST /api/projects/import` 与 `src/api.js` 的 `importProjects` 封装都在，但页面没有调用点，需求项目目前只能新建/编辑。
6. **内置管理员密码硬编码**（`admin` / `123456`），每次启动强制重置，生产部署必须改。
7. **充值/支付是模拟的**：支付宝/微信只作为方式标记，服务端只写记录并即时到账，未接真实支付网关。
8. **TokenTracker 子应用是半成品移植**：UI 与原版一致，但 `/functions/tokentracker-pets`、`achievements`、`usage-limits`、`project-usage-*`、`context-health`、`outcomes`、`usage-category-breakdown`、`project-usage-summary` 等接口在 DIStiller 内返回空桩，相应用量统计的「来源分布」「项目分布」没有本地数据，相关功能只能看版式。
9. **积分模型分流是进程内游标**（`pointsCursor`），多实例部署时各实例独立计数。
10. **本机代理仅 Windows**：`tt-proxy://` 协议注册、VBS 隐藏启动、HKCU 自启均为 Windows 专用；非 Windows 需手动运行 `node scripts/tt-local-proxy.mjs`。
11. **PDF 中文字体路径默认是 Linux 路径**（`/usr/share/fonts/truetype/custom/simhei.ttf`），Windows 下需通过 `CJK_FONT` 覆盖（仓库内未找到 Windows 字体配置）。
12. **声明的 Node 版本偏低**：`package.json` 的 `engines.node` 与 `一键启动.bat` 都写 `>=20.19`，但 [server/dao/db.js:1](server/dao/db.js#L1) 直接 `import { DatabaseSync } from 'node:sqlite'`。`node:sqlite` 自 **v22.5.0** 引入、到 **v22.13.0**（v23 线 v23.4.0）才免 `--experimental-sqlite` 标志，仓库内未传该标志。因此**实际最低版本是 v22.13.0**，在 v20.19–v22.12 上服务会因 `ERR_UNKNOWN_BUILTIN_MODULE` 直接起不来。演示环境若显示正常，只是因为跑在更高版本的 Node 上（如 v24）。

---

## 十五、未确认事项与透明说明

- [server/services/deliverables.js:203](server/services/deliverables.js#L203) 导出 DOCX 时调用了 `markdownToDocx`，但该文件顶部（第 1–9 行的全部 `import`）从未导入它（只导入了 `htmlToDocx` / `htmlToMarkdown` / `textToBasicHtml`）；该函数实际由 [server/utils/docx.js:129](server/utils/docx.js#L129) 导出。当前主流程始终传入 HTML 走另一分支，故未触发；一旦走到这个分支会抛 `ReferenceError`。
- `src/App.jsx` 中管理菜单旁的注释仍写「用户管理 / 作品审核」两项，实际已有 4 项，属过时残留。
- `src/lib/wiki/visualizer.js` 顶部注释仍写依赖库「从 jsdelivr CDN 加载」，但 `src/public/vendor/` 下已放好 `force-graph` / `marked` / `purify` / `mermaid` 四个本地副本并在 `index.html` 注入，属过时残留。
- `server/utils/token-metrics.js` 中有几处注释的汉字被打码为 `?`（与上游来源相关），`server/services/usage.js` 亦存在乱码注释，不建议直接引用其文字。
- `src/public/vendor/mermaid.min.js` 为压缩产物，无法从文件内解析出版本号。
- 译文/文案层面：主应用界面全中文、无 i18n；`src/content/tt/` 下的 `copy.csv`（1473 条文案）与 5 个语种（de / ja / ko / zh / zh-TW）词条**只服务于内嵌的 tt 子树**。

---

## 十六、致谢与来源

本项目的两块重要能力移植自两个开源项目，均在保留原版逻辑的前提下做了适配：

- **TokenTracker（AI 编程用量仪表盘）**：通过**源码抄录**方式并入 `src/components/tt/`、`src/pages/tt/`、`src/hooks/tt/`、`src/lib/tt/`、`src/contexts/tt/`、`src/content/tt/` 等子树，原版样式经 `scripts/build-tt-css.mjs` 作用域化到 `.tt-shell`（输出 `src/styles/tt/tt.css`），数据源从上游改为本项目后端（`/functions/*`）。
- **OpenWiki（知识可视化）**：知识图谱构建 `server/services/wiki-graph.js` 移植自 `openwiki-main/src/visualize/graph.ts`；前端可视化 `src/lib/wiki/visualizer.js` 移植自其 `client.ts` / `client-lib.ts`。为融入本项目做了四处修整：DOM 查询收窄到宿主容器、图谱数据改走本项目 API（`/api/projects/:id/wiki-graph`）、实时刷新由 SSE 改为轮询、星图固定为黑夜主题。
- `src/public/vendor/` 下的 `force-graph` / `marked` / `purify` / `mermaid` 是上述项目所依赖前端库的本地副本，版权归各自上游作者。

---

## 十七、合规与许可

本仓库**未附带 LICENSE，未声明授权方式**。在未获授权前，请勿默认其可自由用于商业或再分发场景；使用前需自行确认授权边界。特别是 `src/**/tt` 等移植自 TokenTracker、`server/services/wiki-graph.js` 与 `src/lib/wiki/visualizer.js` 等移植自 OpenWiki 的部分，其版权与许可归属各自上游项目，沿用时应遵守上游项目的许可条款。
