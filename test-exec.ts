import { WebviewController } from './src/main/playwright/webviewController.ts'

const wcMock = {
  executeJavaScript: async (code) => {
    try {
      console.log('--- EXECUTING ---')
      console.log(code)
      // Test syntax compilation
      new Function(code)
      console.log('--- COMPILED OK ---')
      return { success: true }
    } catch (e) {
      console.log('--- SYNTAX ERROR ---')
      console.log(e.message)
      return { __error: true, message: e.message }
    }
  },
  isDestroyed: () => false
}

async function run() {
  const ctrl = new WebviewController(wcMock as any)
  
  await ctrl.executeAction('click', { selector: 'div[name="test"]' })
  await ctrl.executeAction('type', { selector: 'input', text: 'hello world', clearFirst: true })
  await ctrl.executeAction('type', { selector: 'input', text: 'hello world', clearFirst: false })
  await ctrl.executeAction('scroll', { direction: 'down', amount: 500 })
  await ctrl.executeAction('select', { selector: 'select', value: 'opt1' })
  await ctrl.executeAction('pressKey', { key: 'Enter' })
  await ctrl.executeAction('getValue', { selector: 'input' })
}

run().catch(console.error)
