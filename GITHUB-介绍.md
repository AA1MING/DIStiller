# GitHub 仓库页面介绍文案

仓库：https://github.com/AA1MING/DIStiller
当前状态：仓库已创建但为空（0 KB、无提交、无 Description、无 Topics），所以 GitHub 页面上现在什么都不显示。

以下文本已按仓库真实代码核查过，可直接粘贴。

---

## 1. About 简介（仓库页右上角齿轮 → Description）

粘贴位置：仓库首页右上角 **⚙️ Edit repository details** → **Description** 框。

```
需求分析蒸馏器：把对话、粘贴文本、txt/md/json/csv/docx、AI 对话导出、项目 zip 等碎片素材蒸馏成产品机会与功能点，产出市场分析、PRD、交互原型、Word/PDF/LaTeX 文档与 AI 编程提示词。Windows 双击一键启动，不填 API Key 也能离线跑通全链路；一个对话即一个项目，多用户按人分库，内嵌 AI 编程用量仪表盘，适合本机/内网私有化部署。
```

字符数：195（GitHub 上限 350）

### 英文版（备用，仓库若面向英文读者）

```
Demand Distiller turns chats, pasted text, txt/md/json/csv/docx, AI chat exports and project zips into product opportunities, market analysis, PRDs, prototypes, Word/PDF/LaTeX docs and AI-coding prompts. One-click Windows start, works offline without API keys, one chat = one project, per-user SQLite DBs for self-hosting.
```

字符数：322（GitHub 上限 350）

---

## 2. Topics 标签（同一弹窗里的 Topics 框）

逐个输入（回车分隔），共 20 个 —— GitHub 上限就是 20：

```
react
vite
nodejs
node-sqlite
sse
streaming
document-generation
docx
latex
llm
prompt-engineering
product-management
prd
ai-agents
self-hosted
offline-first
multi-user
windows
tailwindcss
openai
```

---

## 3. 一句话定位（README 顶部 / 社交分享副标题）

```
把对话与零散素材蒸馏成 PRD、原型和开发提示词，Windows 双击开箱即用
```

---

## 4. 建议补充的 GitHub 附带信息

- **Website**：留空（仓库没有独立站点或在线 Demo）
- **Releases / Packages**：暂不需要
- **License**：仓库无 LICENSE 文件，GitHub 会显示 "No license"。若打算公开给他人使用，建议补一个（例如 MIT），否则别人默认无权使用与再分发。

---

## 说明：为什么介绍里不写 Node 版本

核查时发现一个真实问题：`package.json` 的 `engines.node` 和 `一键启动.bat` 的校验都写 `>=20.19`，但 [server/dao/db.js:1](server/dao/db.js#L1) 直接 `import { DatabaseSync } from 'node:sqlite'`，而 `node:sqlite` 自 Node **v22.5.0** 才引入、到 **v22.13.0**（v23 线 v23.4.0）才免 `--experimental-sqlite` 标志，仓库内未传该标志。**所以实际最低版本是 v22.13.0**，写 20.19 会误导 Windows 用户装低版本后起不来。

因此上面的 About 文案里**故意不带版本号**。若要带，请写 `Node ≥ 22.13`。README 已就此更正并加了显式提示。
