const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://swggxlwfgwzzoszvolbm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2d4bHdmZ3d6em9zenZvbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODAxNDUsImV4cCI6MjA4ODk1NjE0NX0.8hOSI1yo_8vWO5Nk9cCVU6P4Aon9Xer6ifVOqlORlRM');

const newNodes = [
  // 1. Get detailUid (the URL)
  {
    "id": "node-input-uid",
    "type": "actionNode",
    "position": { "x": 100, "y": 100 },
    "data": {
      "icon": "LogIn",
      "label": "Nhận UID / Link",
      "actionType": "blockInput",
      "category": "block",
      "config": {
        "fieldName": "detailUid",
        "defaultValue": "https://www.facebook.com/groups/2260804924238978" // fallback
      },
      "inputMapping": {}
    }
  },
  // 2. Get campaignContent
  {
    "id": "node-input-content",
    "type": "actionNode",
    "position": { "x": 100, "y": 250 },
    "data": {
      "icon": "LogIn",
      "label": "Nhận Nội dung Text",
      "actionType": "blockInput",
      "category": "block",
      "config": {
        "fieldName": "campaignContent",
        "defaultValue": "Test bài" // fallback
      },
      "inputMapping": {}
    }
  },
  // 3. Navigate
  {
    "id": "node-navigate",
    "type": "actionNode",
    "position": { "x": 400, "y": 100 },
    "data": {
      "icon": "Globe",
      "label": "Truy cập Group",
      "actionType": "navigate",
      "category": "navigation",
      "config": {},
      "inputMapping": {
        "url": {
          "sourceNodeId": "node-input-uid",
          "sourceField": "value"
        }
      }
    }
  },
  // 4. Wait for Navigation
  {
    "id": "node-wait-nav",
    "type": "actionNode",
    "position": { "x": 700, "y": 100 },
    "data": {
      "icon": "Loader",
      "label": "Chờ tải trang",
      "actionType": "waitForNavigation",
      "category": "utility",
      "config": {
        "timeout": 30000
      },
      "inputMapping": {}
    }
  },
  // 5. Block: Đăng bài trong group
  {
    "id": "node-block-post",
    "type": "actionNode",
    "position": { "x": 1000, "y": 100 },
    "data": {
      "icon": "Package",
      "label": "đăng bài trong group",
      "actionType": "block",
      "category": "block",
      "config": {
        "blockId": "7f90aa52-f239-4f34-af3b-16ba5484c6fe"
      },
      // Note: The original block had inputSchema with "campaign", we map it to the generated content
      "inputMapping": {
        "campaign": {
          "sourceNodeId": "node-input-content",
          "sourceField": "value"
        }
      },
      "blockData": {
        "id": "7f90aa52-f239-4f34-af3b-16ba5484c6fe",
        "name": "đăng bài trong group",
        "inputSchema": [
          { "name": "campaign", "type": "string", "label": "campaign", "required": true }
        ]
      }
    }
  },
  // 6. Output Hoàn thành
  {
    "id": "node-output",
    "type": "actionNode",
    "position": { "x": 1300, "y": 100 },
    "data": {
      "icon": "LogOut",
      "label": "Báo Xong",
      "actionType": "blockOutput",
      "category": "block",
      "config": {
        "fieldName": "res",
        "value": "Hoàn thành"
      },
      "inputMapping": {}
    }
  }
];

const newEdges = [
  {
    "id": "xy-edge__node-input-uidoutput-node-navigateinput",
    "source": "node-input-uid",
    "target": "node-navigate",
    "sourceHandle": "output",
    "targetHandle": "input"
  },
  {
    "id": "xy-edge__node-navigateoutput-node-wait-navinput",
    "source": "node-navigate",
    "target": "node-wait-nav",
    "sourceHandle": "output",
    "targetHandle": "input"
  },
  {
    "id": "xy-edge__node-wait-navoutput-node-block-postinput",
    "source": "node-wait-nav",
    "target": "node-block-post",
    "sourceHandle": "output",
    "targetHandle": "input"
  },
  {
    "id": "xy-edge__node-block-postoutput-node-outputinput",
    "source": "node-block-post",
    "target": "node-output",
    "sourceHandle": "output",
    "targetHandle": "input"
  }
];

async function run() {
  const workflowId = 'b047eb2a-5d80-42b3-94f3-532810b360f0'; // from previous check
  
  const { data, error } = await supabase
    .from('auto_flows')
    .update({
      nodes: newNodes,
      edges: newEdges
    })
    .eq('id', workflowId);
    
  if (error) console.error('Error:', error);
  else console.log('Successfully updated the workflow!');
}

run();
