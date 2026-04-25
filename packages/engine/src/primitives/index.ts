import type { BlockRegistry } from '../core/BlockRegistry.js'

import { inputManifest, inputHandler } from './workflow/input.js'
import { outputManifest, outputHandler } from './workflow/output.js'
import { setVariableManifest, setVariableHandler } from './data/setVariable.js'
import { logManifest, logHandler } from './data/log.js'
import { ifManifest } from './controlFlow/if.js'

/**
 * Đăng ký tất cả core primitives vào BlockRegistry.
 * Phase 2: 5 primitives tối thiểu để E2E test (input, output, setVariable, log, if).
 * Phase 3-4: thêm loop, switch, try, parallel, race, delay, filter, aggregate, transformJson, httpRequest, subflow, browser/*
 */
export function registerCorePrimitives(registry: BlockRegistry): void {
  // workflow boundary
  registry.register(inputManifest, inputHandler)
  registry.register(outputManifest, outputHandler)

  // data
  registry.register(setVariableManifest, setVariableHandler)
  registry.register(logManifest, logHandler)

  // control flow — runner special-case (no handler)
  registry.register(ifManifest)
}

export {
  inputManifest, inputHandler,
  outputManifest, outputHandler,
  setVariableManifest, setVariableHandler,
  logManifest, logHandler,
  ifManifest
}
