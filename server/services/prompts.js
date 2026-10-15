import { db } from '../dao/db.js'
import { getProject, listProjects } from './projects.js'
import { getAiSettings, chatText, UNIFIED_SYSTEM_PROMPT } from './ai.js'

/**
 * 项目开发提示词生成：
 * - 选择目标 AI 编程 Agent（Claude Code / Codex / Zed / Trae / OpenCode / 通用）
 * - 结合项目真实数据（标题 / 简介 / 功能点 / 代码逻辑），生成一份详细的「项目开发提示词」：
 *   项目概述、技术栈选型、项目架构、功能点清单、开发阶段、输出约定
 * - 有 AI 时按工具模板定制生成；无 AI 时本地按模板结构拼装（离线可用）
 */

export const CODING_AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    desc: 'Anthropic 终端编程助手，适合 CLAUDE.md 风格项目说明',
    file: 'CLAUDE.md',
    rules: '明确项目结构、技术栈与命令约定；避免与代码库冲突的假设；分步骤执行并汇报。',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    desc: 'OpenAI 编程 Agent，适合 AGENTS.md 风格项目说明',
    file: 'AGENTS.md',
    rules: '先读取项目说明再动手；技术栈与架构需给出理由；每阶段完成后小结进度。',
  },
  {
    id: 'zed',
    name: 'Zed AI',
    desc: 'Zed 编辑器的 AI 助手，适合项目上下文说明',
    file: '项目说明文档',
    rules: '聚焦当前工作区；先确认架构与技术栈；改动需说明影响范围。',
  },
  {
    id: 'trae',
    name: 'Trae AI IDE',
    desc: '字节旗下 AI IDE，适合完整项目 Brief',
    file: 'PROJECT.md',
    rules: '按 Brief 分模块交付；每个功能点给出实现要点；生成可运行的最小版本优先。',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    desc: '开源终端 AI 编程 Agent，适合命令行驱动开发',
    file: 'AGENTS.md',
    rules: '支持多 Agent 分工；明确任务边界与验收标准；避免覆盖已有代码。',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    desc: 'Google Gemini 终端编程助手，适合 AGENTS.md 风格项目说明',
    file: 'AGENTS.md',
    rules: '强调代码可读性与测试；按模块交付并给出变更说明；遵循 AGENTS.md 约定。',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    desc: 'Cursor 编辑器 AI，适合 .cursor/rules 风格项目规则',
    file: '.cursor/rules',
    rules: '先读取项目规则再动手；改动聚焦当前文件与调用链；每个改动附带影响说明。',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    desc: 'Google Antigravity，适合云端多 Agent 协作开发',
    file: 'AGENTS.md',
    rules: '明确任务拆分与验收标准；利用并行 Agent 加速；最终合并时保证一致性。',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    desc: 'GitHub Copilot CLI，适合 AGENTS.md 风格项目说明',
    file: 'AGENTS.md',
    rules: '按步骤执行并汇报；先理解再修改；保持最小改动与可编译。',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    desc: 'Windsurf（Codeium）AI IDE，适合全局上下文与快速迭代',
    file: '.windsurf/rules',
    rules: '聚焦当前工作区；小步迭代并随时可运行；避免无关重构。',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    desc: 'Hermes，适合轻量快速的终端 AI 编程',
    file: 'AGENTS.md',
    rules: '快速生成可运行原型；先跑通核心链路再完善细节；保持代码整洁。',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    desc: 'Kiro，适合专注流式开发的 AI 助手',
    file: 'AGENTS.md',
    rules: '按功能点逐个交付；每个功能附带自测；保持接口稳定。',
  },
  {
    id: 'generic',
    name: '通用开发提示词',
    desc: '不限定工具，适合粘贴到任意 AI 编程助手',
    file: 'PROJECT_BRIEF.md',
    rules: '通用工程规范：先架构后实现、最小可用优先、保持代码可维护。',
  },
]

export function listAgentTemplates() {
  return CODING_AGENTS.map((t) => ({ id: t.id, name: t.name, desc: t.desc }))
}

