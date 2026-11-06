/**
 * Browser half of `dsh-download-files`.
 *
 * Contributes one download action to each file surface of the Web GUI: a
 * delivery card under a finished turn, the changed-file review tab, and the
 * right Sidebar's document preview. The action hands an authenticated Host
 * route to the browser's download manager, so the file lands in this
 * computer's downloads without being assembled in the page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-download-files',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Runtime dictionary namespace; plugin-manager metadata lives in `locale/*.json`. */
    const NS = 'fileDownload'
    /** Document-relative download route registered by the Host half. */
    const ROUTE = 'api/file.download'
    /** How long a failed action shows its error state before it becomes retryable again. */
    const ERROR_HOLD_MS = 5000

    const zh = {
      'action.download': '下载到本机',
      'action.downloading': '正在准备下载…',
      'action.failed': '下载失败，请重试',
    }
    const en = {
      'action.download': 'Download to this computer',
      'action.downloading': 'Preparing download…',
      'action.failed': 'Download failed. Try again.',
    }

    // Matches the host's 24px card action and 28px header tool rows, whose
    // controls are copied here because a dynamic plugin cannot import them.
    const CSS = `
.dsh-download-files-action {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  cursor: pointer;
}
.dsh-download-files-action[data-surface='toolbar'] { width: 28px; height: 28px; padding: 6px; }
.dsh-download-files-action svg { width: 15px; height: 15px; }
.dsh-download-files-action:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-download-files-action:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-download-files-action:disabled { cursor: progress; }
.dsh-download-files-action[data-state='error'] { color: var(--dsw-alias-state-error-primary); }
`

    /** The plugin's own rules, rendered beside each action so they unmount with it. */
    function ActionStyles() {
      return h('style', { 'data-plugin': 'dsh-download-files' }, CSS)
    }

    /** The host icon set's download glyph, drawn at the shared 16px grid. */
    function DownloadGlyph() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, strokeWidth: 1,
      },
      h('path', { d: 'M8 1.95317V10.0469', stroke: 'currentColor' }),
      h('path', { d: 'M4.25 6.29688L8 10.0469L11.75 6.29688', stroke: 'currentColor' }),
      h('path', { d: 'M1.5 10.0469V13.158C1.5 13.3937 1.60536 13.6198 1.79289 13.7865C1.98043 13.9532 2.23478 14.0469 2.5 14.0469H13.5C13.7652 14.0469 14.0196 13.9532 14.2071 13.7865C14.3946 13.6198 14.5 13.3937 14.5 13.158V10.0469', stroke: 'currentColor' }))
    }

    /**
     * Translate through the locale service, re-rendering when the language changes.
     * @param ctx - Client context carrying the locale service.
     * @returns the namespace-bound translate function.
     */
    function useTranslate(ctx) {
      const [, bump] = React.useState(0)
      React.useEffect(() => ctx.locale.subscribe(() => { bump(count => count + 1) }), [ctx])
      return ctx.locale.bind(NS)
    }

    /**
     * Read the Session event coordinates a file-action route carries.
     * @param actionUrl - document-relative action route owned by the card.
     * @returns its coordinates, or undefined when the route does not carry them.
     */
    function coordinatesOf(actionUrl) {
      if (typeof actionUrl !== 'string') return undefined
      try {
        const url = new URL(actionUrl, document.baseURI)
        const sessionId = url.searchParams.get('sessionId')
        const seq = url.searchParams.get('seq')
        const index = url.searchParams.get('index')
        if (sessionId === null || seq === null || index === null) return undefined
        return { sessionId, seq, index }
      } catch (_error) {
        // A malformed route names no file this action can address.
        return undefined
      }
    }

    /**
     * Start the browser download once the Host confirms it can serve the file.
     * @param url - authenticated document-relative download route.
     * @returns after the download manager took over, or a failure to report.
     */
    async function saveFile(url) {
      const response = await fetch(url, { method: 'HEAD', credentials: 'same-origin' })
      if (!response.ok) throw new Error(`download unavailable (HTTP ${response.status})`)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = ''
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    }

    /**
     * Build the download button over one Client context.
     * @param ctx - Client context carrying the locale service.
     * @returns the button component used by every file surface.
     */
    function createDownloadButton(ctx) {
      return function DownloadButton({ params, surface }) {
        const [state, setState] = React.useState('idle')
        const errorTimer = React.useRef(0)
        const t = useTranslate(ctx)
        React.useEffect(() => () => { window.clearTimeout(errorTimer.current) }, [])
        const label = state === 'error' ? t('action.failed') : state === 'busy' ? t('action.downloading') : t('action.download')
        const url = `${ROUTE}?${new URLSearchParams(params)}`
        const onClick = () => {
          if (state === 'busy') return
          setState('busy')
          saveFile(url).then(() => { setState('idle') }, (error) => {
            console.error('download-files: download failed:', error)
            setState('error')
            errorTimer.current = window.setTimeout(() => { setState('idle') }, ERROR_HOLD_MS)
          })
        }
        return h(React.Fragment, null,
          h(ActionStyles),
          h('button', {
            type: 'button',
            className: 'dsh-download-files-action',
            'data-state': state,
            'data-surface': surface,
            title: label,
            'aria-label': label,
            disabled: state === 'busy',
            onClick,
          }, h(DownloadGlyph)))
      }
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries and the three file-surface actions.
       * @param ctx - Client root context carrying the slot and locale services.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'download-files: dictionaries')

        const DownloadButton = createDownloadButton(ctx)

        /** A delivery card names its file by Session event coordinates. */
        function DeliveryDownload({ actionUrl }) {
          const coordinates = coordinatesOf(actionUrl)
          if (coordinates === undefined) return null
          return h(DownloadButton, { params: { ...coordinates, source: 'presented' }, surface: 'card' })
        }

        /** The review tab names its changed file the same way. */
        function ReviewDownload({ actionUrl }) {
          const coordinates = coordinatesOf(actionUrl)
          if (coordinates === undefined) return null
          return h(DownloadButton, { params: { ...coordinates, source: 'changes' }, surface: 'toolbar' })
        }

        /** The document preview already resolved its file to an absolute path. */
        function PreviewDownload({ absolutePath, sessionId }) {
          if (typeof absolutePath !== 'string' || absolutePath === '') return null
          if (typeof sessionId !== 'string' || sessionId === '') return null
          return h(DownloadButton, { params: { sessionId, path: absolutePath }, surface: 'toolbar' })
        }

        ctx.slots.inject('deliverables.file.actions', () => ctx.slots.register(
          { name: 'deliverables.file.actions', id: 'download-files', order: 10 }, DeliveryDownload,
        ))
        ctx.slots.inject('deliverables.review.file.actions', () => ctx.slots.register(
          { name: 'deliverables.review.file.actions', id: 'download-files', order: 10 }, ReviewDownload,
        ))
        ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register(
          { name: 'sidebar.right.tab.document.actions', id: 'download-files', order: 10 }, PreviewDownload,
        ))
      },
    }
  },
})
