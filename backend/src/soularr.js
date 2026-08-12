import { config } from './config.js'

export function matchRatio(a, b) {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const queue = [[0, a.length, 0, b.length]]
  const blocks = []
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi)
    if (k) {
      blocks.push([i, j, k])
      if (alo < i && blo < j) queue.push([alo, i, blo, j])
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
    }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let i1 = 0
  let j1 = 0
  let k1 = 0
  let total = 0
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
    else {
      if (k1) total += k1
      i1 = i2
      j1 = j2
      k1 = k2
    }
  }
  if (k1) total += k1
  return (2 * total) / (a.length + b.length)
}

function longestMatch(a, b, alo, ahi, blo, bhi) {
  let besti = alo
  let bestj = blo
  let bestsize = 0
  let j2len = new Map()
  for (let i = alo; i < ahi; i++) {
    const ai = a[i]
    const newj2len = new Map()
    for (let j = blo; j < bhi; j++) {
      if (ai === b[j]) {
        const k = (j2len.get(j - 1) || 0) + 1
        newj2len.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
    }
    j2len = newj2len
  }
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--
    bestj--
    bestsize++
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize++
  }
  return [besti, bestj, bestsize]
}

export function checkRatio(separator, ratio, lidarrFilename, slskdFilename, threshold) {
  if (ratio < threshold) {
    if (separator !== '') {
      const wordCount = lidarrFilename.split(/\s+/).length * -1
      const truncated = slskdFilename.split(separator).slice(wordCount).join(' ')
      return matchRatio(lidarrFilename, truncated)
    }
    return matchRatio(lidarrFilename, slskdFilename)
  }
  return ratio
}

export function ratioVariants(trackExtFilename, slskdFilename, albumName, threshold) {
  let ratio = matchRatio(trackExtFilename, slskdFilename)
  ratio = checkRatio(' ', ratio, trackExtFilename, slskdFilename, threshold)
  ratio = checkRatio('_', ratio, trackExtFilename, slskdFilename, threshold)
  const withAlbum = albumName ? `${albumName} ${trackExtFilename}` : trackExtFilename
  ratio = checkRatio('', ratio, withAlbum, slskdFilename, threshold)
  ratio = checkRatio(' ', ratio, withAlbum, slskdFilename, threshold)
  ratio = checkRatio('_', ratio, withAlbum, slskdFilename, threshold)
  return ratio
}

export function verifyFiletype(file, allowedFiletype) {
  const currentFiletype = (file.filename || '').split('.').pop()
  const pieces = allowedFiletype.split(' ')
  if (currentFiletype.toLowerCase() !== pieces[0].toLowerCase()) return false
  if (pieces.length === 1) return true
  const attributes = pieces.slice(1).join(' ')
  if (attributes.includes('/')) {
    const [bitdepth, samplerateK] = attributes.split('/')
    let targetSamplerate
    try {
      targetSamplerate = String(Math.trunc(Number(samplerateK) * 1000))
    } catch {
      return false
    }
    if (file.bitDepth === undefined || file.bitDepth === null) return false
    if (file.sampleRate === undefined || file.sampleRate === null) return false
    return String(file.bitDepth) === bitdepth && String(file.sampleRate) === targetSamplerate
  }
  if (file.bitrate === undefined || file.bitrate === null) return false
  return String(file.bitrate) === attributes
}

export function albumTrackNum(files, baseExtensions) {
  let count = 0
  let index = -1
  let filetype = ''
  for (const file of files) {
    const ext = (file.filename || '').split('.').pop().toLowerCase()
    const newIndex = baseExtensions.indexOf(ext)
    if (newIndex !== -1) {
      if (index === -1) {
        index = newIndex
        filetype = baseExtensions[index]
      } else if (newIndex !== index) {
        filetype = ''
        break
      }
      count++
    }
  }
  return { count, filetype }
}

export function albumMatch(tracks, slskdFiles, albumName, allowedFiletype, threshold) {
  const filetype = allowedFiletype.split(' ')[0]
  let counted = 0
  let totalMatch = 0
  for (const track of tracks) {
    const lidarrFilename = `${track.title}.${filetype}`
    let bestMatch = 0
    for (const file of slskdFiles) {
      const ratio = ratioVariants(lidarrFilename, file.filename, albumName, threshold)
      if (ratio > bestMatch) bestMatch = ratio
    }
    if (bestMatch > threshold) {
      counted++
      totalMatch += bestMatch
    }
  }
  return counted === tracks.length
}

export function buildQuery(artist, title) {
  let query = config.soularr.prependArtist ? `${artist} ${title}` : title
  if (title.length === 1) query = `${artist} ${title}`
  for (const word of config.soularr.searchBlacklist) {
    if (!word) continue
    query = query.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
  }
  return query.split(/\s+/).filter(Boolean).join(' ')
}

export function baseExtensions() {
  return config.soularr.allowedFiletypes.map((f) => f.split(' ')[0])
}

export function allowedFilesOnly(files) {
  const allowed = baseExtensions()
  return files.filter((f) => allowed.includes((f.filename || '').split('.').pop().toLowerCase()))
}

export function isIgnoredUser(username) {
  return config.soularr.ignoredUsers.includes(username)
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function artistScore(haystack, artist) {
  if (!artist) return 1
  const na = norm(artist)
  if (!na) return 1
  const hay = norm(haystack)
  if (!hay) return 0
  if (na.length >= 4 && hay.includes(na)) return 1
  const noThe = na.startsWith('the') ? na.slice(3) : ''
  if (noThe.length >= 4 && hay.includes(noThe)) return 1
  const words = na.split(/\s+/).filter((w) => w.length >= 3)
  if (!words.length) return 0
  const hits = words.filter((w) => hay.includes(w)).length
  return hits / words.length
}

export function fileDir(filename) {
  const idx = Math.max(filename.lastIndexOf('\\'), filename.lastIndexOf('/'))
  return idx === -1 ? '' : filename.slice(0, idx)
}

export function joinPath(dir, name) {
  return dir ? `${dir}\\${name}` : name
}
