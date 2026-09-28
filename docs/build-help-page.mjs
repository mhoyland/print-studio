// Builds the Print Studio user guide web page from docs/user-guide.md.
//
//   node docs/build-help-page.mjs <output folder>
//   e.g. node docs/build-help-page.mjs ~/Widget-Experience/help
//
// Writes <output folder>/index.html and copies docs/images/ next to it. Screenshots that don't exist
// yet appear as labelled placeholder boxes, so the page can be published before they're all taken.
// Uses `marked`, which the Experience Builder client already installs (run from inside the client).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const docsDir = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] ?? join(docsDir, 'site'))
const imagesDir = join(docsDir, 'images')

const markdown = readFileSync(join(docsDir, 'user-guide.md'), 'utf8')

// GitHub-style heading ids, so the guide's own #links work the same on GitHub and on the site.
const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

let body = marked.parse(markdown, { gfm: true })
const contents = []
body = body.replace(/<h([23])>(.*?)<\/h\1>/g, (_match, level, inner) => {
  const id = slug(inner)
  if (level === '2') contents.push({ id, text: inner.replace(/<[^>]+>/g, '') })
  return `<h${level} id="${id}">${inner}</h${level}>`
})
const title = (body.match(/<h1>(.*?)<\/h1>/) ?? [])[1] ?? 'User guide'

// Screenshots: a real image in a figure when the file exists, otherwise a placeholder saying what goes there.
const missing = []
body = body.replace(/<p><img src="images\/([^"]+)" alt="([^"]*)"\s*\/?><\/p>/g, (_match, file, alt) => {
  if (existsSync(join(imagesDir, file))) {
    return `<figure><img src="images/${file}" alt="${alt}" loading="lazy"><figcaption>${alt}</figcaption></figure>`
  }
  missing.push(file)
  return `<figure class="missing" role="img" aria-label="Screenshot to come: ${alt}"><div><strong>Screenshot to come</strong><span>${alt}</span><code>images/${file}</code></div></figure>`
})
// Wide tables scroll sideways on narrow screens instead of widening the page.
body = body.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')

const toc = contents.map(({ id, text }) => `<li><a href="#${id}">${text}</a></li>`).join('')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="How to print maps with Print Studio, and how to design its print templates in ArcGIS Experience Builder.">
<style>
  :root {
    --bg: #fbfaf9; --surface: #ffffff; --text: #1f1d1b; --muted: #5f5a55; --border: #e2ddd8;
    --accent: #6a14a8; --accent-soft: #f3ebfa; --code-bg: #f1eeeb; --placeholder: #f6f2ee;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #1b1a19; --surface: #232220; --text: #ece9e6; --muted: #a9a39d; --border: #3a3733;
      --accent: #c89bf0; --accent-soft: #2e2536; --code-bg: #2c2a27; --placeholder: #292725;
    }
  }
  :root[data-theme="dark"] {
    --bg: #1b1a19; --surface: #232220; --text: #ece9e6; --muted: #a9a39d; --border: #3a3733;
    --accent: #c89bf0; --accent-soft: #2e2536; --code-bg: #2c2a27; --placeholder: #292725;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--accent); }
  header.site { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 16px; }
  header.site .inner { max-width: 1120px; margin: 0 auto; display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  header.site .brand { font-weight: 650; }
  .layout { max-width: 1120px; margin: 0 auto; padding: 0 16px 64px; display: grid; grid-template-columns: 1fr; gap: 32px; }
  nav.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-top: 24px; }
  nav.toc h2 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; padding: 0; border: 0; }
  nav.toc ol { margin: 0; padding-left: 20px; }
  nav.toc li { margin: 4px 0; }
  main { min-width: 0; max-width: 72ch; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 32px 0 16px; }
  h2 { font-size: 1.45rem; margin: 48px 0 12px; padding-top: 8px; border-top: 1px solid var(--border); scroll-margin-top: 16px; }
  h3 { font-size: 1.15rem; margin: 32px 0 8px; scroll-margin-top: 16px; }
  h4 { font-size: 1rem; margin: 24px 0 8px; }
  code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: .9em; }
  .table-wrap { overflow-x: auto; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; background: var(--surface); font-size: .95rem; }
  th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: var(--accent-soft); }
  figure { margin: 20px 0; }
  figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 6px; }
  figcaption { color: var(--muted); font-size: .9rem; margin-top: 6px; }
  figure.missing div { display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; text-align: center;
    min-height: 160px; padding: 16px; border: 2px dashed var(--border); border-radius: 6px; background: var(--placeholder); color: var(--muted); }
  figure.missing strong { color: var(--text); }
  @media (min-width: 960px) {
    .layout { grid-template-columns: 240px 1fr; }
    nav.toc { position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow: auto; }
  }
  @media print {
    header.site, nav.toc { display: none; }
    .layout { display: block; }
    h2 { break-after: avoid; }
    figure { break-inside: avoid; }
  }
</style>
</head>
<body>
<header class="site"><div class="inner">
  <span class="brand">Print Studio · User guide</span>
  <a href="../">← Back to the demo app</a>
</div></header>
<div class="layout">
  <nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>${toc}</ol></nav>
  <main>
${body}
  </main>
</div>
</body>
</html>
`

mkdirSync(join(outDir, 'images'), { recursive: true })
writeFileSync(join(outDir, 'index.html'), html)
for (const file of existsSync(imagesDir) ? readdirSync(imagesDir) : []) {
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(file)) copyFileSync(join(imagesDir, file), join(outDir, 'images', file))
}
console.log(`Wrote ${join(outDir, 'index.html')}`)
if (missing.length) console.log(`Screenshots still to add to docs/images/: ${missing.join(', ')}`)
