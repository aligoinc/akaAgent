import { ElementDefinition } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapElementFromDB } from '../mappers'

const client = () => getSupabaseClient()

export async function saveElement(element: Omit<ElementDefinition, 'createdAt' | 'updatedAt'>): Promise<ElementDefinition> {
  const payload = {
    id: element.id,
    name: element.name,
    xpath: element.xpath,
    description: element.description || '',
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('auto_elements')
    .upsert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to save element: ${error.message}`)
  return mapElementFromDB(data)
}

export async function listElements(): Promise<ElementDefinition[]> {
  const { data, error } = await client()
    .from('auto_elements')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list elements: ${error.message}`)
  return (data || []).map(row => mapElementFromDB(row))
}

export async function deleteElement(elementId: string): Promise<void> {
  const { error } = await client()
    .from('auto_elements')
    .delete()
    .eq('id', elementId)

  if (error) throw new Error(`Failed to delete element: ${error.message}`)
}
