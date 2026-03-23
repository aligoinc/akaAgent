const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://swggxlwfgwzzoszvolbm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2d4bHdmZ3d6em9zenZvbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODAxNDUsImV4cCI6MjA4ODk1NjE0NX0.8hOSI1yo_8vWO5Nk9cCVU6P4Aon9Xer6ifVOqlORlRM');

async function run() {
  const { data: accounts } = await supabase.from('auto_flatform_accounts').select('*');
  console.log('--- ACCOUNTS ---');
  console.log(accounts.map(a => ({ id: a.id, name: a.name, status: a.status, is_active: a.is_active, login_status: a.login_status })));

  const { data: campaigns } = await supabase.from('auto_campaigns').select('*');
  console.log('--- CAMPAIGNS ---');
  console.log(campaigns.map(c => ({ id: c.id, account_id: c.flatform_account_id, status: c.status, schedule: c.schedule })));
}
run();
