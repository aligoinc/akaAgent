import * as flowRepo from '../repositories/flowRepository'
import * as campaignActionRepo from '../repositories/campaignActionRepository'

const FACEBOOK_POST_ACTION_ID = 'facebook_timeline_post'
const FACEBOOK_POST_WORKFLOW_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const FACEBOOK_MSG_FRIEND_ACTION_ID = 'facebook_message_friend'

export async function seedBuiltinCampaignActions(): Promise<void> {
  // Seed facebook_message_friend
  const existingMsgFriend = await campaignActionRepo.getCampaignAction(FACEBOOK_MSG_FRIEND_ACTION_ID)
  if (!existingMsgFriend) {
    try {
      await campaignActionRepo.createCampaignAction({
        id: FACEBOOK_MSG_FRIEND_ACTION_ID,
        name: 'Facebook - Nhắn tin & Kết bạn đến bạn bè/UID',
        flatformType: 'facebook',
        isActive: true,
        workflowId: undefined
      })
      console.log('[Seed] Created built-in campaign action: facebook_message_friend')
    } catch (err) {
      console.error('[Seed] Failed to create facebook_message_friend action:', err)
    }
  }

  const existing = await campaignActionRepo.getCampaignAction(FACEBOOK_POST_ACTION_ID)
  if (existing) return

  const workflowNodes = [
    {
      id: 'node_get_content', type: 'actionNode', position: { x: 250, y: 50 },
      data: { actionType: 'blockInput', label: 'Lấy nội dung chiến dịch', icon: 'Download', category: 'block', config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {} }
    },
    {
      id: 'node_nav_fb', type: 'actionNode', position: { x: 250, y: 170 },
      data: { actionType: 'navigate', label: 'Mở Facebook', icon: 'Globe', category: 'navigation', config: { url: 'https://www.facebook.com' }, inputMapping: {} }
    },
    {
      id: 'node_wait_composer', type: 'actionNode', position: { x: 250, y: 290 },
      data: { actionType: 'waitForSelector', label: 'Chờ trang tải', icon: 'Clock', category: 'utility', config: { selector: '[role="main"]', timeout: 10000 }, inputMapping: {} }
    },
    {
      id: 'node_click_composer', type: 'actionNode', position: { x: 250, y: 410 },
      data: { actionType: 'click', label: 'Click ô đăng bài', icon: 'MousePointer', category: 'interaction', config: { selector: '[role="main"] [role="button"][tabindex="0"]' }, inputMapping: {} }
    },
    {
      id: 'node_wait_dialog', type: 'actionNode', position: { x: 250, y: 530 },
      data: { actionType: 'waitForSelector', label: 'Chờ hộp thoại đăng bài', icon: 'Clock', category: 'utility', config: { selector: '[role="dialog"] [contenteditable="true"]', timeout: 10000 }, inputMapping: {} }
    },
    {
      id: 'node_sleep_1', type: 'actionNode', position: { x: 250, y: 650 },
      data: { actionType: 'sleep', label: 'Đợi 2 giây', icon: 'Clock', category: 'utility', config: { duration: 2000 }, inputMapping: {} }
    },
    {
      id: 'node_type_content', type: 'actionNode', position: { x: 250, y: 770 },
      data: { actionType: 'type', label: 'Nhập nội dung bài đăng', icon: 'Type', category: 'interaction', config: { selector: '[role="dialog"] [contenteditable="true"]', text: '' }, inputMapping: { text: { sourceNodeId: 'node_get_content', sourceField: 'value' } } }
    },
    {
      id: 'node_sleep_2', type: 'actionNode', position: { x: 250, y: 890 },
      data: { actionType: 'sleep', label: 'Đợi 2 giây', icon: 'Clock', category: 'utility', config: { duration: 2000 }, inputMapping: {} }
    },
    {
      id: 'node_click_post', type: 'actionNode', position: { x: 250, y: 1010 },
      data: { actionType: 'click', label: 'Click nút Đăng', icon: 'MousePointer', category: 'interaction', config: { selector: '[role="dialog"] [aria-label="Đăng"], [role="dialog"] [aria-label="Post"]' }, inputMapping: {} }
    },
    {
      id: 'node_wait_done', type: 'actionNode', position: { x: 250, y: 1130 },
      data: { actionType: 'sleep', label: 'Chờ hoàn thành', icon: 'Clock', category: 'utility', config: { duration: 3000 }, inputMapping: {} }
    }
  ]

  const workflowEdges = [
    { id: 'e0', source: 'node_get_content', target: 'node_nav_fb' },
    { id: 'e1', source: 'node_nav_fb', target: 'node_wait_composer' },
    { id: 'e2', source: 'node_wait_composer', target: 'node_click_composer' },
    { id: 'e3', source: 'node_click_composer', target: 'node_wait_dialog' },
    { id: 'e4', source: 'node_wait_dialog', target: 'node_sleep_1' },
    { id: 'e5', source: 'node_sleep_1', target: 'node_type_content' },
    { id: 'e6', source: 'node_type_content', target: 'node_sleep_2' },
    { id: 'e7', source: 'node_sleep_2', target: 'node_click_post' },
    { id: 'e8', source: 'node_click_post', target: 'node_wait_done' }
  ]

  try {
    await flowRepo.saveFlow({
      id: FACEBOOK_POST_WORKFLOW_ID,
      name: '[Built-in] Đăng bài lên dòng thời gian Facebook',
      description: 'Workflow tự động đăng bài lên Facebook Timeline. Sử dụng nội dung từ campaign.',
      nodes: workflowNodes as any,
      edges: workflowEdges,
      variables: {},
      isBlock: false
    })

    await campaignActionRepo.createCampaignAction({
      id: FACEBOOK_POST_ACTION_ID,
      name: 'Facebook - Đăng bài lên trang cá nhân',
      flatformType: 'facebook',
      isActive: true,
      workflowId: FACEBOOK_POST_WORKFLOW_ID
    })

    console.log('[Seed] Created built-in campaign action: facebook_timeline_post')
  } catch (err) {
    console.error('[Seed] Failed to create built-in campaign action:', err)
  }
}
