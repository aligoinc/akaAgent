const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://swggxlwfgwzzoszvolbm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2d4bHdmZ3d6em9zenZvbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODAxNDUsImV4cCI6MjA4ODk1NjE0NX0.8hOSI1yo_8vWO5Nk9cCVU6P4Aon9Xer6ifVOqlORlRM');
async function run() {
  const { data, error } = await supabase.from('auto_campaigns').update({ schedule: new Date().toISOString() }).eq('status', 'chờ xử lý');
  if (error) console.error(error); else console.log('Successfully updated pending campaigns schedule to now()');
}
run();
