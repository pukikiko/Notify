import net from 'node:net'

const MAX_URL_LENGTH = 2048
const HTTP_URL = /^https?:\/\//i
// control chars + whitespace: nothing like that belongs in a URL we will hand
// to a CLI, and newlines in particular can confuse argv-based parsers
const BAD_CHARS = /[\u0000-\u0020\u007f]/

function isPrivateIpv4(ip) {
  const p = ip.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b, c] = p
  return (
    a === 0 ||                                   // 0.0.0.0/8
    a === 10 ||                                  // 10.0.0.0/8
    a === 127 ||                                 // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) ||        // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) ||                  // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) ||         // 172.16.0.0/12
    (a === 192 && b === 168) ||                  // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) ||     // 198.18.0.0/15 benchmarking
    (a === 192 && b === 0 && c <= 2) ||          // 192.0.0.0/24 + TEST-NET-1
    (a === 198 && b === 51 && c === 100) ||      // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||       // 203.0.113.0/24 TEST-NET-3
    a >= 224                                     // multicast + reserved
  )
}

function isPrivateIpv6(ip) {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v === '::' || v === '::1') return true
  if (v.startsWith('::ffff:')) return isPrivateIpv4(v.slice('::ffff:'.length))
  return (
    v.startsWith('fe80') ||                       // link-local
    v.startsWith('fc') || v.startsWith('fd') ||   // fc00::/7 unique local
    v.startsWith('fec0') ||                       // site-local (deprecated)
    v.startsWith('ff') ||                         // multicast
    v.startsWith('2001:db8')                      // documentation
  )
}

/** True only for http(s) URLs that are safe to fetch from the server: well-formed,
    no embedded whitespace/control characters, no literal private/loopback/link-local
    addresses, no localhost hostnames, default ports only. DNS-rebinding aside, this
    keeps the server-side fetches (yt-dlp, cover art) from reaching the local network,
    this host, or arbitrary non-web ports used as C2/exploit endpoints. */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return false
  if (!HTTP_URL.test(value)) return false
  if (BAD_CHARS.test(value)) return false
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  // Reject explicit non-default ports (Node normalizes :80/:443 to '').
  if (parsed.port) return false
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false
  const hostNoBrackets = host.replace(/^\[|\]$/g, '')
  const ipv = net.isIP(hostNoBrackets)
  if (ipv === 4) return !isPrivateIpv4(hostNoBrackets)
  if (ipv === 6) return !isPrivateIpv6(hostNoBrackets)
  return true
}

const IMAGE_MAGIC = [
  // JPEG: FFD8FF
  (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  // PNG: 89504E470D0A1A0A
  (b) => b.length > 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  // GIF: "GIF8"
  (b) => b.length > 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  // WebP: RIFF....WEBP
  (b) => b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  // BMP: "BM"
  (b) => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d
]

/** True when the buffer starts with the magic bytes of a common raster image.
    Used to stop arbitrary bytes (e.g. a yt-dlp config file) from being saved as
    a "cover" on disk at a predictable path. */
export function isImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 3) return false
  return IMAGE_MAGIC.some((test) => test(buf))
}

/** Strip control characters (newlines, NUL, etc.) and cap the length of a string
    that will end up in a subprocess argv or a log line, so a value can never
    masquerade as an option or inject log output. */
export function scrubCliValue(value, max = 512) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}
