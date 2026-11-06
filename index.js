/**
 * Host half of `dsh-download-files`.
 *
 * Serves one authenticated route that streams a file the Web UI addresses —
 * a delivered file, a file under change review, or a file open in the right
 * Sidebar's document preview — as a download attachment. The browser half
 * hands the route to the browser's own download manager, so neither large nor
 * binary files pass through JavaScript in the page.
 */

/** Absolute path of the download route. Registered exactly; the page addresses it document-relative. */
const ROUTE_PATH = '/api/file.download'

/** Bytes per read window: one page of a streamed download. */
const WINDOW_BYTES = 1024 * 1024

/** Media types for the file kinds a turn usually delivers; anything else downloads as opaque bytes. */
const MEDIA_TYPES = new Map(Object.entries({
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
}))

/** Services this plugin cannot serve a download without. */
export const inject = ['connection', 'sessionQuery', 'workspaceFiles', 'workspaceChanges', 'fs', 'sandboxPolicy']

/** A failure that answers one request with a status and a short readable reason. */
class DownloadError extends Error {
  /**
   * @param status - HTTP status to answer with.
   * @param message - one sentence naming what could not be served.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Register the download route on the authenticated browser channel.
 * @param ctx - Host context carrying the connection, session query, workspace files, changes, filesystem, and sandbox policy services.
 */
export function apply(ctx) {
  // The registry owns the route lifetime through this Context, so no extra effect wraps it.
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => handleDownload(ctx, request),
  })
}

/**
 * Answer one download request: `HEAD` validates and reports the headers, `GET` streams the bytes.
 * @param ctx - Host context.
 * @param request - authenticated request arriving on the shared API channel.
 * @returns the download, or the refusal to answer with.
 */
async function handleDownload(ctx, request) {
  try {
    const target = await resolveTarget(ctx, new URL(request.url).searchParams, request.signal)
    const stat = await ctx.workspaceFiles.stat(target.scope, target.path, request.signal)
    const headers = downloadHeaders(target.name, stat.bytes)
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    const file = await ctx.fs.resolve(stat.absolutePath, { signal: request.signal })
    return new Response(streamFile(ctx, file, stat.bytes, request.signal), { status: 200, headers })
  } catch (error) {
    // A client that left mid-request has nobody to answer.
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return failureResponse(error)
  }
}

/**
 * Resolve the addressed file to a workspace path and the scope that authorizes it.
 *
 * Three address forms reach this route: `path` names a file the Sidebar already
 * resolved to its absolute path, while `source=presented` and `source=changes`
 * carry the Session event coordinates the delivery card and the review tab
 * record, so the declared path never travels through the page.
 * @param ctx - Host context.
 * @param params - request query parameters.
 * @param signal - request cancellation.
 * @returns workspace scope, path, and the filename to save as.
 */
async function resolveTarget(ctx, params, signal) {
  const sessionId = params.get('sessionId')
  if (sessionId === null || sessionId === '') throw new DownloadError(400, 'Missing sessionId.')
  const directPath = params.get('path')
  if (directPath !== null) {
    if (directPath === '') throw new DownloadError(400, 'Empty path.')
    return {
      scope: { sessionId, workspaceRoot: ctx.sandboxPolicy.workspaceRoot },
      path: directPath,
      name: downloadNameOf(directPath),
    }
  }
  const seq = integerParam(params.get('seq'))
  const index = integerParam(params.get('index'))
  if (seq === undefined || index === undefined) throw new DownloadError(400, 'Invalid file coordinates.')
  const source = params.get('source') ?? 'presented'
  switch (source) {
    case 'presented': {
      const window = await ctx.sessionQuery.readEvent({ sessionId, seq, before: 0, after: 0 }, signal)
      const data = window.target.type === 'deliverables/presented' ? window.target.data : undefined
      const file = isPresentedData(data) ? data.files[index] : undefined
      if (!isPresentedFile(file)) throw new DownloadError(404, 'No delivered file at these coordinates.')
      return {
        scope: { sessionId, workspaceRoot: window.session.cwd ?? ctx.sandboxPolicy.workspaceRoot },
        path: file.path,
        name: downloadNameOf(file.path),
      }
    }
    case 'changes': {
      const summary = ctx.workspaceChanges.summary(sessionId, seq)
      const file = summary === undefined ? undefined : summary.files[index]
      if (summary === undefined || file === undefined) throw new DownloadError(404, 'No changed file at these coordinates.')
      return { scope: { sessionId, workspaceRoot: summary.cwd }, path: file.path, name: downloadNameOf(file.path) }
    }
    default:
      throw new DownloadError(400, 'Unknown file source.')
  }
}

/** Whether decoded durable data is a delivery event with a file list. */
function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Array.isArray(value.files)
}

/** Whether one declared delivery entry names a path. */
function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return typeof value.path === 'string' && value.path.trim() !== ''
}

/** A non-negative safe integer query value, or undefined. */
function integerParam(value) {
  if (value === null || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/** The last path segment, accepting either separator and never empty. */
function downloadNameOf(path) {
  const slash = path.replace(/\\/gu, '/')
  const name = slash.slice(slash.lastIndexOf('/') + 1).replace(/[\u0000-\u001f\u007f"\\]/gu, '_').trim()
  return name === '' || name === '.' || name === '..' ? 'download' : name
}

/** Response headers of one download: media type, filename, and no caching. */
function downloadHeaders(name, bytes) {
  const headers = new Headers()
  headers.set('content-type', mediaTypeOf(name))
  headers.set('content-disposition', contentDispositionOf(name))
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  if (bytes !== undefined) headers.set('content-length', String(bytes))
  return headers
}

/** Media type for a filename's extension, or opaque bytes. */
function mediaTypeOf(name) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return MEDIA_TYPES.get(name.slice(dot + 1).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * `attachment` disposition carrying both an ASCII fallback and the UTF-8 name,
 * so non-ASCII filenames survive every browser.
 */
function contentDispositionOf(name) {
  const ascii = name.replace(/[^\u0020-\u007e]/gu, '_').replace(/["\\]/gu, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Stream one file in read windows, so a large file never loads whole in memory.
 * @param ctx - Host context carrying the filesystem provider.
 * @param file - resolved filesystem target.
 * @param bytes - complete size reported by the stat before the read; absent when the backend does not report one.
 * @param signal - request cancellation.
 * @returns a backpressured byte stream.
 */
function streamFile(ctx, file, bytes, signal) {
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      if (signal.aborted) {
        controller.error(new Error('download aborted'))
        return
      }
      try {
        const data = await ctx.fs.readByteRange(file, { offset, length: WINDOW_BYTES }, signal)
        if (data.length === 0) {
          controller.close()
          return
        }
        offset += data.length
        controller.enqueue(data)
        if (bytes !== undefined && offset >= bytes) controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/** One refusal answer; a filesystem or coordinate failure keeps its own status. */
function failureResponse(error) {
  if (error instanceof DownloadError) return plainResponse(error.status, error.message)
  const code = remoteCodeOf(error)
  if (code !== undefined) {
    if (code === 'workspace-file/not-found' || code === 'workspace-file/not-regular-file' || code === 'session/not-found') {
      return plainResponse(404, 'File not found.')
    }
    if (code === 'gateway/bad-request') return plainResponse(400, 'Invalid download request.')
  }
  console.error('download-files: download failed:', error)
  return plainResponse(500, 'Download failed.')
}

/** A short text answer that no browser caches. */
function plainResponse(status, message) {
  return new Response(message, { status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } })
}

/** The structured `code` a Host failure carries, when it has one. */
function remoteCodeOf(error) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
