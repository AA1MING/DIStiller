// 生成 src/styles/tt/tt.css —— 把原版 TokenTracker 的 styles.css 与 Tailwind 编译产物
// 全部作用域化到 `.tt-shell` 容器内，避免污染 demand-distiller 主应用样式；
// 同时保留原版 100% 视觉与动画（机械抄录，不改动任何规则）。
//
// 用法：node scripts/build-tt-css.mjs
// 输出：src/styles/tt/tt.css（由 src/main.jsx 引入）

import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const ROOT = process.cwd();

// ---------------------------------------------------------------- selectors

/** 按顶层逗号切分选择器列表（跳过括号/方括号内的逗号） */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  const last = cur.trim();
  if (last) out.push(last);
  return out;
}

/**
 * 把单个选择器作用域化到 .tt-shell：
 *  - :root[.dark] / :host / html / body -> .tt-shell[.dark]
 *  - 通用选择器 * / ::before / ::after -> 覆盖 shell 自身与所有后代
 *  - 其余 -> .tt-shell <selector>
 */
function scopeSelector(sel) {
  let s = sel.trim();
  if (!s) return null;

  if (s === ":root") return ".tt-shell";
  if (s === ":root.dark") return ".tt-shell.dark";

  // :root.dark .oai-card 这类复合
  s = s.replace(/:root\.dark/g, ".tt-shell.dark").replace(/:root\b/g, ".tt-shell");
  s = s.replace(/:host\b/g, ".tt-shell");
  s = s.replace(/^html\b/, ".tt-shell");

  if (s === "body") return ".tt-shell";
  if (s === "*") return ".tt-shell, .tt-shell *";
  if (s === "::before" || s === "::after" || s === "::-webkit-scrollbar" || s === "::backdrop") {
    return `.tt-shell${s}, .tt-shell *${s}`;
  }
  if (s === ":-moz-focusring" || s === ":-moz-ui-invalid") {
    return `.tt-shell ${s}`;
  }
  // 已是 .tt-shell 前缀（上面的替换结果）则不重复加
  if (s.startsWith(".tt-shell")) return s;
  return `.tt-shell ${s}`;
}

function scopeSelectorList(list) {
  const parts = splitSelectors(list);
  const out = [];
  for (const p of parts) {
    const scoped = scopeSelector(p);
    if (scoped) out.push(scoped);
  }
  return out.join(", ");
}

// ------------------------------------------------------------------ walk

function isKeyframesParent(atRule) {
  return atRule && atRule.type === "atrule" && atRule.name === "keyframes";
}

/** 递归作用域化一棵 postcss 树；@layer 会被解开（内层规则先转换再提升到外层） */
function processNode(node) {
  if (node.type === "rule") {
    if (isKeyframesParent(node.parent)) return;
    const next = scopeSelectorList(node.selector);
    if (next) node.selector = next;
    else node.remove();
    return;
  }
  if (node.type === "atrule") {
    if (node.name === "keyframes" || node.name === "font-face") return;
    if (node.name === "layer") {
      const children = [...(node.nodes || [])];
      children.forEach((c) => processNode(c));
      const parent = node.parent;
      const idx = parent.index(node);
      children.forEach((child, i) => parent.insertBefore(idx + i, child));
      node.remove();
      return;
    }
    node.nodes?.forEach((c) => processNode(c));
  }
}

function scopeTree(root) {
  // 快照遍历：@layer 解包会原地增删节点，避免在活数组上 forEach 时跳项
  const top = [...root.nodes];
  for (const node of top) {
    if (node.parent) processNode(node);
  }
}

// ---------------------------------------------------------- transform css

function transformCss(cssText, from) {
  const parsed = postcss.parse(cssText, { from });
  scopeTree(parsed);
  return parsed.toString();
}

// ------------------------------------------------------------ tailwind

async function buildTailwind() {
  const srcPath = path.join(ROOT, "src/styles/tt/_tt-src.css");
  const src = fs.readFileSync(srcPath, "utf8");
  const result = await postcss([
    tailwindcss({ config: path.join(ROOT, "tailwind.config.cjs") }),
  ]).process(src, { from: srcPath });
  return transformCss(result.css, srcPath);
}

// ------------------------------------------------------------- styles.css

function buildStylesCopy() {
  const src = fs.readFileSync(path.join(ROOT, "src/styles/tt/_tt-styles-src.css"), "utf8");
  // 去掉开头的 @tailwind 指令行（由 buildTailwind 单独处理）
  const withoutDirectives = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("@tailwind"))
    .join("\n");
  return transformCss(withoutDirectives, "src/styles/tt/_tt-styles-src.css");
}

// ------------------------------------------------------------ neutralizer

const NEUTRALIZER = `
/* ----------------------------------------------------------------
   主应用全局元素样式中和：作用域内还原原版 preflight/reset 语义，
   防止 demand-distiller 的全局元素规则渗入 TT 页面。
   （原版 preflight 不设置这些属性；这里显式还原默认值，效用同上。）
---------------------------------------------------------------- */
.tt-shell h1, .tt-shell h2, .tt-shell h3, .tt-shell h4, .tt-shell h5, .tt-shell h6 {
  font-family: inherit;
  font-weight: inherit;
  letter-spacing: normal;
  line-height: inherit;
}
.tt-shell input, .tt-shell select, .tt-shell textarea {
  width: auto;
  color: inherit;
  background: transparent;
  border: 0 solid;
  border-radius: 0;
  padding: 0;
  caret-color: auto;
}
.tt-shell table { color: inherit; }
.tt-shell th { color: inherit; }
.tt-shell a { color: inherit; }
`;

// ------------------------------------------------------------------ main

const header = `/* 自动生成：node scripts/build-tt-css.mjs —— 请勿手改。
   来源：src/styles/tt/_tt-styles-src.css（原版抄录，作用域化到 .tt-shell）
        + src/styles/tt/_tt-src.css（Tailwind preflight + utilities，作用域化） */`;

const out = [header, NEUTRALIZER, buildStylesCopy(), await buildTailwind()].join("\n");

const outPath = path.join(ROOT, "src/styles/tt/tt.css");
fs.writeFileSync(outPath, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`OK → src/styles/tt/tt.css (${kb} KB)`);
