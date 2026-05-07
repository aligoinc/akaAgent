import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { join } from 'path'

dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cgjbsmqtfhqvttudyjzq.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamJzbXF0ZmhxdnR0dWR5anpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxOTA0MzIsImV4cCI6MjA4MTc2NjQzMn0.UAukwYkUuoxWckoMUVgw0q1Eiptd9kGaPRddruf2ZOA'

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
