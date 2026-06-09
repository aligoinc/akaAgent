import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { PageController } from '../v2/runtime/pageController'

const LOCAL_DATA_DIR = 'local-data'
const SCREENSHOT_DIR = 'block-screenshots'

export interface CaptureBlockScreenshotOptions {
  page: PageController
  campaignId?: number | null
  accountId?: number | null
  runId?: number | null
  runStepId?: number | null
  nodeId?: string | null
  blockName?: string | null
  captureReason: 'success' | 'failure'
}

export interface CapturedBlockScreenshot {
  filePath: string
  fileName: string
  sizeBytes: number
  browserUrl: string
  capturedAt: string
}

export interface ScreenshotFileReadResult {
  filePath: string
  dataUrl: string
  sizeBytes: number
}

export function getBlockScreenshotRoot(): string {
  const dir = join(app.getPath('userData'), LOCAL_DATA_DIR, SCREENSHOT_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function captureBlockScreenshot(options: CaptureBlockScreenshotOptions): Promise<CapturedBlockScreenshot> {
  const capturedAt = new Date().toISOString()
  const root = getBlockScreenshotRoot()
  const dateDir = capturedAt.slice(0, 10)
  const campaignDir = `campaign-${sanitizePathToken(options.campaignId ?? 'manual', 'manual')}`
  const dir = join(root, campaignDir, dateDir)
  mkdirSync(dir, { recursive: true })

  const imageBase64 = await options.page.screenshot()
  const imageBuffer = Buffer.from(imageBase64, 'base64')
  const fileName = [
    formatTimestampForFile(capturedAt),
    `run-${sanitizePathToken(options.runId ?? 'manual', 'manual')}`,
    `step-${sanitizePathToken(options.runStepId ?? 'none', 'none')}`,
    sanitizePathToken(options.nodeId ?? 'node', 'node'),
    sanitizePathToken(options.blockName ?? 'block', 'block'),
    options.captureReason,
    Math.floor(Math.random() * 1e6).toString(36)
  ].filter(Boolean).join('_') + '.png'
  const filePath = join(dir, fileName)
  writeFileSync(filePath, imageBuffer)

  return {
    filePath,
    fileName,
    sizeBytes: statSync(filePath).size,
    browserUrl: options.page.getURL(),
    capturedAt
  }
}

export function readBlockScreenshotDataUrl(filePath: string): ScreenshotFileReadResult {
  assertSafeScreenshotPath(filePath)
  const imageBuffer = readFileSync(filePath)
  return {
    filePath,
    dataUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`,
    sizeBytes: imageBuffer.length
  }
}

function assertSafeScreenshotPath(filePath: string): void {
  const target = resolve(String(filePath || ''))
  const root = resolve(getBlockScreenshotRoot())
  const rel = relative(root, target)
  if (!target || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Đường dẫn screenshot không hợp lệ')
  }
  if (!target.toLowerCase().endsWith('.png')) {
    throw new Error('File screenshot phải là PNG')
  }
  if (!existsSync(target)) {
    throw new Error('Không tìm thấy file screenshot')
  }
}

function sanitizePathToken(value: unknown, fallback: string): string {
  const text = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return text || fallback
}

function formatTimestampForFile(value: string): string {
  return value.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}
