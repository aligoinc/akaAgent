import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.httpRequest — REST API call. Built-in fetch (Node 18+).
 *
 * Phase 3a: GET/POST/PUT/PATCH/DELETE, JSON body, custom headers, timeout.
 * Phase later: connection-based auth (OAuth refresh), HAR capture, retry policy hook.
 */

export const httpRequestManifest: CoreBlockManifest = {
  manifestId: 'core.httpRequest',
  name: 'HTTP Request',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Globe', category: 'io', description: 'Make an HTTP request (REST API)' },
  inputSchema: [
    { name: 'url', type: 'string', label: 'URL', required: true, placeholder: 'https://api.example.com/users/{{input.id}}' },
    { name: 'method', type: 'string', label: 'Method', defaultValue: 'GET',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'PATCH', value: 'PATCH' },
        { label: 'DELETE', value: 'DELETE' },
        { label: 'HEAD', value: 'HEAD' }
      ] },
    { name: 'headers', type: 'json', label: 'Headers', uiHint: 'monaco-json' },
    { name: 'body', type: 'json', label: 'Body (JSON)', uiHint: 'monaco-json' },
    { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 },
    { name: 'parseAs', type: 'string', label: 'Parse response as', defaultValue: 'auto',
      options: [
        { label: 'Auto (JSON if Content-Type is JSON)', value: 'auto' },
        { label: 'JSON', value: 'json' },
        { label: 'Text', value: 'text' },
        { label: 'Bytes (base64)', value: 'bytes' }
      ] }
  ],
  outputSchema: [
    { name: 'status', type: 'number', label: 'HTTP status code' },
    { name: 'ok', type: 'boolean', label: 'status in [200, 299]' },
    { name: 'headers', type: 'json', label: 'Response headers' },
    { name: 'data', type: 'any', label: 'Parsed response body' }
  ],
  implementationKey: 'core.httpRequest'
}

export const httpRequestHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
    const url = String(input.url ?? '')
    if (!url) return { success: false, error: 'httpRequest: url is required' }

    const method = String(input.method ?? 'GET').toUpperCase()
    const timeout = Number(input.timeout ?? 30000)
    const parseAs = String(input.parseAs ?? 'auto')

    // Build headers — merge w/ JSON content-type if body is object
    const headers: Record<string, string> = {}
    if (input.headers && typeof input.headers === 'object') {
      for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
        headers[k] = String(v)
      }
    }

    let bodyToSend: string | undefined
    const hasBody = input.body !== undefined && input.body !== null && input.body !== ''
    if (hasBody && method !== 'GET' && method !== 'HEAD') {
      if (typeof input.body === 'string') {
        bodyToSend = input.body
      } else {
        bodyToSend = JSON.stringify(input.body)
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }

    // Combine timeout + abort signal
    const timeoutController = new AbortController()
    const timeoutTimer = setTimeout(() => timeoutController.abort(), timeout)
    const onParentAbort = () => timeoutController.abort()
    ctx.abortSignal.addEventListener('abort', onParentAbort)

    try {
      const fetchInit: RequestInit = {
        method,
        headers,
        signal: timeoutController.signal
      }
      if (bodyToSend !== undefined) fetchInit.body = bodyToSend
      const res = await fetch(url, fetchInit)

      const respHeaders: Record<string, string> = {}
      res.headers.forEach((value, key) => { respHeaders[key] = value })

      let data: unknown
      const contentType = res.headers.get('content-type') ?? ''
      if (parseAs === 'text' || (parseAs === 'auto' && !contentType.includes('json'))) {
        data = await res.text()
      } else if (parseAs === 'bytes') {
        const buf = await res.arrayBuffer()
        data = Buffer.from(buf).toString('base64')
      } else {
        data = await res.json().catch(async () => res.text())
      }

      ctx.log('info', `HTTP ${method} ${url} → ${res.status}`)

      return {
        success: true,
        output: {
          status: res.status,
          ok: res.ok,
          headers: respHeaders,
          data
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `HTTP ${method} ${url} failed: ${msg}`)
      return { success: false, error: `HTTP request failed: ${msg}` }
    } finally {
      clearTimeout(timeoutTimer)
      ctx.abortSignal.removeEventListener('abort', onParentAbort)
    }
  }
}
