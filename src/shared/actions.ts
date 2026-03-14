import { ActionDefinition } from './types'

/**
 * Built-in action definitions catalog
 */
export const builtinActions: ActionDefinition[] = [
  // =========== NAVIGATION ===========
  {
    id: 'navigate',
    name: 'Navigate',
    type: 'navigate',
    description: 'Navigate to a URL',
    icon: 'Globe',
    category: 'navigation',
    inputSchema: [
      { name: 'url', type: 'string', label: 'URL', required: true, placeholder: 'https://example.com' }
    ],
    outputSchema: [
      { name: 'currentUrl', type: 'string', label: 'Current URL' }
    ]
  },
  {
    id: 'goBack',
    name: 'Go Back',
    type: 'goBack',
    description: 'Go back to previous page',
    icon: 'ArrowLeft',
    category: 'navigation',
    inputSchema: [],
    outputSchema: [
      { name: 'currentUrl', type: 'string', label: 'Current URL' }
    ]
  },
  {
    id: 'goForward',
    name: 'Go Forward',
    type: 'goForward',
    description: 'Go forward to next page',
    icon: 'ArrowRight',
    category: 'navigation',
    inputSchema: [],
    outputSchema: [
      { name: 'currentUrl', type: 'string', label: 'Current URL' }
    ]
  },
  {
    id: 'reload',
    name: 'Reload',
    type: 'reload',
    description: 'Reload current page',
    icon: 'RotateCw',
    category: 'navigation',
    inputSchema: [],
    outputSchema: [
      { name: 'currentUrl', type: 'string', label: 'Current URL' }
    ]
  },

  // =========== INTERACTION ===========
  {
    id: 'click',
    name: 'Click',
    type: 'click',
    description: 'Click on an element',
    icon: 'MousePointerClick',
    category: 'interaction',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element', required: true, description: 'Drag an element here or select one' },
      { name: 'button', type: 'string', label: 'Mouse Button', defaultValue: 'left', options: [
        { label: 'Left', value: 'left' },
        { label: 'Right', value: 'right' },
        { label: 'Middle', value: 'middle' }
      ]},
      { name: 'clickCount', type: 'number', label: 'Click Count', defaultValue: 1 }
    ],
    outputSchema: [
      { name: 'success', type: 'boolean', label: 'Success' }
    ]
  },
  {
    id: 'type',
    name: 'Type Text',
    type: 'type',
    description: 'Type text into an input field',
    icon: 'Keyboard',
    category: 'interaction',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Input Element', required: true, description: 'Drag an element here or select one' },
      { name: 'text', type: 'string', label: 'Text', required: true, placeholder: 'Type text here...' },
      { name: 'delay', type: 'number', label: 'Typing Delay (ms)', defaultValue: 50 },
      { name: 'clearFirst', type: 'boolean', label: 'Clear First', defaultValue: true }
    ],
    outputSchema: [
      { name: 'success', type: 'boolean', label: 'Success' }
    ]
  },
  {
    id: 'scroll',
    name: 'Scroll',
    type: 'scroll',
    description: 'Scroll the page or an element',
    icon: 'ArrowUpDown',
    category: 'interaction',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Scroll Target (optional)', description: 'Leave empty for page scroll' },
      { name: 'direction', type: 'string', label: 'Direction', required: true, defaultValue: 'down', options: [
        { label: 'Down', value: 'down' },
        { label: 'Up', value: 'up' },
        { label: 'Left', value: 'left' },
        { label: 'Right', value: 'right' }
      ]},
      { name: 'amount', type: 'number', label: 'Amount (px)', defaultValue: 500 }
    ],
    outputSchema: [
      { name: 'scrollX', type: 'number', label: 'Scroll X' },
      { name: 'scrollY', type: 'number', label: 'Scroll Y' }
    ]
  },
  {
    id: 'hover',
    name: 'Hover',
    type: 'hover',
    description: 'Hover over an element',
    icon: 'Hand',
    category: 'interaction',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element', required: true, description: 'Drag an element here' }
    ],
    outputSchema: [
      { name: 'success', type: 'boolean', label: 'Success' }
    ]
  },
  {
    id: 'select',
    name: 'Select Option',
    type: 'select',
    description: 'Select an option from a dropdown',
    icon: 'ListChecks',
    category: 'interaction',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Select Element', required: true, description: 'Drag a dropdown here' },
      { name: 'value', type: 'string', label: 'Value', required: true }
    ],
    outputSchema: [
      { name: 'selectedValue', type: 'string', label: 'Selected Value' }
    ]
  },
  {
    id: 'pressKey',
    name: 'Press Key',
    type: 'pressKey',
    description: 'Press a keyboard key',
    icon: 'Command',
    category: 'interaction',
    inputSchema: [
      { name: 'key', type: 'string', label: 'Key', required: true, placeholder: 'Enter, Tab, Escape...' }
    ],
    outputSchema: [
      { name: 'success', type: 'boolean', label: 'Success' }
    ]
  },

  // =========== DATA ===========
  {
    id: 'getValue',
    name: 'Get Value',
    type: 'getValue',
    description: 'Get value of an input element',
    icon: 'FileInput',
    category: 'data',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Input Element', required: true, description: 'Drag an input element here' }
    ],
    outputSchema: [
      { name: 'value', type: 'string', label: 'Value' }
    ]
  },
  {
    id: 'setValue',
    name: 'Set Value',
    type: 'setValue',
    description: 'Set value of an input element',
    icon: 'FileOutput',
    category: 'data',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Input Element', required: true, description: 'Drag an input element here' },
      { name: 'value', type: 'string', label: 'Value', required: true }
    ],
    outputSchema: [
      { name: 'success', type: 'boolean', label: 'Success' }
    ]
  },
  {
    id: 'getText',
    name: 'Get Text',
    type: 'getText',
    description: 'Get text content of an element',
    icon: 'Type',
    category: 'data',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element', required: true, description: 'Drag an element here' }
    ],
    outputSchema: [
      { name: 'text', type: 'string', label: 'Text' }
    ]
  },
  {
    id: 'getAttribute',
    name: 'Get Attribute',
    type: 'getAttribute',
    description: 'Get attribute value of an element',
    icon: 'Tag',
    category: 'data',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element', required: true, description: 'Drag an element here' },
      { name: 'attribute', type: 'string', label: 'Attribute Name', required: true, placeholder: 'href, src, class...' }
    ],
    outputSchema: [
      { name: 'value', type: 'string', label: 'Attribute Value' }
    ]
  },
  {
    id: 'screenshot',
    name: 'Screenshot',
    type: 'screenshot',
    description: 'Take a screenshot',
    icon: 'Camera',
    category: 'data',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element (optional)', description: 'Leave empty for full page' },
      { name: 'fullPage', type: 'boolean', label: 'Full Page', defaultValue: false }
    ],
    outputSchema: [
      { name: 'imageBase64', type: 'string', label: 'Image (Base64)' }
    ]
  },

  // =========== UTILITY ===========
  {
    id: 'sleep',
    name: 'Sleep',
    type: 'sleep',
    description: 'Wait for a specified duration',
    icon: 'Clock',
    category: 'utility',
    inputSchema: [
      { name: 'ms', type: 'number', label: 'Duration (ms)', required: true, defaultValue: 1000 }
    ],
    outputSchema: []
  },
  {
    id: 'waitForSelector',
    name: 'Wait for Element',
    type: 'waitForSelector',
    description: 'Wait until an element appears on page',
    icon: 'Search',
    category: 'utility',
    inputSchema: [
      { name: 'selector', type: 'element', label: 'Target Element', required: true, description: 'Drag the element to wait for' },
      { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 },
      { name: 'state', type: 'string', label: 'State', defaultValue: 'visible', options: [
        { label: 'Visible', value: 'visible' },
        { label: 'Hidden', value: 'hidden' },
        { label: 'Attached', value: 'attached' },
        { label: 'Detached', value: 'detached' }
      ]}
    ],
    outputSchema: [
      { name: 'found', type: 'boolean', label: 'Found' }
    ]
  },
  {
    id: 'waitForNavigation',
    name: 'Wait for Navigation',
    type: 'waitForNavigation',
    description: 'Wait for page navigation to complete',
    icon: 'Loader',
    category: 'utility',
    inputSchema: [
      { name: 'timeout', type: 'number', label: 'Timeout (ms)', defaultValue: 30000 }
    ],
    outputSchema: [
      { name: 'url', type: 'string', label: 'New URL' }
    ]
  },

  // =========== CONTROL FLOW ===========
  {
    id: 'ifElse',
    name: 'If / Else',
    type: 'ifElse',
    description: 'Conditional branching',
    icon: 'GitBranch',
    category: 'control',
    inputSchema: [
      { name: 'condition', type: 'string', label: 'Condition', required: true, placeholder: '{{variable}} === "value"' },
    ],
    outputSchema: [
      { name: 'result', type: 'boolean', label: 'Condition Result' }
    ]
  },
  {
    id: 'loop',
    name: 'Loop',
    type: 'loop',
    description: 'Repeat actions',
    icon: 'Repeat',
    category: 'control',
    inputSchema: [
      { name: 'loopType', type: 'string', label: 'Loop Type', required: true, defaultValue: 'count', options: [
        { label: 'Count', value: 'count' },
        { label: 'While', value: 'while' },
        { label: 'For Each', value: 'forEach' }
      ]},
      { name: 'count', type: 'number', label: 'Count', defaultValue: 5 },
      { name: 'condition', type: 'string', label: 'While Condition', placeholder: '{{variable}} < 10' },
      { name: 'items', type: 'json', label: 'Items (for each)', placeholder: '["a","b","c"]' }
    ],
    outputSchema: [
      { name: 'index', type: 'number', label: 'Current Index' },
      { name: 'item', type: 'any', label: 'Current Item' },
      { name: 'completed', type: 'boolean', label: 'Loop Completed' }
    ]
  },
  {
    id: 'switch',
    name: 'Switch',
    type: 'switch',
    description: 'Switch between multiple cases',
    icon: 'GitFork',
    category: 'control',
    inputSchema: [
      { name: 'value', type: 'string', label: 'Value', required: true, placeholder: '{{variable}}' },
      { name: 'cases', type: 'json', label: 'Cases', required: true, placeholder: '["case1","case2","default"]' }
    ],
    outputSchema: [
      { name: 'matchedCase', type: 'string', label: 'Matched Case' }
    ]
  },
  // =========== BLOCK SYSTEM ===========
  {
    id: 'blockInput',
    name: 'Block Input',
    type: 'blockInput',
    description: 'Defines an input parameter for a Reusable Block',
    icon: 'LogIn',
    category: 'block',
    inputSchema: [
      { name: 'fieldName', type: 'string', label: 'Field Name', required: true, placeholder: 'e.g. searchKeyword' },
      { name: 'fieldType', type: 'string', label: 'Field Type', required: true, defaultValue: 'string', options: [
        { label: 'String', value: 'string' },
        { label: 'Number', value: 'number' },
        { label: 'Boolean', value: 'boolean' },
        { label: 'Element', value: 'element' },
        { label: 'JSON', value: 'json' }
      ]},
      { name: 'fieldLabel', type: 'string', label: 'Display Label', placeholder: 'e.g. Search Keyword' },
      { name: 'defaultValue', type: 'json', label: 'Default/Test Value', placeholder: '{"key": "value"}' }
    ],
    outputSchema: [
      { name: 'value', type: 'any', label: 'Input Value' }
    ]
  },
  {
    id: 'blockOutput',
    name: 'Block Output',
    type: 'blockOutput',
    description: 'Defines an output value returned from a Reusable Block',
    icon: 'LogOut',
    category: 'block',
    inputSchema: [
      { name: 'fieldName', type: 'string', label: 'Output Name', required: true, placeholder: 'e.g. extractedText' },
      { name: 'fieldLabel', type: 'string', label: 'Display Label', placeholder: 'e.g. Extracted Text' },
      { name: 'value', type: 'any', label: 'Output Value', description: 'Map this to a node output to return it.' }
    ],
    outputSchema: []
  }
]
