import type { BlockRegistry } from '../core/BlockRegistry.js'

import { inputManifest, inputHandler } from './workflow/input.js'
import { outputManifest, outputHandler } from './workflow/output.js'
import { setVariableManifest, setVariableHandler } from './data/setVariable.js'
import { logManifest, logHandler } from './data/log.js'
import { transformJsonManifest, transformJsonHandler } from './data/transformJson.js'
import { ifManifest } from './controlFlow/if.js'
import { switchManifest } from './controlFlow/switch.js'
import { filterManifest } from './controlFlow/filter.js'
import { delayManifest, delayHandler } from './controlFlow/delay.js'
import { loopManifest } from './controlFlow/loop.js'
import { breakManifest } from './controlFlow/break.js'
import { continueManifest } from './controlFlow/continue.js'
import { tryManifest } from './controlFlow/try.js'
import { waitManifest, waitHandler } from './controlFlow/wait.js'
import { aggregateManifest } from './data/aggregate.js'
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
  registry.register(aggregateManifest)               // runner special-case (no handler)

  // control flow — runner special-case (no handler) for if/switch/filter/loop/break/continue/try
  registry.register(ifManifest)
  registry.register(switchManifest)
  registry.register(filterManifest)
  registry.register(loopManifest)
  registry.register(breakManifest)
  registry.register(continueManifest)
  registry.register(tryManifest)
  registry.register(delayManifest, delayHandler)
  registry.register(waitManifest, waitHandler)

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
  aggregateManifest,
  ifManifest,
  switchManifest,
  filterManifest,
  loopManifest, breakManifest, continueManifest,
  tryManifest,
  delayManifest, delayHandler,
  waitManifest, waitHandler,
  httpRequestManifest, httpRequestHandler,
  subflowManifest, subflowHandler
}
