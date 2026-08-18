import decode from 'audio-decode'

function normalize(decoded) {
  const channelData = decoded.channelData
  const sampleRate = decoded.sampleRate || 0
  const length = channelData[0] ? channelData[0].length : 0
  return {
    channelData,
    sampleRate,
    numberOfChannels: channelData.length,
    length,
    duration: sampleRate ? length / sampleRate : 0,
  }
}

function decodeNative(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return reject(new Error('Web Audio non supportato'))
    const ctx = new AC()
    ctx.decodeAudioData(
      arrayBuffer,
      (buffer) => {
        const channelData = []
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          channelData.push(buffer.getChannelData(c))
        }
        ctx.close().catch(() => {})
        resolve(
          normalize({
            channelData,
            sampleRate: buffer.sampleRate,
          })
        )
      },
      (err) => {
        ctx.close().catch(() => {})
        reject(err)
      }
    )
  })
}

export async function decodeAudio(file) {
  const arrayBuffer = await file.arrayBuffer()

  try {
    return await decodeNative(arrayBuffer)
  } catch (e) {
    /* fallback WASM */
  }

  const fresh = await file.arrayBuffer()
  const decoded = await decode(fresh)
  return normalize(decoded)
}

export function buildAudioBuffer(audioCtx, audio) {
  const { channelData, sampleRate, numberOfChannels, length } = audio
  const buffer = audioCtx.createBuffer(numberOfChannels, length, sampleRate)
  for (let c = 0; c < numberOfChannels; c++) {
    buffer.copyToChannel(channelData[c], c)
  }
  return buffer
}