/** 收集项目数据（功能点 + 简介 + 代码逻辑摘要），供提示词生成使用。 */
function collectProjectForPrompt(project) {
  if (!project) return null
  const feats = (project.features || [])
    .filter((f) => f.status !== 'dropped')
    .map((f) => ({ title: f.title, description: f.description || '', priority: f.priority || 'P1' }))
  return {
    projectTitle: project.title || '',
    theme: project.theme || '',
    description: project.description || '',
    features: feats,
    codeLogic: project.code_logic ? String(project.code_logic).slice(0, 4000) : '',
  }
}

/** 本地回退：按模板结构 + 项目数据拼装开发提示词（架构/技术栈留白由目标 Agent 补全）。 */
function buildLocalPrompt(tpl, data) {
  const feats = data.features.length
    ? data.features.map((f) => `- ${f.title}（${f.priority}）${f.description ? `：${f.description}` : ''}`).join('\n')
    : '（暂无功能点，请与需求方确认）'
  return `# 项目开发任务（目标工具：${tpl.name}）

## 1. 项目概述
- 项目名称：${data.projectTitle}
${data.theme ? `- 产品主题：${data.theme}\n` : ''}${data.description ? `- 项目简介：${data.description}\n` : ''}- 目标：请把下面的功能点实现为一个可运行的项目。

## 2. 功能点清单（必须全部实现）
${feats}

## 3. 技术栈选型（请你设计，并给出理由）
- 前端框架 / 后端框架 / 数据库 / 部署方式
- 根据功能点复杂度选择最简可行方案

## 4. 项目架构（请你设计）
- 目录结构（modules / components / routes / services 等）
- 模块划分与数据流
- 关键接口约定

## 5. 开发阶段
1. 初始化项目骨架与依赖
2. 实现核心数据模型与接口
3. 按优先级实现各功能点（P0 → P1 → P2）
4. 联调、边界处理与基础测试
5. 补充 README 与运行说明

## 6. 输出约定（${tpl.name}）
${tpl.rules}
${tpl.file ? `建议以「${tpl.file}」形式保存本说明，供后续会话复用。` : ''}
`
}

/** 生成项目开发提示词：AI 定制生成（架构/技术栈/阶段），失败/未配置时本地拼装。 */
export async function generateProjectPrompt({ projectId = null, templateId = null }) {
  const project = projectId
    ? (getProject(projectId) || listProjects().find((p) => String(p.id) === String(projectId)) || null)
    : null
  if (!project) throw new Error('请先选择项目')
  const tpl = CODING_AGENTS.find((t) => t.id === templateId) || CODING_AGENTS[0]
  const data = collectProjectForPrompt(project)

  const ai = getAiSettings()
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    try {
      const userMsg = `[mode:prompt]\n请为下面这个项目生成一份完整的「项目开发提示词」，用于交给 ${tpl.name}（${tpl.file || 'AI 编程助手'}）直接开始开发。提示词必须包含：\n1. 项目概述（背景/目标/定位）\n2. 技术栈选型：给出具体方案（前端/后端/数据库/部署）并说明理由，选型要贴合功能点、尽量主流简单\n3. 项目架构：目录结构（用代码块展示）、模块划分、数据流、核心接口\n4. 功能点清单：逐一列出并标注优先级，说明每个功能点的实现要点\n5. 开发阶段：从初始化到交付的分阶段任务\n6. 输出约定：适配 ${tpl.name}（${tpl.rules}）\n语言精炼、可直接粘贴执行，不要编造项目数据之外的需求。\n\n【项目信息】\n${JSON.stringify(data, null, 2)}`
      const content = await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'prompt' })
      const prompt = String(content || '').trim()
      if (prompt.length > 20) return { prompt, template: { id: tpl.id, name: tpl.name, desc: tpl.desc }, title: project.title }
    } catch { /* 回退本地 */ }
  }
  return { prompt: buildLocalPrompt(tpl, data), template: { id: tpl.id, name: tpl.name, desc: tpl.desc }, title: project.title }
}
