import './style.css'
import { decodeAudio } from './decode.js'
import { computeWaveformFrames, createAnimator, hexToRgb, isTooGreen } from './waveform.js'
import { renderVideo } from './renderer.js'

const SIZE = 1080
const BAR_COUNT = 90
const FPS = 30
const PRESETS = ['#FFFFFF', '#000000', '#FF2D55', '#0A84FF', '#FFCC00', '#FF9500']

const els = {
  file: document.getElementById('file'),
  drop: document.getElementById('drop'),
  dropText: document.getElementById('drop-text'),
  panel: document.getElementById('panel'),
  name: document.getElementById('track-name'),
  color: document.getElementById('color'),
  presets: document.getElementById('presets'),
  warning: document.getElementById('warning'),
  canvas: document.getElementById('preview'),
  play: document.getElementById('play'),
  seek: document.getElementById('seek'),
  time: document.getElementById('time'),
  render: document.getElementById('render'),
  download: document.getElementById('download'),
  progressWrap: document.getElementById('progress-wrap'),
  progressBar: document.getElementById('progress-bar'),
  status: document.getElementById('status'),
}

const ctx = els.canvas.getContext('2d')
els.canvas.width = SIZE
els.canvas.height = SIZE

const state = {
  file: null,
  audio: null,
  frameData: null,
  animator: null,
  color: '#FFFFFF',
  name: '',
}

let previewCtx = null
let source = null
let playStartAt = 0
let playOffset = 0
let playing = false
let rafId = 0

