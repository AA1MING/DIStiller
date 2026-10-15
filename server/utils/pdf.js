import PDFDocument from 'pdfkit'
import { parseMarkdown } from './docx.js'

/**
 * Markdown → PDF：用 pdfkit 渲染，嵌入中文字体（simhei）。
 * 支持模板字号（headingSizes/normalSize）与自动目录（章节名 + 页码）。
 */

export const CJK_FONT = process.env.CJK_FONT || '/usr/share/fonts/truetype/custom/simhei.ttf'

export function markdownToPdf(markdown, title = '文档', fmt = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, info: { Title: title, Creator: 'Demand Distiller' } })
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('cjk', CJK_FONT)
    doc.font('cjk')

    const headingSizes = { 1: fmt.headingSizes?.[1] || 18, 2: fmt.headingSizes?.[2] || 15, 3: fmt.headingSizes?.[3] || 13, 4: fmt.headingSizes?.[4] || 11.5 }
    const normalSize = fmt.normalSize || 10.5
    const W = doc.page.width - 56 * 2
    let y = doc.y
    // 页码跟踪：pdfkit 的 doc.page 是页对象，用 pageAdded 事件计数
    let pageIndex = 0
    doc.on('pageAdded', () => { pageIndex++ })
    const pageNo = () => pageIndex + 1
    const currentPage = () => pageIndex
    let wroteAny = false // 当前页是否已写入内容（判断目录是否可从本页开始）

    const ensure = (need) => { if (y + need > doc.page.height - 56) { doc.addPage(); y = doc.y } }

    const drawTable = (header, rows) => {
      const all = [header, ...rows].filter(Boolean)
      if (!all.length) return
      const colCount = Math.max(...all.map((r) => r.length), 1)
      const colW = Math.min(90, Math.floor(W / colCount))
      const cellPad = 5
      const rowHeights = all.map((r) => {
        let h = 16
        for (let i = 0; i < colCount; i++) {
          const text = String(r[i] || '')
          const lines = doc.heightOfString(text, { width: colW - cellPad * 2, font: 'cjk', fontSize: 9 })
          h = Math.max(h, lines + cellPad * 2)
        }
        return h
      })
      const totalH = rowHeights.reduce((s, h) => s + h, 0)
      ensure(totalH + 20)
      let ty = y
      all.forEach((r, ri) => {
        const h = rowHeights[ri]
        const isHeader = ri === 0 && header
        if (isHeader) { doc.save().rect(56, ty, W, h).fill('#EEF1F5').restore() }
        doc.save().rect(56, ty, W, h).lineWidth(0.5).stroke('#9CA3AF')
        for (let ci = 0; ci < colCount; ci++) {
          const text = String(r[ci] || '')
          doc.font('cjk').fontSize(9).fillColor('#111827')
          doc.text(text, 56 + ci * colW + cellPad, ty + cellPad, { width: colW - cellPad * 2, lineBreak: true })
        }
        ty += h
        if (ri > 0) doc.save().moveTo(56, ty).lineTo(56 + W, ty).lineWidth(0.5).stroke('#D1D5DB').restore()
      })
      y = ty + 14
      doc.moveDown(0.4)
      y = doc.y
    }

    const tocEntries = []
    let tocPage = null
    let bkSeq = 0
    const tokens = parseMarkdown(markdown)
    for (const t of tokens) {
      if (t.type === 'toc') {
        if (tocPage == null) {
          if (!wroteAny) {
            // 当前页尚无内容：直接作为目录页，正文从下一页开始（避免第一页空白）
            tocPage = currentPage()
            doc.addPage()
            y = doc.y
          } else {
            // 前面有封面/前言：目录独占一页 → 正文起始页
            doc.addPage()
            tocPage = currentPage()
            doc.addPage()
            y = doc.y
          }
        }
        continue
      }
      switch (t.type) {
        case 'h1': {
          ensure(40)
          const name = 'toc_' + (++bkSeq)
          doc.addNamedDestination(name, { x: 0, y: y })
          tocEntries.push({ name, title: t.text, level: 1, page: pageNo() })
          doc.font('cjk').fontSize(headingSizes[1]).fillColor('#111827'); doc.text(t.text, { width: W }); doc.moveDown(0.5); y = doc.y
          wroteAny = true
          break
        }
        case 'h2': {
          ensure(30)
          const name = 'toc_' + (++bkSeq)
          doc.addNamedDestination(name, { x: 0, y: y })
          tocEntries.push({ name, title: t.text, level: 2, page: pageNo() })
          doc.font('cjk').fontSize(headingSizes[2]).fillColor('#111827'); doc.text(t.text, { width: W }); doc.moveDown(0.4); y = doc.y
          wroteAny = true
          break
        }
        case 'h3': {
          ensure(24)
          const name = 'toc_' + (++bkSeq)
          doc.addNamedDestination(name, { x: 0, y: y })
          tocEntries.push({ name, title: t.text, level: 3, page: pageNo() })
          doc.font('cjk').fontSize(headingSizes[3]).fillColor('#111827'); doc.text(t.text, { width: W }); doc.moveDown(0.3); y = doc.y
          wroteAny = true
          break
        }
        case 'h4': {
          ensure(22)
          const name = 'toc_' + (++bkSeq)
          doc.addNamedDestination(name, { x: 0, y: y })
          tocEntries.push({ name, title: t.text, level: 4, page: pageNo() })
          doc.font('cjk').fontSize(headingSizes[4]).fillColor('#111827'); doc.text(t.text, { width: W }); doc.moveDown(0.3); y = doc.y
          wroteAny = true
          break
        }
        case 'p':
          ensure(20); doc.font('cjk').fontSize(normalSize).fillColor('#1F2937'); doc.text(t.text, { width: W, lineGap: 3 }); doc.moveDown(0.35); y = doc.y
          wroteAny = true
          break
        case 'li':
          ensure(18); doc.font('cjk').fontSize(normalSize).fillColor('#1F2937'); doc.text(`• ${t.text}`, 56 + 14, y, { width: W - 14, lineGap: 2 }); doc.moveDown(0.3); y = doc.y
          wroteAny = true
          break
        case 'quote':
          ensure(18); doc.font('cjk').fontSize(normalSize - 0.5).fillColor('#64748B'); doc.text(t.text, 56 + 14, y, { width: W - 14, lineGap: 2 }); doc.moveDown(0.3); y = doc.y
          wroteAny = true
          break
        case 'code': {
          const lines = String(t.text || '').split('\n')
          const lh = 13
          const blockH = lines.length * lh + 12
          ensure(blockH + 10)
          doc.save().rect(56, y, W, blockH).fill('#F1F5F9').restore()
          doc.font('Courier').fontSize(8.5).fillColor('#334155')
          lines.forEach((l, i) => doc.text(l, 56 + 10, y + 6 + i * lh, { width: W - 20 }))
          doc.font('cjk')
          y += blockH + 10
          wroteAny = true
          break
        }
        case 'hr': {
          // 不用 save/restore（与 switchToPage 组合会破坏字体状态），直接描线
          ensure(10)
          doc.moveTo(56, y).lineTo(56 + W, y).lineWidth(1).strokeColor('#C4CBD6').stroke()
          y += 16
          wroteAny = true
          break
        }
        case 'table':
          drawTable(t.header, t.rows)
          wroteAny = true
          break
      }
    }

    // 目录页（文档开头占位页）：章节名 + 点线 + 页码
    if (tocPage != null && tocEntries.length) {
      doc.switchToPage(tocPage)
      y = doc.y = 56
      doc.font('cjk').fontSize(headingSizes[1]).fillColor('#111827')
      doc.text('目录', { width: W })
      doc.moveDown(0.8)
      y = doc.y
      for (const e of tocEntries) {
        const fontSize = e.level === 1 ? 11 : e.level === 2 ? 10 : 9.5
        const indent = (e.level - 1) * 14
        const titleW = doc.widthOfString(e.title, { font: 'cjk', fontSize })
        const pageText = String(e.page)
        const pageW = doc.widthOfString(pageText, { font: 'cjk', fontSize })
        const dotsW = W - indent - titleW - pageW - 20
        const dots = dotsW > 8 ? '.'.repeat(Math.max(2, Math.floor(dotsW / 6))) : '  '
        doc.font('cjk').fontSize(fontSize).fillColor(e.level === 1 ? '#111827' : '#475569')
        // 内部链接：点击目录条目跳转到对应章节
        doc.text(e.title, 56 + indent, y, { width: titleW + 2, lineBreak: false, link: '#' + e.name })
        doc.fillColor('#94A3B8').text(dots, 56 + indent + titleW + 4, y, { width: dotsW, lineBreak: false })
        doc.fillColor('#111827').text(pageText, 56 + W - pageW, y, { width: pageW, lineBreak: false })
        y += fontSize + 7
      }
    }
    doc.end()
  })
}
