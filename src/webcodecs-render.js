import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { createAnimator } from './waveform.js'

const VIDEO_CODEC = 'avc1.640028'
const VIDEO_BITRATE = 12_000_000
const AUDIO_CODEC = 'aac'
const AUDIO_BITRATE = 192_000
const FPS = 30

export async function supportsWebCodecs({ size, sampleRate, numberOfChannels }) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return false
  if (typeof VideoEncoder.isConfigSupported !== 'function' || typeof AudioEncoder.isConfigSupported !== 'function') {
    return false
  }
  try {
    const [v, a] = await Promise.all([
      VideoEncoder.isConfigSupported({
        codec: VIDEO_CODEC,
        width: size,
        height: size,
        bitrate: VIDEO_BITRATE,
        framerate: FPS,
      }),
      AudioEncoder.isConfigSupported({
        codec: AUDIO_CODEC,
        sampleRate,
        numberOfChannels,
        bitrate: AUDIO_BITRATE,
      }),
    ])
    return !!(v && v.supported && a && a.supported)
  } catch (e) {
    return false
  }
}

export async function renderMp4({ audio, frameData, name, color, size, onProgress }) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const animator = createAnimator(frameData, { size })

  const { channelData, sampleRate, numberOfChannels, length, duration } = audio

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: size, height: size, frameRate: FPS },
    audio: { codec: AUDIO_CODEC, numberOfChannels, sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  let encodeError = null
  const onError = (e) => {
    encodeError = encodeError || e
  }
  const throwIfError = () => {
    if (encodeError) throw encodeError instanceof Error ? encodeError : new Error(String(encodeError))
  }

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: onError,
  })
  videoEncoder.configure({
    codec: VIDEO_CODEC,
    width: size,
    height: size,
    bitrate: VIDEO_BITRATE,
    framerate: FPS,
  })

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: onError,
  })
  audioEncoder.configure({
    codec: AUDIO_CODEC,
    sampleRate,
    numberOfChannels,
    bitrate: AUDIO_BITRATE,
  })

  const framesPerChunk = Math.floor(sampleRate)
  const chunkCount = Math.ceil(length / framesPerChunk)
  for (let c = 0; c < chunkCount; c++) {
    const start = c * framesPerChunk
    const frames = Math.min(framesPerChunk, length - start)
    const data = new Float32Array(frames * numberOfChannels)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = channelData[ch]
      for (let i = 0; i < frames; i++) data[i * numberOfChannels + ch] = src[start + i]
    }
    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels,
      data,
      timestamp: Math.round((start / sampleRate) * 1_000_000),
    })
    audioEncoder.encode(audioData)
    audioData.close()
    throwIfError()
  }
  await audioEncoder.flush()
  throwIfError()

  const totalFrames = Math.max(1, Math.round(duration * FPS))
  const frameUs = 1_000_000 / FPS
  const dt = 1 / FPS
  const keyFrameEvery = FPS * 2

  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames > 1 ? i / (totalFrames - 1) : 1
    animator.drawOffline(ctx, progress, dt, { color, name })

    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs) })
    videoEncoder.encode(frame, { keyFrame: i % keyFrameEvery === 0 })
    frame.close()
    throwIfError()

    if (onProgress && (i % 3 === 0 || i === totalFrames - 1)) onProgress(progress)

    while (videoEncoder.encodeQueueSize > 4) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  await videoEncoder.flush()
  throwIfError()

  videoEncoder.close()
  audioEncoder.close()

  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}
