import { createAnimator } from './waveform.js'
import { buildAudioBuffer } from './decode.js'
import { renderMp4, supportsWebCodecs } from './webcodecs-render.js'

const VIDEO_BITRATE = 12_000_000
const AUDIO_BITRATE = 192_000
const FPS = 30

function pickMime() {
  const candidates = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export async function renderVideo(opts) {
  const { audio, size } = opts
  if (await supportsWebCodecs({ size, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels })) {
    return renderMp4(opts)
  }
  return renderMediaRecorder(opts)
}

async function renderMediaRecorder({ audio, frameData, name, color, size, onProgress }) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const animator = createAnimator(frameData, { size })

  const audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') await audioCtx.resume()

  const buffer = buildAudioBuffer(audioCtx, audio)
  const source = audioCtx.createBufferSource()
  source.buffer = buffer

  const dest = audioCtx.createMediaStreamDestination()
  source.connect(dest)

  const canvasStream = canvas.captureStream(FPS)
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  const mime = pickMime()
  const options = {
    videoBitsPerSecond: VIDEO_BITRATE,
    audioBitsPerSecond: AUDIO_BITRATE,
  }
  if (mime) options.mimeType = mime

  const recorder = new MediaRecorder(stream, options)
  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data)
  }

  const duration = audio.duration
  const startCtxTime = audioCtx.currentTime
  let rafId = 0

  function tick() {
    const t = audioCtx.currentTime - startCtxTime
    const progress = Math.min(t / duration, 1)
    animator.draw(ctx, progress, performance.now(), { color, name })
    if (onProgress) onProgress(progress)
    if (progress < 1) rafId = requestAnimationFrame(tick)
  }

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType })
      resolve(blob)
    }
    recorder.onerror = (e) => reject(e.error || new Error('Errore MediaRecorder'))
  })

  source.onended = () => {
    setTimeout(() => {
      try {
        recorder.stop()
      } catch (e) {}
    }, 150)
  }

  recorder.start()
  source.start()
  tick()

  const blob = await stopped
  cancelAnimationFrame(rafId)
  await audioCtx.close()
  return blob
}
