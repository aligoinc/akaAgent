import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { join } from 'path'

dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swggxlwfgwzzoszvolbm.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2d4bHdmZ3d6em9zenZvbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODAxNDUsImV4cCI6MjA4ODk1NjE0NX0.8hOSI1yo_8vWO5Nk9cCVU6P4Aon9Xer6ifVOqlORlRM'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    try {
      _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e)
      _client = createClient('https://dummy.supabase.co', 'dummy')
    }
  }
  return _client
}
