const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://swggxlwfgwzzoszvolbm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2d4bHdmZ3d6em9zenZvbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODAxNDUsImV4cCI6MjA4ODk1NjE0NX0.8hOSI1yo_8vWO5Nk9cCVU6P4Aon9Xer6ifVOqlORlRM');

const newNodes = [
  { id: "node-input-uid", type: "actionNode", position: { x: 50, y: 100 },
    data: { actionType: "blockInput", category: "block", config: { fieldName: "detailUid" } }
  },
  { id: "node-input-content", type: "actionNode", position: { x: 50, y: 250 },
    data: { actionType: "blockInput", category: "block", config: { fieldName: "campaignContent" } }
  },
  { id: "node-log-start", type: "actionNode", position: { x: 300, y: 100 },
    data: { actionType: "writeCampaignLog", category: "utility", 
      config: { message: "🚀 Bắt đầu xử lý group mới từ bên trong Workflow!" } }
  },
  { id: "node-update-running", type: "actionNode", position: { x: 550, y: 100 },
    data: { actionType: "updateCampaignStatus", category: "utility", 
      config: { status: "đang chạy" } }
  },
  { id: "node-navigate", type: "actionNode", position: { x: 800, y: 100 },
    data: { actionType: "navigate", category: "navigation", config: {},
      inputMapping: { url: { sourceNodeId: "node-input-uid", sourceField: "value" } } }
  },
  { id: "node-wait-nav", type: "actionNode", position: { x: 1050, y: 100 },
    data: { actionType: "waitForNavigation", category: "utility", config: { timeout: 30000 } }
  },
  { id: "node-block-post", type: "actionNode", position: { x: 1300, y: 100 },
    data: { actionType: "block", category: "block", config: { blockId: "7f90aa52-f239-4f34-af3b-16ba5484c6fe" },
      inputMapping: { campaign: { sourceNodeId: "node-input-content", sourceField: "value" } },
      blockData: { id: "7f90aa52-f239-4f34-af3b-16ba5484c6fe", name: "đăng bài trong group", inputSchema: [ {name: 'campaign'} ] }
    }
  },
  { id: "node-log-success", type: "actionNode", position: { x: 1550, y: 100 },
    data: { actionType: "writeCampaignLog", category: "utility", 
      config: { message: "✅ Đã đăng bài thành công xong!" } }
  },
  { id: "node-update-success", type: "actionNode", position: { x: 1800, y: 100 },
    data: { actionType: "updateCampaignStatus", category: "utility", 
      config: { status: "hoàn thành" } }
  },
  { id: "node-output", type: "actionNode", position: { x: 2050, y: 100 },
    data: { actionType: "blockOutput", category: "block", config: { fieldName: "res", value: "Hoàn thành" } }
  }
];

const newEdges = [
  { id: "e1", source: "node-input-uid", target: "node-log-start", sourceHandle: "output", targetHandle: "input" },
  { id: "e2", source: "node-log-start", target: "node-update-running", sourceHandle: "output", targetHandle: "input" },
  { id: "e3", source: "node-update-running", target: "node-navigate", sourceHandle: "output", targetHandle: "input" },
  { id: "e4", source: "node-navigate", target: "node-wait-nav", sourceHandle: "output", targetHandle: "input" },
  { id: "e5", source: "node-wait-nav", target: "node-block-post", sourceHandle: "output", targetHandle: "input" },
  { id: "e6", source: "node-block-post", target: "node-log-success", sourceHandle: "output", targetHandle: "input" },
  { id: "e7", source: "node-log-success", target: "node-update-success", sourceHandle: "output", targetHandle: "input" },
  { id: "e8", source: "node-update-success", target: "node-output", sourceHandle: "output", targetHandle: "input" }
];

async function run() {
  const workflowId = 'b047eb2a-5d80-42b3-94f3-532810b360f0';
  const { error } = await supabase.from('auto_flows').update({ nodes: newNodes, edges: newEdges }).eq('id', workflowId);
  if (error) console.error(error); else console.log('Successfully updated workflow with API nodes!');
}
run();
