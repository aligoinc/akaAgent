import { createClient } from 'npm:@supabase/supabase-js@2.99.1'
import { createSessionHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
Deno.serve(request => {
  const deadline = AbortSignal.timeout(35_000)
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline }) }
  })
  return createSessionHandler(admin)(request)
})