function setStatus(text) {
  els.status.textContent = text
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${String(ss).padStart(2, '0')}`
}

function ensurePreviewCtx() {
  if (!previewCtx) {
    const AC = window.AudioContext || window.webkitAudioContext
    previewCtx = new AC()
  }
  if (previewCtx.state === 'suspended') previewCtx.resume()
  return previewCtx
}

function buildBuffer(audioCtx) {
  const { channelData, sampleRate, numberOfChannels, length } = state.audio
  const buffer = audioCtx.createBuffer(numberOfChannels, length, sampleRate)
  for (let c = 0; c < numberOfChannels; c++) buffer.copyToChannel(channelData[c], c)
  return buffer
}

function currentTime() {
  if (!previewCtx || !source) return playOffset
  return Math.min(Math.max(0, playOffset + (previewCtx.currentTime - playStartAt)), state.audio.duration)
}

function drawPreviewAt(progress) {
  if (!state.animator) return
  state.animator.drawSnapshot(ctx, progress, { color: state.color, name: state.name })
}

function drawPreviewLive(progress) {
  if (!state.animator) return
  state.animator.draw(ctx, progress, performance.now(), { color: state.color, name: state.name })
}

function updateTimeText() {
  const t = playing ? currentTime() : playOffset
  els.seek.value = (t / state.audio.duration) * 100 || 0
  els.time.textContent = `${fmtTime(t)} / ${fmtTime(state.audio.duration)}`
}

function updatePlayUI() {
  els.play.textContent = playing ? 'Pausa' : 'Play'
}

function stopSource() {
  if (source) {
    source.onended = null
    try {
      source.stop()
    } catch (e) {}
    source = null
  }
  playing = false
}

function play() {
  const ac = ensurePreviewCtx()
  if (playOffset >= state.audio.duration - 0.01) playOffset = 0
  source = ac.createBufferSource()
  source.buffer = buildBuffer(ac)
  source.connect(ac.destination)
  source.onended = () => {
    if (!playing) return
    playing = false
    playOffset = 0
    source = null
    updatePlayUI()
    drawPreviewAt(0)
    updateTimeText()
  }
  source.start(0, playOffset)
  playStartAt = ac.currentTime
  playing = true
  updatePlayUI()
  if (!rafId) rafId = requestAnimationFrame(loop)
}

function pause() {
  if (playing) playOffset = currentTime()
  stopSource()
  updatePlayUI()
  drawPreviewAt(playOffset / state.audio.duration)
  updateTimeText()
}

function togglePlay() {
  if (!state.audio) return
  if (playing) pause()
  else play()
}

function seekTo(seconds) {
  playOffset = Math.max(0, Math.min(seconds, state.audio.duration))
  const wasPlaying = playing
  stopSource()
  if (wasPlaying) play()
  else drawPreviewAt(playOffset / state.audio.duration)
  updateTimeText()
}

function loop() {
  rafId = 0
  if (!playing) return
  const t = currentTime()
  drawPreviewLive(t / state.audio.duration)
  updateTimeText()
  if (t >= state.audio.duration) {
    playing = false
    playOffset = 0
    source = null
    updatePlayUI()
    drawPreviewAt(0)
    updateTimeText()
    return
  }
  rafId = requestAnimationFrame(loop)
}

function buildPresets() {
  for (const c of PRESETS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'preset'
    b.style.background = c
    b.addEventListener('click', () => {
      state.color = c
      els.color.value = c
      syncPresetActive()
      applyColor()
    })
    els.presets.appendChild(b)
  }
}

function syncPresetActive() {
  const upper = state.color.toUpperCase()
  ;[...els.presets.children].forEach((b) => {
    b.classList.toggle('active', b.style.background.toUpperCase() === upper)
  })
}

function applyColor() {
  state.name = els.name.value.trim()
  const bad = isTooGreen(hexToRgb(state.color))
  els.warning.hidden = !bad
  els.render.disabled = bad || !state.audio
  const progress = state.audio
    ? (playing ? currentTime() / state.audio.duration : playOffset / state.audio.duration)
    : 0
  drawPreviewAt(progress)
  syncPresetActive()
}

function setDownloadDisabled() {
  els.download.classList.add('disabled')
  els.download.removeAttribute('href')
  els.download.removeAttribute('download')
}

function setDownloadReady(blob) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
  els.download.href = URL.createObjectURL(blob)
  els.download.download = `audiogram.${ext}`
  els.download.classList.remove('disabled')
  return ext
}

async function handleFile(file) {
  if (!file) return
  stopSource()
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  playing = false
  playOffset = 0
  updatePlayUI()

  state.file = file
  state.audio = null
  state.frameData = null
  state.animator = null
  els.dropText.textContent = file.name
  els.render.disabled = true
  setDownloadDisabled()
  setStatus('Decodifica in corso…')

  try {
    const audio = await decodeAudio(file)
    state.audio = audio
    setStatus('Analisi in corso…')
    await new Promise((r) => setTimeout(r, 30))
    state.frameData = computeWaveformFrames(audio.channelData, audio.sampleRate, {
      numBars: BAR_COUNT,
      fps: FPS,
    })
    state.animator = createAnimator(state.frameData, { size: SIZE })
    els.panel.hidden = false
    applyColor()
    updateTimeText()
    setStatus('Pronto')
  } catch (e) {
    setStatus('Impossibile decodificare questo file audio')
  }
}

async function render() {
  if (!state.audio) return
  if (isTooGreen(hexToRgb(state.color))) return

  pause()
  els.render.disabled = true
  els.play.disabled = true
  els.seek.disabled = true
  setDownloadDisabled()
  els.progressWrap.hidden = false
  setStatus('Rendering… 0%')

  try {
    const blob = await renderVideo({
      audio: state.audio,
      frameData: state.frameData,
      name: state.name,
      color: state.color,
      size: SIZE,
      onProgress: (p) => {
        els.progressBar.style.width = `${p * 100}%`
        setStatus(`Rendering… ${Math.round(p * 100)}%`)
      },
    })
    const ext = setDownloadReady(blob)
    setStatus(`Completato (${ext.toUpperCase()})`)
  } catch (e) {
    setStatus('Errore durante il rendering')
  } finally {
    els.render.disabled = isTooGreen(hexToRgb(state.color)) || !state.audio
    els.play.disabled = false
    els.seek.disabled = false
    els.progressWrap.hidden = true
  }
}

els.file.addEventListener('change', () => {
  handleFile(els.file.files[0])
  els.file.value = ''
})

els.drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  els.drop.classList.add('drag')
})
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('drag'))
els.drop.addEventListener('drop', (e) => {
  e.preventDefault()
  els.drop.classList.remove('drag')
  const f = e.dataTransfer.files[0]
  if (f) handleFile(f)
})

els.name.addEventListener('input', applyColor)
els.color.addEventListener('input', () => {
  state.color = els.color.value
  applyColor()
})
els.play.addEventListener('click', togglePlay)
els.seek.addEventListener('input', () => {
  if (!state.audio) return
  seekTo((els.seek.value / 100) * state.audio.duration)
})
els.canvas.addEventListener('click', (e) => {
  if (!state.audio) return
  const rect = els.canvas.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  seekTo(ratio * state.audio.duration)
})
els.render.addEventListener('click', render)

buildPresets()
drawPreviewAt(0)
