/**
 * Phase 4: Browser primitives.
 *
 * Tất cả primitives đều requires='browser' và dispatch qua
 * IBrowserController.executeAction(actionType, input). Engine không quan tâm
 * implementation — App layer (ChannelManager) cung cấp controller.
 */

import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * Generic factory: dispatch input qua controller.executeAction(actionType, input).
 *
 * Strip 'core.' prefix khi dispatch — IBrowserController nhận bare action names
 * (compatible với legacy WebviewController dùng 'navigate', 'click', ...).
 */
function makeBrowserHandler(manifestId: string): CoreBlockHandler {
  const actionType = manifestId.replace(/^core\./, '')
  return {
    async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
      if (!ctx.controller) {
        return { success: false, error: `Browser action '${actionType}' requires a channel controller` }
      }
      try {
        const result = await ctx.controller.executeAction(actionType, input)
        if (!result.success) return { success: false, error: result.error ?? `${actionType} failed` }
        return { success: true, output: result.output ?? {} }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}

// Build manifest helper to reduce boilerplate
function makeManifest(opts: {
  id: string
  name: string
  icon: string
  category: string
  description: string
  inputSchema: CoreBlockManifest['inputSchema']
  outputSchema: CoreBlockManifest['outputSchema']
  runtime?: 'control' | 'page'
}): CoreBlockManifest {
  return {
    manifestId: opts.id,
    name: opts.name,
    version: '1.0.0',
    kind: 'core',
    runtime: opts.runtime ?? 'control',
    requires: 'browser',
    ui: { icon: opts.icon, category: opts.category, description: opts.description },
    inputSchema: opts.inputSchema,
    outputSchema: opts.outputSchema,
    implementationKey: opts.id
  }
}

// =========== NAVIGATION ===========

export const navigateManifest = makeManifest({
  id: 'core.navigate', name: 'Navigate', icon: 'Globe', category: 'browser',
  description: 'Navigate to a URL',
  inputSchema: [
    { name: 'url', type: 'string', label: 'URL', required: true, placeholder: 'https://example.com' },
    { name: 'waitUntil', type: 'string', label: 'Wait until', defaultValue: 'load',
      options: [
        { label: 'load', value: 'load' },
        { label: 'domcontentloaded', value: 'domcontentloaded' },
        { label: 'networkidle', value: 'networkidle' }
      ] }
  ],
  outputSchema: [{ name: 'currentUrl', type: 'string', label: 'Final URL' }]
})

export const goBackManifest = makeManifest({
  id: 'core.goBack', name: 'Go Back', icon: 'ArrowLeft', category: 'browser',
  description: 'Navigate back',
  inputSchema: [],
  outputSchema: [{ name: 'currentUrl', type: 'string', label: 'Current URL' }]
})

export const goForwardManifest = makeManifest({
  id: 'core.goForward', name: 'Go Forward', icon: 'ArrowRight', category: 'browser',
  description: 'Navigate forward',
  inputSchema: [],
  outputSchema: [{ name: 'currentUrl', type: 'string', label: 'Current URL' }]
})

export const reloadManifest = makeManifest({
  id: 'core.reload', name: 'Reload', icon: 'RotateCw', category: 'browser',
  description: 'Reload current page',
  inputSchema: [],
  outputSchema: [{ name: 'currentUrl', type: 'string', label: 'Current URL' }]
})

// =========== INTERACTION ===========

export const clickManifest = makeManifest({
  id: 'core.click', name: 'Click', icon: 'MousePointerClick', category: 'browser',
  description: 'Click on an element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' },
    { name: 'button', type: 'string', label: 'Button', defaultValue: 'left',
      options: [
        { label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }, { label: 'Middle', value: 'middle' }
      ] },
    { name: 'clickCount', type: 'number', label: 'Click count', defaultValue: 1 },
    { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const typeManifest = makeManifest({
  id: 'core.type', name: 'Type Text', icon: 'Keyboard', category: 'browser',
  description: 'Type text into an input field',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' },
    { name: 'text', type: 'string', label: 'Text', required: true },
    { name: 'delay', type: 'number', label: 'Delay between keys (ms)', defaultValue: 50 },
    { name: 'clearFirst', type: 'boolean', label: 'Clear first', defaultValue: true }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const scrollManifest = makeManifest({
  id: 'core.scroll', name: 'Scroll', icon: 'ArrowUpDown', category: 'browser',
  description: 'Scroll page or element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element (optional)', uiHint: 'selector-picker' },
    { name: 'direction', type: 'string', label: 'Direction', defaultValue: 'down',
      options: [
        { label: 'Down', value: 'down' }, { label: 'Up', value: 'up' },
        { label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }
      ] },
    { name: 'amount', type: 'number', label: 'Amount (px)', defaultValue: 500 }
  ],
  outputSchema: [
    { name: 'scrollX', type: 'number', label: 'Scroll X' },
    { name: 'scrollY', type: 'number', label: 'Scroll Y' }
  ]
})

export const hoverManifest = makeManifest({
  id: 'core.hover', name: 'Hover', icon: 'Hand', category: 'browser',
  description: 'Hover over an element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' },
    { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const selectManifest = makeManifest({
  id: 'core.select', name: 'Select Option', icon: 'ListChecks', category: 'browser',
  description: 'Select option(s) in <select>',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Select element', required: true, uiHint: 'selector-picker' },
    { name: 'value', type: 'string', label: 'Value' },
    { name: 'label', type: 'string', label: 'Label (alternative)' }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const pressKeyManifest = makeManifest({
  id: 'core.pressKey', name: 'Press Key', icon: 'Keyboard', category: 'browser',
  description: 'Press a keyboard key',
  inputSchema: [
    { name: 'key', type: 'string', label: 'Key', required: true, placeholder: 'Enter / Escape / Tab' },
    { name: 'selector', type: 'selector', label: 'On element (optional)', uiHint: 'selector-picker' }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

// =========== DATA EXTRACTION ===========

export const getValueManifest = makeManifest({
  id: 'core.getValue', name: 'Get Value', icon: 'Pipette', category: 'browser',
  description: 'Get .value of an input element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Input', required: true, uiHint: 'selector-picker' }
  ],
  outputSchema: [{ name: 'value', type: 'string', label: 'Value' }]
})

export const setValueManifest = makeManifest({
  id: 'core.setValue', name: 'Set Value', icon: 'Edit', category: 'browser',
  description: 'Set .value of an input element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Input', required: true, uiHint: 'selector-picker' },
    { name: 'value', type: 'string', label: 'Value', required: true }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const getTextManifest = makeManifest({
  id: 'core.getText', name: 'Get Text', icon: 'Type', category: 'browser',
  description: 'Get textContent of an element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' }
  ],
  outputSchema: [{ name: 'text', type: 'string', label: 'Text content' }]
})

export const getAttributeManifest = makeManifest({
  id: 'core.getAttribute', name: 'Get Attribute', icon: 'Tag', category: 'browser',
  description: 'Get an attribute of an element',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' },
    { name: 'attribute', type: 'string', label: 'Attribute name', required: true, placeholder: 'href' }
  ],
  outputSchema: [{ name: 'value', type: 'string', label: 'Attribute value' }]
})

export const screenshotManifest = makeManifest({
  id: 'core.screenshot', name: 'Screenshot', icon: 'Camera', category: 'browser',
  description: 'Take a screenshot',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element (optional)', uiHint: 'selector-picker' },
    { name: 'fullPage', type: 'boolean', label: 'Full page', defaultValue: false }
  ],
  outputSchema: [{ name: 'screenshotBase64', type: 'string', label: 'Base64 PNG' }]
})

// =========== WAITING ===========

export const waitForSelectorManifest = makeManifest({
  id: 'core.waitForSelector', name: 'Wait For Selector', icon: 'Clock', category: 'browser',
  description: 'Wait for an element to appear/disappear',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'Element', required: true, uiHint: 'selector-picker' },
    { name: 'state', type: 'string', label: 'State', defaultValue: 'visible',
      options: [
        { label: 'visible', value: 'visible' }, { label: 'hidden', value: 'hidden' },
        { label: 'attached', value: 'attached' }, { label: 'detached', value: 'detached' }
      ] },
    { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 }
  ],
  outputSchema: [{ name: 'found', type: 'boolean', label: 'Element found' }]
})

export const waitForNavigationManifest = makeManifest({
  id: 'core.waitForNavigation', name: 'Wait For Navigation', icon: 'Clock', category: 'browser',
  description: 'Wait for page navigation to complete',
  inputSchema: [
    { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 },
    { name: 'waitUntil', type: 'string', label: 'Wait until', defaultValue: 'load',
      options: [
        { label: 'load', value: 'load' },
        { label: 'domcontentloaded', value: 'domcontentloaded' },
        { label: 'networkidle', value: 'networkidle' }
      ] }
  ],
  outputSchema: [{ name: 'currentUrl', type: 'string', label: 'Final URL' }]
})

// =========== FILE ===========

export const uploadFileManifest = makeManifest({
  id: 'core.uploadFile', name: 'Upload File', icon: 'Upload', category: 'browser',
  description: 'Upload a file via <input type=file>',
  inputSchema: [
    { name: 'selector', type: 'selector', label: 'File input', required: true, uiHint: 'selector-picker' },
    { name: 'filePath', type: 'string', label: 'Local file path or URL', required: true }
  ],
  outputSchema: [{ name: 'success', type: 'boolean', label: 'Success' }]
})

export const downloadUrlManifest = makeManifest({
  id: 'core.downloadUrl', name: 'Download URL', icon: 'Download', category: 'browser',
  description: 'Download a file from URL via the browser context',
  inputSchema: [
    { name: 'url', type: 'string', label: 'URL', required: true },
    { name: 'savePath', type: 'string', label: 'Save path (optional)' }
  ],
  outputSchema: [
    { name: 'savedPath', type: 'string', label: 'Saved file path' },
    { name: 'sizeBytes', type: 'number', label: 'File size in bytes' }
  ]
})

// =========== EVAL (page-runtime code dispatch) ===========

export const evalScriptManifest = makeManifest({
  id: 'core.evalScript', name: 'Eval Script', icon: 'Code', category: 'browser',
  description: 'Execute JavaScript in the page context (used by code blocks runtime=page)',
  runtime: 'page',
  inputSchema: [
    { name: 'code', type: 'string', label: 'JavaScript code', required: true, uiHint: 'monaco-js' },
    { name: 'args', type: 'json', label: 'Arguments object' }
  ],
  outputSchema: [{ name: 'result', type: 'any', label: 'Return value of code' }]
})

// =========== REGISTER ALL ===========

export const ALL_BROWSER_MANIFESTS = [
  navigateManifest, goBackManifest, goForwardManifest, reloadManifest,
  clickManifest, typeManifest, scrollManifest, hoverManifest, selectManifest, pressKeyManifest,
  getValueManifest, setValueManifest, getTextManifest, getAttributeManifest, screenshotManifest,
  waitForSelectorManifest, waitForNavigationManifest,
  uploadFileManifest, downloadUrlManifest,
  evalScriptManifest
] as const

export function registerBrowserPrimitives(registry: import('../../core/BlockRegistry.js').BlockRegistry): void {
  for (const m of ALL_BROWSER_MANIFESTS) {
    registry.register(m, makeBrowserHandler(m.manifestId))
  }
}
