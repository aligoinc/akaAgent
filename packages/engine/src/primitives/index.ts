import type { BlockRegistry } from '../core/BlockRegistry.js'

import { inputManifest, inputHandler } from './workflow/input.js'
import { outputManifest, outputHandler } from './workflow/output.js'
import { setVariableManifest, setVariableHandler } from './data/setVariable.js'
import { logManifest, logHandler } from './data/log.js'
import { transformJsonManifest, transformJsonHandler } from './data/transformJson.js'
import { ifManifest } from './controlFlow/if.js'
import { delayManifest, delayHandler } from './controlFlow/delay.js'
import { httpRequestManifest, httpRequestHandler } from './io/httpRequest.js'
import { subflowManifest, subflowHandler } from './io/subflow.js'

/**
 * Đăng ký tất cả core primitives vào BlockRegistry.
 *
 * Phase 2: 5 primitives core (input, output, setVariable, log, if).
 * Phase 3a: + delay, transformJson, httpRequest, subflow.
 * Phase 3b (next): loop, switch, try, parallel, race, filter, aggregate, break, continue, wait.
 * Phase 4: browser primitives (navigate, click, type, ...).
 */
export function registerCorePrimitives(registry: BlockRegistry): void {
  // workflow boundary
  registry.register(inputManifest, inputHandler)
  registry.register(outputManifest, outputHandler)

  // data
  registry.register(setVariableManifest, setVariableHandler)
  registry.register(logManifest, logHandler)
  registry.register(transformJsonManifest, transformJsonHandler)

  // control flow — runner special-case (no handler) for if
  registry.register(ifManifest)
  registry.register(delayManifest, delayHandler)

  // io
  registry.register(httpRequestManifest, httpRequestHandler)
  registry.register(subflowManifest, subflowHandler)
}

export {
  inputManifest, inputHandler,
  outputManifest, outputHandler,
  setVariableManifest, setVariableHandler,
  logManifest, logHandler,
  transformJsonManifest, transformJsonHandler,
  ifManifest,
  delayManifest, delayHandler,
  httpRequestManifest, httpRequestHandler,
  subflowManifest, subflowHandler
}
