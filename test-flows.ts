import { SupabaseService } from './src/main/services/supabase'

async function run() {
  const supabase = new SupabaseService()

  // Find the campaign action's workflow (the PARENT workflow, not the block itself)
  const campaigns = await supabase.listCampaigns()
  if (campaigns.length === 0) { console.log("No campaigns"); return }
  
  const campaign = campaigns[0]
  console.log("Campaign:", campaign.name, "actionId:", campaign.actionId, "content:", campaign.content)
  
  // Get the action
  const actions = await supabase.listCampaignActions()
  const action = actions.find(a => a.id === campaign.actionId)
  console.log("Action:", action?.name, "workflowId:", action?.workflowId)
  
  if (!action?.workflowId) { console.log("No workflowId"); return }
  
  // Load parent workflow
  const parentFlow = await supabase.loadFlow(action.workflowId)
  if (!parentFlow) { console.log("No parent flow"); return }
  
  console.log("Parent workflow:", parentFlow.name)
  console.log("Parent nodes:", JSON.stringify(parentFlow.nodes.map(n => ({
    id: n.id,
    type: n.data.actionType,
    label: n.data.label,
    config: n.data.config,
    inputMapping: n.data.inputMapping
  })), null, 2))
}

run()
