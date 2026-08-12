import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { TRANSCODED_DIR, formatInfo } from './config.js'

const pExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) =>
      err ? reject(new Error(`ffmpeg failed: ${stderr.slice(-2000)}`)) : resolve()
    )
  })

const inFlight = new Map()

export function encodeArgs(format) {
  switch (format) {
    case 'mp3-320': return { codec: 'libmp3lame', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-joint_stereo', '1'] }
    case 'mp3-192': return { codec: 'libmp3lame', args: ['-c:a', 'libmp3lame', '-b:a', '192k', '-joint_stereo', '1'] }
    case 'vorbis-192': return { codec: 'libvorbis', args: ['-c:a', 'libvorbis', '-b:a', '192k'] }
    case 'opus-160': return { codec: 'libopus', args: ['-c:a', 'libopus', '-b:a', '160k'] }
    case 'flac': return { codec: 'flac', args: ['-c:a', 'flac'] }
    default: return null
  }
}

/** Returns true when the source already is the requested format and no transcode is needed. */
export function isAlreadyFormat(sourcePath, format) {
  if (format === 'original') return true
  const spec = encodeArgs(format)
  if (!spec) return true
  const ext = path.extname(sourcePath).replace('.', '').toLowerCase()
  if (spec.codec === 'libmp3lame' && ext === 'mp3') return true
  if (spec.codec === 'flac' && ext === 'flac') return true
  if ((spec.codec === 'libvorbis' || spec.codec === 'libopus') && ext === 'ogg') return true
  return false
}

/**
 * Produce (or reuse) a transcoded copy of sourcePath in the given format.
 * Returns the path of the cached file. Shared across all users: identical
 * (source, format) pairs resolve to the same on-disk file.
 */
export function getTranscodedPath(sourcePath, format) {
  if (isAlreadyFormat(sourcePath, format) || format === 'original') return { path: sourcePath, transcoded: false }
  const spec = encodeArgs(format)
  if (!spec) throw new Error(`Unknown format ${format}`)
  const key = crypto.createHash('sha1').update(`${sourcePath}:${format}`).digest('hex').slice(0, 24)
  const outPath = path.join(TRANSCODED_DIR, `${key}.${formatInfo(format).ext}`)
  return { path: outPath, transcoded: true, spec, key }
}

export async function transcode(sourcePath, format) {
  const { path: outPath, transcoded, spec, key } = getTranscodedPath(sourcePath, format)
  if (!transcoded) return outPath
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath

  if (inFlight.has(key)) return inFlight.get(key)
  const promise = pExec(['-y', '-i', sourcePath, '-map', '0:a:0', ...spec.args, outPath]).then(() => {
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error(`Transcode produced empty file for ${sourcePath}`)
    }
    return outPath
  }).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

export async function probe(input, args = []) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', ...args, input], (err, stdout) => {
      if (err) return resolve(null)
      try {
        return resolve(JSON.parse(stdout).format)
      } catch {
        return resolve(null)
      }
    })
  })
}
