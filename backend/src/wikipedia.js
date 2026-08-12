/**
 * Wikipedia enrichment: the lead-section extract (bio) and the lead image
 * (artwork) for an artist, used on the home showcase and artist pages.
 * Results are cached in-memory so repeated lookups never re-hit the API.
 */

const API = 'https://en.wikipedia.org/w/api.php'
const TTL = 6 * 60 * 60 * 1000
const CACHE = new Map()

function isWebImage(url) {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test((url || '').split('?')[0])
}

export async function wikiArtist(name) {
  if (!name) return null
  const key = name.toLowerCase().trim()
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.t < TTL) return hit.v

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    redirects: '1',
    prop: 'extracts|pageimages',
    exintro: '1',
    explaintext: '1',
    exsentences: '4',
    piprop: 'original|thumbnail',
    pithumbsize: '1000',
    titles: name
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  let out = null
  try {
    const res = await fetch(`${API}?${params}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const pages = Object.values(data?.query?.pages || {})
    const page = pages.find((p) => p && p.pageid !== undefined)
    if (page) {
      const extract = (page.extract || '').trim().replace(/\s+/g, ' ')
      // Wikipedia's thumbnail service transcodes to a browser-friendly format
      // (JPEG/PNG); `original` can be a TIF or other format browsers can't
      // render, so only fall back to it when no thumbnail exists.
      const thumb = page.thumbnail?.source || null
      const orig = page.original?.source || null
      const image = thumb || (orig && isWebImage(orig) ? orig : null)
      if (extract || image) out = { title: page.title, extract: extract || null, image }
    }
  } catch (err) {
    console.warn(`[wikipedia] "${name}" failed: ${err.message}`)
    out = null
  } finally {
    clearTimeout(timer)
  }
  CACHE.set(key, { t: Date.now(), v: out })
  return out
}
