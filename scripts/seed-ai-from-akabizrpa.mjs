#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const REQUIRED_PROMPT_NAMES = ['rewrite_content', 'write_multi_other_content']
const WRITE_CONTENT_TASK_ID = 'write_content'

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

function optionalJson(value, fallback = {}) {
  const text = String(value || '').trim()
  if (!text) return fallback
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function buildSqlConfig() {
  const connectionString = String(process.env.AKABIZRPA_SQLSERVER_CONNECTION_STRING || '').trim()
  if (connectionString) return connectionString

  return {
    server: requiredEnv('AKABIZRPA_SQLSERVER_SERVER'),
    database: requiredEnv('AKABIZRPA_SQLSERVER_DATABASE'),
    user: requiredEnv('AKABIZRPA_SQLSERVER_USER'),
    password: requiredEnv('AKABIZRPA_SQLSERVER_PASSWORD'),
    port: Number(process.env.AKABIZRPA_SQLSERVER_PORT || 1433),
    options: {
      encrypt: String(process.env.AKABIZRPA_SQLSERVER_ENCRYPT || 'true').toLowerCase() !== 'false',
      trustServerCertificate: String(process.env.AKABIZRPA_SQLSERVER_TRUST_CERT || 'true').toLowerCase() !== 'false'
    },
    pool: {
      max: 2,
      min: 0,
      idleTimeoutMillis: 30000
    },
    requestTimeout: 60000,
    connectionTimeout: 60000
  }
}

async function loadMssql() {
  try {
    const mod = await import('mssql')
    return mod.default || mod
  } catch {
    throw new Error('Missing package "mssql". Run: npm install --save-dev mssql')
  }
}

async function fetchAkaBizAiSeed() {
  const sql = await loadMssql()
  const pool = await sql.connect(buildSqlConfig())
  try {
    const [settingsResult, taskResult, promptsResult] = await Promise.all([
      pool.request().query(`
        SELECT TOP 1
          ApiKeyChatGPT,
          ModelOpenAI,
          BodyModelOpenAI
        FROM AkaBizSetting
      `),
      pool.request()
        .input('id', sql.VarChar, WRITE_CONTENT_TASK_ID)
        .query(`
          SELECT TOP 1
            Id,
            ModelAI,
            BodyModelAI
          FROM TaskModelAI
          WHERE Id = @id
        `),
      pool.request().query(`
        SELECT
          Name,
          QuestionContent,
          ModelAI,
          BodyModelAI
        FROM QuestionContentAI
        WHERE Name IN ('rewrite_content', 'write_multi_other_content')
      `)
    ])

    return {
      setting: settingsResult.recordset[0] || {},
      taskModel: taskResult.recordset[0] || {},
      prompts: promptsResult.recordset || []
    }
  } finally {
    await pool.close()
  }
}

function promptByName(prompts, name) {
  return prompts.find(prompt => String(prompt.Name || '').trim() === name) || {}
}

async function upsertSupabase(seed) {
  const supabaseUrl = requiredEnv('SUPABASE_URL')
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || requiredEnv('SUPABASE_ANON_KEY')
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const writeContentPrompt = promptByName(seed.prompts, 'rewrite_content')
  const multiPrompt = promptByName(seed.prompts, 'write_multi_other_content')
  const model = String(seed.taskModel.ModelAI || writeContentPrompt.ModelAI || seed.setting.ModelOpenAI || 'gpt-5-mini').trim()
  const defaultBody = optionalJson(seed.taskModel.BodyModelAI || writeContentPrompt.BodyModelAI || seed.setting.BodyModelOpenAI)
  const apiKey = String(seed.setting.ApiKeyChatGPT || '').trim()

  if (!apiKey) {
    throw new Error('AkaBizSetting.ApiKeyChatGPT is empty; not updating ai_model.api_key.')
  }

  const modelUpdate = await supabase
    .from('ai_model')
    .upsert({
      code: 'openai_akabiz_write_content',
      provider: 'openai',
      model,
      endpoint: 'https://api.openai.com/v1/responses',
      api_key: apiKey,
      default_body: defaultBody,
      is_system: true,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'code' })

  if (modelUpdate.error) throw new Error(`Failed to upsert ai_model: ${modelUpdate.error.message}`)

  const promptRows = [
    {
      code: 'akabiz_rewrite_content',
      name: 'AkaBiz - Rewrite content',
      prompt_system: null,
      prompt_user: String(writeContentPrompt.QuestionContent || '').trim(),
      is_reasoning: false,
      is_system: true,
      is_active: true,
      updated_at: new Date().toISOString()
    },
    {
      code: 'akabiz_write_multi_other_content',
      name: 'AkaBiz - Write multi other content',
      prompt_system: null,
      prompt_user: String(multiPrompt.QuestionContent || '').trim(),
      is_reasoning: false,
      is_system: true,
      is_active: true,
      updated_at: new Date().toISOString()
    }
  ].filter(row => row.prompt_user)

  if (promptRows.length !== REQUIRED_PROMPT_NAMES.length) {
    const found = promptRows.map(row => row.code).join(', ') || 'none'
    throw new Error(`Missing required QuestionContentAI prompts. Upsertable prompts: ${found}`)
  }

  const promptUpdate = await supabase
    .from('ai_prompt')
    .upsert(promptRows, { onConflict: 'code' })

  if (promptUpdate.error) throw new Error(`Failed to upsert ai_prompt: ${promptUpdate.error.message}`)

  return {
    model,
    promptCodes: promptRows.map(row => row.code)
  }
}

async function main() {
  const seed = await fetchAkaBizAiSeed()
  const result = await upsertSupabase(seed)
  console.log(JSON.stringify({
    ok: true,
    model: result.model,
    prompts: result.promptCodes,
    apiKey: 'updated'
  }, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
