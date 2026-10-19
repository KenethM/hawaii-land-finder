// Export the sandbox view as a PNG: the canvas exactly as shown, plus a header, north arrow,
// scale bar and a side column with the plan's shapes and notes.

// Computed styles copied onto the cloned SVG so it renders without the page's CSS
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline',
  'paint-order', 'display', 'visibility',
]

export interface ExportSection {
  heading: string
  lines: string[]
}

export interface ExportOptions {
  svg: SVGSVGElement
  rotDeg: number // view rotation (north arrow direction)
  ftPerPx: number
  title: string
  subtitle: string
  sections: ExportSection[]
  footer: string[]
  filename: string
  jpeg?: boolean // photos compress far better as JPEG (PNG of an aerial is ~8 MB)
}

async function toDataUrl(href: string) {
  const blob = await (await fetch(href, { mode: 'cors' })).blob()
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function svgToImage(svg: SVGSVGElement, w: number, h: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll('*')]
  const dst = [clone, ...clone.querySelectorAll('*')]
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')
    dst[i].setAttribute('style', style)
  })
  // Embed aerial tiles so the image is self-contained (the tile server allows cross-origin use)
  await Promise.all(
    [...clone.querySelectorAll('image')].map(async (img) => {
      const href = img.getAttribute('href')
      if (!href) return
      try {
        img.setAttribute('href', await toDataUrl(href))
      } catch {
        img.remove()
      }
    }),
  )
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line)
        line = word
      } else line = test
    }
    out.push(line)
  }
  return out
}

export async function exportPlanPng(o: ExportOptions) {
  const rect = o.svg.getBoundingClientRect()
  const [w, h] = [Math.round(rect.width), Math.round(rect.height)]
  const img = await svgToImage(o.svg, w, h)
  const css = getComputedStyle(o.svg)
  const bg = css.getPropertyValue('--bg').trim() || '#ffffff'
  const text = css.getPropertyValue('--text').trim() || '#1d2329'
  const muted = css.getPropertyValue('--muted').trim() || '#5f6b76'

  const S = 2 // export at 2x for sharpness
  const side = 360
  const head = 70
  const maxW = side - 40

  // Measure the side column first so long notes never run off the image
  const measure = document.createElement('canvas').getContext('2d')!
  let sideH = 10
  for (const s of o.sections) {
    if (!s.lines.length) continue
    measure.font = '13px system-ui, sans-serif'
    sideH += 16 + 12 + s.lines.reduce((n, l) => n + wrap(measure, l, maxW).length * 18 + 2, 0)
  }
  const body = Math.max(h, 400, sideH)
  const foot = 20 + o.footer.length * 16

  const canvas = document.createElement('canvas')
  canvas.width = (w + side) * S
  canvas.height = (body + head + foot) * S
  const ctx = canvas.getContext('2d')!
  ctx.scale(S, S)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w + side, body + head + foot)
  ctx.drawImage(img, 0, head, w, h)

  // Header
  ctx.fillStyle = text
  ctx.font = '700 22px system-ui, sans-serif'
  ctx.fillText(o.title, 20, 32)
  ctx.fillStyle = muted
  ctx.font = '14px system-ui, sans-serif'
  ctx.fillText(o.subtitle, 20, 54)

  // North arrow
  ctx.save()
  ctx.translate(w - 34, head + 34)
  ctx.rotate((o.rotDeg * Math.PI) / 180)
  ctx.fillStyle = '#d1495b'
  ctx.beginPath()
  ctx.moveTo(0, -18)
  ctx.lineTo(9, 10)
  ctx.lineTo(0, 4)
  ctx.lineTo(-9, 10)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = text
  ctx.font = '700 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', 0, 24)
  ctx.restore()

  // Scale bar
  const scaleFt = [5, 10, 20, 50, 100, 200, 500].find((f) => f / o.ftPerPx >= 70) ?? 500
  const barPx = scaleFt / o.ftPerPx
  ctx.strokeStyle = text
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(20, head + h - 26)
  ctx.lineTo(20, head + h - 20)
  ctx.lineTo(20 + barPx, head + h - 20)
  ctx.lineTo(20 + barPx, head + h - 26)
  ctx.stroke()
  ctx.fillStyle = text
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(`${scaleFt} ft`, 20, head + h - 30)

  // Side column
  let y = head + 10
  const x = w + 20
  for (const s of o.sections) {
    if (!s.lines.length) continue
    ctx.fillStyle = muted
    ctx.font = '700 12px system-ui, sans-serif'
    ctx.fillText(s.heading.toUpperCase(), x, (y += 16))
    ctx.fillStyle = text
    ctx.font = '13px system-ui, sans-serif'
    for (const l of s.lines) {
      for (const wl of wrap(ctx, l, maxW)) ctx.fillText(wl, x, (y += 18))
      y += 2
    }
    y += 12
  }

  // Footer
  ctx.fillStyle = muted
  ctx.font = '11px system-ui, sans-serif'
  o.footer.forEach((f, i) => ctx.fillText(f, 20, head + body + 18 + i * 16))

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, o.jpeg ? 'image/jpeg' : 'image/png', 0.88))
  if (!blob) throw new Error('Could not create image')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = o.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
