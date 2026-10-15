/**
 * Wiki 知识库原生生成：不依赖 openwiki CLI，直接把项目与功能点写成 OpenWiki
 * 兼容的知识库结构（index.md 项目中心 + 每个功能点独立页面，frontmatter 带
 * title/description/type/tags），随后由移植的 buildGraph 构建图谱。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { getProject } from './projects.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECTS_DIR = path.resolve(__dirname, '../../data/openwiki-projects')

function projectDir(projectId) {
  const id = String(projectId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = path.resolve(PROJECTS_DIR, id)
  if (!dir.startsWith(PROJECTS_DIR + path.sep)) throw new Error('非法项目目录')
  return dir
}

function slugify(value, index) {
  // 文件名只保留 ASCII（云部署构建上下文不支持中文/非 UTF-8 文件名），真实标题存于 frontmatter
  const base = String(value || `feature-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || `feature-${index + 1}`
}

function q(s) {
  return String(s || '').replace(/"/g, "'").replace(/\r?\n/g, ' ')
}

/**
 * 生成项目 Wiki（项目中心 + 功能点分支），返回生成结果。
 * 保留既有生成物时增量覆盖，无需外部工具或网络。
 */
export async function generateProjectWiki(projectId) {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const features = Array.isArray(project.features) ? project.features.filter((f) => f && f.status !== 'dropped') : []
  const wikiDir = path.join(projectDir(projectId), 'openwiki')

  await rm(wikiDir, { recursive: true, force: true })
  await mkdir(wikiDir, { recursive: true })

  // 项目中心页（图谱的锚点节点）
  const featureLinks = features
    .map((f, i) => `- [${q(f.title)}](features/${slugify(f.title, i)}.md)`)
    .join('\n')
  const indexBody = `---
title: "${q(project.title)}"
description: "${q(project.description) || q(project.theme) || 'Distiller 项目'}"
type: Project
tags:
  - project
---

# ${q(project.title)}

${q(project.description) || ''}

> 主题：${q(project.theme) || '未设置'} · 功能点：${features.length} 个

## 功能点

${featureLinks || '- 暂无功能点'}

## 说明

本知识库由需求分析蒸馏器自动生成：项目为中心节点，功能点为分支节点。
点击图谱节点或左侧索引可阅读每个功能点的详情。
`

  await mkdir(path.join(wikiDir, 'features'), { recursive: true })
  await writeFile(path.join(wikiDir, 'index.md'), indexBody, 'utf8')

  const written = []
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    const slug = slugify(f.title, i)
    const body = `---
title: "${q(f.title)}"
description: "${q(f.description) || ''}"
type: Feature
tags:
  - ${q(f.priority || 'P1')}
---

# ${q(f.title)}

${q(f.description) || '暂无描述'}

## 基本信息

- 优先级：${q(f.priority || 'P1')}
- 状态：${f.status === 'kept' ? '保留' : '已舍弃'}
- 来源：${q(f.opportunity_title) || '手动录入'}

## 关联

- 所属项目：[${q(project.title)}](../index.md)
`
    await writeFile(path.join(wikiDir, 'features', `${slug}.md`), body, 'utf8')
    written.push(slug)
  }

  return { ok: true, projectId: Number(projectId), title: project.title, features: written.length, wikiDir }
}
