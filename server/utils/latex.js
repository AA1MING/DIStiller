import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHtml, markToc, nodeText, stripFence } from './html.js'

/**
 * HTML → LaTeX → PDF（xelatex 编译）。
 * - htmlToLatex：HTML（内联样式）→ LaTeX 源文本（ctexart + fandol 中文字体）
 * - texToPdf：xelatex 编译 .tex → PDF Buffer（目录自动两次编译生成页码）
 * 模板上传 .tex 时仅用于 PDF 导出；Word / Markdown 导出不受影响。
 */

/** LaTeX 特殊字符转义（除 verbatim 环境外所有文本都要转义）。 */
export function latexEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%&$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

/** 行内内容：**粗体** → \textbf、`代码` → \texttt、<strong>/<em> 等。 */
function inlineLatex(children) {
  let out = ''
  for (const c of children || []) {
    if (c.text != null) { out += latexEscape(c.text); continue }
    const inner = inlineLatex(c.children)
    if (c.tag === 'strong' || c.tag === 'b') out += `\\textbf{${inner}}`
    else if (c.tag === 'em' || c.tag === 'i') out += `\\textit{${inner}}`
    else if (c.tag === 'code') out += `\\texttt{${inner}}`
    else if (c.tag === 'br') out += '\\\\'
    else out += inner
  }
  return out
}

function tableToLatex(n) {
  const rows = (n.children || []).filter((c) => c.tag === 'tr')
  const allRows = rows.map((r) => (r.children || []).filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => inlineLatex(c.children)))
  if (!allRows.length) return ''
  const cols = Math.max(...allRows.map((r) => r.length), 1)
  const head = allRows.length > 1 ? allRows[0] : null
  const body = head ? allRows.slice(1) : allRows
  const spec = '|' + 'l|'.repeat(cols)
  const escRow = (r) => Array.from({ length: cols }, (_, i) => r[i] || '').join(' & ')
  let out = '\\begin{center}\n\\begin{tabular}{' + spec + '}\n\\hline\n'
  if (head) out += escRow(head) + ' \\\\ \\hline\n'
  for (const r of body) out += escRow(r) + ' \\\\ \\hline\n'
  out += '\\end{tabular}\n\\end{center}'
  return out
}

function codeToLatex(text) {
  const clean = String(text || '').replace(/\\end\{verbatim\}/g, '\\end\\{verbatim\\}')
  return '\\begin{verbatim}\n' + clean + '\n\\end{verbatim}'
}

function renderBlocks(nodes, out) {
  for (const n of nodes) {
    if (n.text != null) { const t = n.text.trim(); if (t) { out.push(latexEscape(t)); out.push('') } continue }
    const tag = n.tag
    if (tag === 'head' || tag === 'title' || tag === 'style' || tag === 'script' || tag === 'meta') continue
    if (tag === 'toc') { out.push('\\tableofcontents'); out.push(''); continue }
    if (tag === 'h1') { out.push(`\\section{${inlineLatex(n.children)}}`); out.push(''); continue }
    if (tag === 'h2') { out.push(`\\subsection{${inlineLatex(n.children)}}`); out.push(''); continue }
    if (tag === 'h3') { out.push(`\\subsubsection{${inlineLatex(n.children)}}`); out.push(''); continue }
    if (tag === 'h4') { out.push(`\\paragraph{${inlineLatex(n.children)}}`); out.push(''); continue }
    if (tag === 'p') { const t = inlineLatex(n.children); if (t.trim()) { out.push(t); out.push('') } continue }
    if (tag === 'ul') { out.push('\\begin{itemize}'); renderBlocks(n.children, out); out.push('\\end{itemize}'); out.push(''); continue }
    if (tag === 'ol') { out.push('\\begin{enumerate}'); renderBlocks(n.children, out); out.push('\\end{enumerate}'); out.push(''); continue }
    if (tag === 'li') { out.push('\\item ' + inlineLatex(n.children)); continue }
    if (tag === 'table') { const t = tableToLatex(n); if (t) { out.push(t); out.push('') } continue }
    if (tag === 'pre') { out.push(codeToLatex(nodeText(n))); out.push(''); continue }
    if (tag === 'blockquote') { out.push('\\begin{quote}'); out.push(inlineLatex(n.children)); out.push('\\end{quote}'); out.push(''); continue }
    if (tag === 'hr') { out.push('\\hrulefill'); out.push(''); continue }
    // div/section/span/body 等容器：递归
    renderBlocks(n.children || [], out)
  }
}

/** HTML → 完整 LaTeX 文档（ctexart + fandol 中文字体 + geometry 页面）。 */
export function htmlToLatex(html, title = '文档') {
  const nodes = markToc(parseHtml(stripFence(html)))
  const body = []
  renderBlocks(nodes, body)
  return `\\documentclass[12pt,fontset=fandol]{ctexart}
\\usepackage[a4paper,top=2.5cm,bottom=2.5cm,left=2.8cm,right=2.8cm]{geometry}
\\begin{document}
${title ? `\\begin{center}\\Large\\textbf{${latexEscape(title)}}\\end{center}\n\n` : ''}${body.join('\n')}
\\end{document}
`
}

/** xelatex 编译 .tex → PDF Buffer。编译两次保证目录页码正确；失败抛错（附 log 摘要）。 */
export function texToPdf(tex) {
  const dir = mkdtempSync(join(tmpdir(), 'distiller-tex-'))
  const file = join(dir, 'main.tex')
  writeFileSync(file, tex, 'utf8')
  try {
    for (let i = 0; i < 2; i++) {
      const r = spawnSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', '-output-directory=' + dir, 'main.tex'], { cwd: dir, timeout: 180000 })
      if (r.status !== 0) {
        let log = ''
        try {
          log = readFileSync(join(dir, 'main.log'), 'utf8')
            .split('\n').filter((l) => /^!/.test(l)).slice(0, 6).join('\n')
        } catch { /* 无日志 */ }
        throw new Error(`LaTeX 编译失败${log ? '：' + log : '（xelatex 不可用）'}`)
      }
    }
    return readFileSync(join(dir, 'main.pdf'))
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败忽略 */ }
  }
}
