export function hexToRgb(hex) {
  let h = (hex || '#FFFFFF').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToCss({ r, g, b }) {
  return `rgb(${r},${g},${b})`
}

export function isTooGreen(rgb) {
  const dr = rgb.r
  const dg = rgb.g - 255
  const db = rgb.b
  return Math.sqrt(dr * dr + dg * dg + db * db) < 150
}

function mixMono(channels) {
  const n = channels.length
  if (n === 0) return new Float32Array(0)
  if (n === 1) return channels[0]
  const len = channels[0].length
  const mono = new Float32Array(len)
  for (let c = 0; c < n; c++) {
    const ch = channels[c]
    const m = Math.min(len, ch.length)
    for (let i = 0; i < m; i++) mono[i] += ch[i]
  }
  for (let i = 0; i < len; i++) mono[i] /= n
  return mono
}

export function computeWaveformFrames(channels, sampleRate, { numBars = 90, fps = 30 } = {}) {
  const mono = mixMono(channels)
  const len = mono.length
  const samplesPerSlice = Math.max(1, Math.round(sampleRate / fps))
  const count = Math.max(1, Math.ceil(len / samplesPerSlice))
  const data = new Float32Array(count * numBars)
  const step = samplesPerSlice / numBars >= 4 ? 2 : 1
  let globalMax = 0

  for (let f = 0; f < count; f++) {
    const start = f * samplesPerSlice
    const end = Math.min(len, start + samplesPerSlice)
    const samplesPerBar = (end - start) / numBars
    const base = f * numBars
    for (let j = start; j < end; j += step) {
      const v = mono[j]
      const a = v < 0 ? -v : v
      const bar = Math.min(numBars - 1, Math.floor((j - start) / samplesPerBar))
      const idx = base + bar
      if (a > data[idx]) data[idx] = a
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (data[i] > globalMax) globalMax = data[i]
  }

  return { data, numBars, count, globalMax }
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, w, h)
  }
}

function drawName(ctx, size, name, rgb) {
  const maxWidth = size - 200
  let fontSize = 68
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'
  do {
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
    if (ctx.measureText(name).width <= maxWidth || fontSize <= 24) break
    fontSize -= 4
  } while (true)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillText(name, size / 2 + 3, size * 0.17 + 3)
  ctx.fillStyle = rgbToCss(rgb)
  ctx.fillText(name, size / 2, size * 0.17)
  ctx.restore()
}

function drawProgress(ctx, size, progress) {
  const x = 90
  const y = size - 52
  const w = size - 180
  const h = 8
  const r = h / 2

  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  roundRect(ctx, x, y, w, h, r)

  const fw = Math.max(r * 2, w * progress)
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, x, y, fw, h, r)
}

export function createAnimator(frameData, { size = 1080 } = {}) {
  const { data, numBars, count, globalMax } = frameData
  const display = new Float32Array(numBars)
  let lastMs = null

  const padX = 90
  const top = size * 0.36
  const bottom = size * 0.64
  const centerY = (top + bottom) / 2
  const maxH = (bottom - top) / 2
  const minH = 6
  const gap = 3
  const totalGap = gap * (numBars - 1)
  const barW = Math.max(2, (size - padX * 2 - totalGap) / numBars)
  const radius = Math.min(barW / 2, 8)
  const norm = globalMax > 0 ? 1 / globalMax : 1

  const fade = size * 0.16
  const ENV_FLOOR = 0.45
  const waveformRight = padX + numBars * (barW + gap)
  const alphas = new Float32Array(numBars)
  const envelope = new Float32Array(numBars)
  const smooth = (t) => t * t * (3 - 2 * t)
  for (let i = 0; i < numBars; i++) {
    const cx = padX + i * (barW + gap) + barW / 2
    const al = Math.min(1, (cx - padX) / fade)
    const ar = Math.min(1, (waveformRight - cx) / fade)
    const e = smooth(al) * smooth(ar)
    alphas[i] = e
    envelope[i] = ENV_FLOOR + (1 - ENV_FLOOR) * e
  }

  const ATTACK = 70
  const DECAY = 12

  function frameIndex(progress) {
    return Math.min(count - 1, Math.max(0, Math.floor(progress * count)))
  }

  function targetOf(base, i) {
    const t = Math.sqrt(Math.min(1, data[base + i] * norm))
    return t
  }

  function stepDisplay(progress, dt) {
    const f = frameIndex(progress)
    const base = f * numBars
    for (let i = 0; i < numBars; i++) {
      const target = targetOf(base, i)
      const cur = display[i]
      const rate = target > cur ? ATTACK : DECAY
      const k = 1 - Math.exp(-rate * dt)
      display[i] = cur + (target - cur) * k
    }
  }

  function drawBase(ctx, progress, { color, name }) {
    ctx.fillStyle = '#00FF00'
    ctx.fillRect(0, 0, size, size)

    const rgb = hexToRgb(color)
    const f = frameIndex(progress)
    const base = f * numBars

    ctx.fillStyle = rgbToCss(rgb)
    for (let i = 0; i < numBars; i++) {
      const h = minH + display[i] * (maxH - minH) * envelope[i]
      const x = padX + i * (barW + gap)
      ctx.globalAlpha = alphas[i]
      roundRect(ctx, x, centerY - h, barW, h * 2, radius)
    }
    ctx.globalAlpha = 1

    if (name) drawName(ctx, size, name, rgb)
    drawProgress(ctx, size, progress)
  }

  return {
    draw(ctx, progress, nowMs, { color, name }) {
      const dt = lastMs == null ? 1 / 60 : Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000))
      lastMs = nowMs
      stepDisplay(progress, dt)
      drawBase(ctx, progress, { color, name })
    },

    drawOffline(ctx, progress, dt, { color, name }) {
      stepDisplay(progress, dt)
      drawBase(ctx, progress, { color, name })
    },

    drawSnapshot(ctx, progress, { color, name }) {
      const f = frameIndex(progress)
      const base = f * numBars
      for (let i = 0; i < numBars; i++) display[i] = targetOf(base, i)
      lastMs = null
      drawBase(ctx, progress, { color, name })
    },

    reset() {
      for (let i = 0; i < numBars; i++) display[i] = 0
      lastMs = null
    },
  }
}
