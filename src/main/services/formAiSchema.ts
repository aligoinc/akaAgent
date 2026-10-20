import { Ajv } from 'ajv'
import { FORM_AI_SECTIONS, type FormAiSection } from '../../shared/campaignFormAiConfig'
import { SCHEDULE_AI_SCHEMA } from '../../shared/campaignScheduleAi'
import { LIMITS_AI_SCHEMA } from '../../shared/campaignLimitsAi'

type Schema = Record<string, unknown>
const record = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)
const sorted = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : value)

/** The DB may refine constraints/descriptions, but cannot change the form's wire contract. */
function compatible(schema: Schema, contract: Schema): boolean {
  if (sorted(schema.type) !== sorted(contract.type)) return false
  if (contract.type === 'object') {
    if (schema.additionalProperties !== false || sorted(schema.required) !== sorted(contract.required)
      || !record(schema.properties) || !record(contract.properties)
      || sorted(Object.keys(schema.properties)) !== sorted(Object.keys(contract.properties))) return false
    for (const key of Object.keys(contract.properties)) {
      if (!record(schema.properties[key]) || !compatible(schema.properties[key] as Schema, contract.properties[key] as Schema)) return false
    }
  }
  if (contract.type === 'array' && (!record(schema.items) || !compatible(schema.items, contract.items as Schema))) return false
  return true
}

export function compileFormAiSchema(schema: unknown, section: FormAiSection): (content: string) => boolean {
  const contract = section === FORM_AI_SECTIONS.schedule ? SCHEDULE_AI_SCHEMA : LIMITS_AI_SCHEMA
  if (!record(schema) || JSON.stringify(schema).length > 64_000 || !compatible(schema, contract)) {
    throw new Error('JSON Schema không tương thích với section.')
  }
  // Local draft-07 compilation only: no remote references, coercion, defaults, or data mutation.
  const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: false, addUsedSchema: false })
  const validate = ajv.compile(schema)
  return content => {
    if (content.length > 16_000) return false
    try { return validate(JSON.parse(content)) === true } catch { return false }
  }
}

export function formAiStructuredOptions(provider: string, endpoint: string, schema: unknown, section: FormAiSection): Schema {
  const url = new URL(endpoint)
  if (provider !== 'openai' || url.protocol !== 'https:'
    || !/\/(responses|chat\/completions)\/?$/.test(url.pathname)) {
    throw new Error('Model AI không tương thích Structured Outputs.')
  }
  const name = section === FORM_AI_SECTIONS.schedule ? 'campaign_schedule' : 'campaign_action_limits'
  return {
    store: false,
    ...(/\/responses\/?$/.test(url.pathname)
      ? { text: { format: { type: 'json_schema', name, strict: true, schema } } }
      : { response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } })
  }
}
