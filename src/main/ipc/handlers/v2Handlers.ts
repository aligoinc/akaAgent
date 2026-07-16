import { ipcMain, BrowserWindow } from 'electron'
import { IPC_EVENTS_V2, BlockDef, WorkflowDef, ElementDef, RunStepV2 } from '../../../shared/v2Types'
import * as blockRepo from '../../data/repositories/blockRepository'
import * as workflowV2Repo from '../../data/repositories/workflowV2Repository'
import * as elementV2Repo from '../../data/repositories/elementV2Repository'
import * as runV2Repo from '../../data/repositories/runV2Repository'
import { PageControllerRegistry } from '../../v2/runtime/pageController'
import { WorkflowEngineV2 } from '../../v2/runtime/workflowEngine'
import { BlockExecutor } from '../../v2/runtime/blockExecutor'
import { callAiUsing } from '../../services/aiRuntimeService'
import { captureBlockScreenshot } from '../../services/blockScreenshotService'
import * as campaignRunEventRepo from '../../data/repositories/campaignRunEventRepository'
import * as accountRepo from '../../data/repositories/accountRepository'

const _activeAborts = new Map<string, AbortController>()

export function registerV2Handlers(mainWindow: BrowserWindow, pageRegistry: PageControllerRegistry): void {
  const engine = new WorkflowEngineV2()
  const blockExec = new BlockExecutor()

  const assertDomTestAccountAllowed = async (accountId: number): Promise<void> => {
    const account = await accountRepo.getAccount(accountId)
    if (!account) throw new Error(`Không tìm thấy tài khoản (accountId=${accountId})`)
    if (String(account.flatformType || '').trim().toLowerCase() === 'zalo') {
      throw new Error('Zalo Web chỉ dùng tab để đăng nhập; không hỗ trợ DOM workflow/block test')
    }
  }

  // ===== Block library CRUD =====
  ipcMain.handle(IPC_EVENTS_V2.BLOCK_LIST, async () => blockRepo.listBlocks())
  ipcMain.handle(IPC_EVENTS_V2.BLOCK_GET, async (_, id: number) => blockRepo.getBlock(id))
  ipcMain.handle(IPC_EVENTS_V2.BLOCK_SAVE, async (_, payload: Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }) => {
    return blockRepo.saveBlock(payload)
  })
  ipcMain.handle(IPC_EVENTS_V2.BLOCK_DELETE, async (_, id: number) => {
    await blockRepo.deleteBlock(id)
    return { success: true }
  })

  // ===== Workflow CRUD =====
  ipcMain.handle(IPC_EVENTS_V2.WORKFLOW_LIST, async () => workflowV2Repo.listWorkflows())
  ipcMain.handle(IPC_EVENTS_V2.WORKFLOW_GET, async (_, id: number) => workflowV2Repo.getWorkflow(id))
  ipcMain.handle(IPC_EVENTS_V2.WORKFLOW_SAVE, async (_, payload: Partial<WorkflowDef> & { name: string }) => {
    return workflowV2Repo.saveWorkflow(payload)
  })
  ipcMain.handle(IPC_EVENTS_V2.WORKFLOW_DELETE, async (_, id: number) => {
    await workflowV2Repo.deleteWorkflow(id)
    return { success: true }
  })

  // ===== Element library CRUD =====
  ipcMain.handle(IPC_EVENTS_V2.ELEMENT_LIST, async () => elementV2Repo.listElements())
  ipcMain.handle(IPC_EVENTS_V2.ELEMENT_GET, async (_, id: number) => elementV2Repo.getElement(id))
  ipcMain.handle(IPC_EVENTS_V2.ELEMENT_SAVE, async (_, payload: Partial<ElementDef> & { name: string; xpath: string }) => {
    return elementV2Repo.saveElement(payload)
  })
  ipcMain.handle(IPC_EVENTS_V2.ELEMENT_DELETE, async (_, id: number) => {
    await elementV2Repo.deleteElement(id)
    return { success: true }
  })

  // ===== Test runs (in editor) =====
  ipcMain.handle(IPC_EVENTS_V2.WORKFLOW_TEST_RUN, async (_, args: {
    runKey: string
    workflowId?: number
    workflow?: WorkflowDef
    accountId: number
    variables: Record<string, unknown>
  }) => {
    await assertDomTestAccountAllowed(args.accountId)
    const page = pageRegistry.get(args.accountId)
    if (!page) throw new Error(`Tài khoản chưa mở trình duyệt (accountId=${args.accountId})`)

    const abort = new AbortController()
    _activeAborts.set(args.runKey, abort)

    try {
      const wf = args.workflow ?? args.workflowId
      if (!wf) throw new Error('Phải truyền workflowId hoặc workflow')
      const result = await engine.run(
        wf as number | WorkflowDef,
        args.variables ?? {},
        page,
        {
          accountId: args.accountId,
          signal: abort.signal,
          persist: true,
          runtimeHelpers: {
            callAIUsing: (code, payload, metadata) => callAiUsing(code, payload, metadata)
          },
          onBlockScreenshot: async (request, screenshotPage) => {
            try {
              const output = request.output || {}
              const rawMessage = String(
                request.error ||
                output.error ||
                output.message ||
                output.reason ||
                (request.stepStatus === 'error' ? 'Lỗi không xác định' : 'Thao tác thất bại')
              ).trim()
              const runResultStatus = request.captureReason === 'success'
                ? 'success'
                : request.stepStatus === 'error'
                  ? 'error'
                  : 'failure'
              const runResultMessage = runResultStatus === 'success' ? 'Thành công' : rawMessage
              const runResultDisplay = runResultStatus === 'success'
                ? 'Hành động thành công'
                : runResultStatus === 'error'
                  ? `Lỗi: ${runResultMessage}`
                  : `Thất bại: ${runResultMessage}`
              const eventStatus = runResultStatus === 'success'
                ? 'success'
                : runResultStatus === 'error'
                  ? 'error'
                  : 'failed'
              const screenshot = await captureBlockScreenshot({
                page: screenshotPage,
                accountId: request.accountId ?? args.accountId,
                campaignId: request.campaignId ?? null,
                runId: request.runId ?? null,
                runStepId: request.runStepId ?? null,
                nodeId: request.nodeId,
                blockName: request.blockName,
                captureReason: request.captureReason
              })
              await campaignRunEventRepo.createCampaignRunEvents([{
                campaignId: request.campaignId ?? null,
                campaignInputId: request.campaignInputId ?? null,
                campaignInputDataId: request.campaignInputDataId ?? null,
                accountId: request.accountId ?? args.accountId,
                runId: request.runId ?? null,
                runStepId: request.runStepId ?? null,
                nodeId: request.nodeId,
                blockId: request.blockId ?? null,
                blockName: request.blockName ?? null,
                eventType: 'browser_screenshot',
                eventName: 'block_screenshot',
                targetType: 'browser',
                status: eventStatus,
                isUserVisible: true,
                targetUrl: screenshot.browserUrl,
                message: runResultDisplay,
                debugData: {
                  screenshotPath: screenshot.filePath,
                  screenshotFileName: screenshot.fileName,
                  screenshotSizeBytes: screenshot.sizeBytes,
                  browserUrl: screenshot.browserUrl,
                  runResultStatus,
                  runResultStatusLabel: runResultStatus === 'success' ? 'Thành công' : runResultStatus === 'error' ? 'Lỗi' : 'Thất bại',
                  runResultMessage,
                  runResultDisplay,
                  actionName: 'Hành động',
                  targetName: '',
                  errorCode: null,
                  captureTiming: request.captureTiming,
                  captureOn: request.captureOn,
                  captureReason: request.captureReason,
                  stepStatus: request.stepStatus,
                  error: request.error ?? null,
                  capturedAt: screenshot.capturedAt,
                  blockStartedAt: request.startedAt ?? null,
                  blockCompletedAt: request.completedAt ?? null
                }
              }])
            } catch (err) {
              console.warn('[v2Handlers] block screenshot capture failed:', err)
            }
          },
          onStepProgress: (step: RunStepV2) => {
            mainWindow.webContents.send(IPC_EVENTS_V2.RUN_PROGRESS, { runKey: args.runKey, step })
          },
          onLog: (entry) => {
            mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: args.runKey, ...entry })
          }
        }
      )
      return result
    } finally {
      _activeAborts.delete(args.runKey)
    }
  })

  ipcMain.handle(IPC_EVENTS_V2.BLOCK_TEST_RUN, async (_, args: {
    runKey: string
    blockId?: number
    code?: string
    blockName?: string
    config: Record<string, unknown>
    accountId: number
    variables: Record<string, unknown>
  }) => {
    await assertDomTestAccountAllowed(args.accountId)
    const page = pageRegistry.get(args.accountId)
    if (!page) throw new Error(`Tài khoản chưa mở trình duyệt (accountId=${args.accountId})`)

    let code = args.code ?? ''
    let blockName = args.blockName ?? 'test'
    if (args.blockId) {
      const b = await blockRepo.getBlock(args.blockId)
      if (!b) throw new Error(`Block không tồn tại: ${args.blockId}`)
      code = code || b.code
      blockName = blockName || b.name
    }

    const abort = new AbortController()
    _activeAborts.set(args.runKey, abort)

    try {
      const result = await blockExec.execute(
        { code, blockName },
        {
          input: args.config ?? {},
          page,
          vars: args.variables ?? {},
          signal: abort.signal,
          runtimeHelpers: {
            callAIUsing: (usingCode, payload, metadata) => callAiUsing(usingCode, payload, metadata)
          },
          runtimeMetadata: {
            accountId: args.accountId,
            blockId: args.blockId,
            blockName
          },
          onLog: (line: string) => {
            mainWindow.webContents.send(IPC_EVENTS_V2.RUN_LOG, { runKey: args.runKey, nodeId: 'standalone', line })
          }
        }
      )
      return result
    } finally {
      _activeAborts.delete(args.runKey)
    }
  })

  ipcMain.handle(IPC_EVENTS_V2.RUN_STOP, (_, runKey: string) => {
    const abort = _activeAborts.get(runKey)
    if (abort) {
      abort.abort()
      _activeAborts.delete(runKey)
      return { success: true }
    }
    return { success: false, reason: 'Không tìm thấy run đang chạy' }
  })

  // ===== Run history =====
  ipcMain.handle('v2:run:list-by-workflow', async (_, workflowId: number) => {
    return runV2Repo.listRunsByWorkflow(workflowId)
  })
  ipcMain.handle('v2:run:list-steps', async (_, runId: number) => {
    return runV2Repo.listRunSteps(runId)
  })
}
