-- v284: Run six Facebook campaign actions as one managed Page per execution.
-- Source: linked production cgjbsmqtfhqvttudyjzq, captured 2026-09-15.
-- Data only: no RPC/schema changes, no PostgREST reload, no helper DDL.
-- Both production and test graphs are patched independently; existing DOM blocks stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
  v_patch jsonb := $patch$[
  {
    "id": 244,
    "checksum": "eb352f6f26f1526239d2c989630a7fe9",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 100,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 100,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -120,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -120,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -120,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 100,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 100,
          "y": 1260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 500,
          "y": 1390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 500,
          "y": 1520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 280,
          "y": 1650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 280,
          "y": 1780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 500,
          "y": 1910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 500,
          "y": 2040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-resolve_url",
        "source": "page_identity_enter",
        "target": "resolve_url"
      },
      {
        "id": "e-merge_end-page_identity_capture_result",
        "source": "merge_end",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 1,
    "checksum": "d5ab620b8e2763801bfcc330ae5ec25b",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": -260,
          "y": -1140
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": -260,
          "y": -1010
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -480,
          "y": -880
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -480,
          "y": -750
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -480,
          "y": -620
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": -260,
          "y": -460
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": -260,
          "y": 2160
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 140,
          "y": 2290
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 140,
          "y": 2420
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": -80,
          "y": 2550
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": -80,
          "y": 2680
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 140,
          "y": 2810
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 140,
          "y": 2940
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-if_copy_source",
        "source": "page_identity_enter",
        "target": "if_copy_source"
      },
      {
        "id": "e-merge_join-page_identity_capture_result",
        "source": "merge_join",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 247,
    "checksum": "eba78c98f43b07873bacf8e4d3725465",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-prepare",
        "source": "page_identity_enter",
        "target": "prepare"
      },
      {
        "id": "e-summary-page_identity_capture_result",
        "source": "summary",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 252,
    "checksum": "2e2c60f22a39af9d53c59d5d04b56063",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": -260,
          "y": -1140
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": -260,
          "y": -1010
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -480,
          "y": -880
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -480,
          "y": -750
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -480,
          "y": -620
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": -260,
          "y": -460
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": -260,
          "y": 2160
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 140,
          "y": 2290
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 140,
          "y": 2420
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": -80,
          "y": 2550
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": -80,
          "y": 2680
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 140,
          "y": 2810
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 140,
          "y": 2940
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-if_copy_source",
        "source": "page_identity_enter",
        "target": "if_copy_source"
      },
      {
        "id": "e-merge_join-page_identity_capture_result",
        "source": "merge_join",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 284,
    "checksum": "43c679f22feee79941ef01d32fe29c59",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-join_group",
        "source": "page_identity_enter",
        "target": "join_group"
      },
      {
        "id": "e-join_group-page_identity_capture_result",
        "source": "join_group",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 239,
    "checksum": "75ef16e9ad553b20124b3992ff0e1581",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-prepare",
        "source": "page_identity_enter",
        "target": "prepare"
      },
      {
        "id": "e-summary-page_identity_capture_result",
        "source": "summary",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 285,
    "checksum": "1b0806729693e77df5b99962bf805baa",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-join_group",
        "source": "page_identity_enter",
        "target": "join_group"
      },
      {
        "id": "e-join_group-page_identity_capture_result",
        "source": "join_group",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 207,
    "checksum": "92a100df976017dd35ec4968c43eba10",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 100,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 100,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -120,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -120,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -120,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 100,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 100,
          "y": 1260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 500,
          "y": 1390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 500,
          "y": 1520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 280,
          "y": 1650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 280,
          "y": 1780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 500,
          "y": 1910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 500,
          "y": 2040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-resolve_url",
        "source": "page_identity_enter",
        "target": "resolve_url"
      },
      {
        "id": "e-merge_end-page_identity_capture_result",
        "source": "merge_end",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 206,
    "checksum": "8f74de83805501c50373b94159bbf5d8",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 440
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 570
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 700
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 830
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 960
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 1090
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1220
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-node-open-group",
        "source": "page_identity_enter",
        "target": "node-open-group"
      },
      {
        "id": "e-node-summary-page_identity_capture_result",
        "source": "node-summary",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 245,
    "checksum": "6ee6cabc351d3600d305624103e2c86a",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 100,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 100,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -120,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -120,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -120,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 100,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 100,
          "y": 1260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 500,
          "y": 1390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 500,
          "y": 1520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 280,
          "y": 1650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 280,
          "y": 1780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 500,
          "y": 1910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 500,
          "y": 2040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-resolve_url",
        "source": "page_identity_enter",
        "target": "resolve_url"
      },
      {
        "id": "e-merge_end-page_identity_capture_result",
        "source": "merge_end",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 246,
    "checksum": "64244faa5a740addc23226af792ee1fa",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 0,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 0,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -220,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -220,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -220,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 0,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 0,
          "y": 440
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 400,
          "y": 570
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 400,
          "y": 700
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 180,
          "y": 830
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 180,
          "y": 960
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 400,
          "y": 1090
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 400,
          "y": 1220
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-node-open-group",
        "source": "page_identity_enter",
        "target": "node-open-group"
      },
      {
        "id": "e-node-summary-page_identity_capture_result",
        "source": "node-summary",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  },
  {
    "id": 157,
    "checksum": "b4d35cce471b73a8046d35365b9fab3d",
    "nodes": [
      {
        "id": "page_identity_restore_only",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"
        },
        "label": "Chỉ chuyển về danh tính ban đầu?",
        "position": {
          "x": 100,
          "y": -920
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_needs_switch",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"
        },
        "label": "Cần chuyển sang Page?",
        "position": {
          "x": 100,
          "y": -790
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_original",
        "blockId": 2670,
        "blockName": "fb_get_current_identity_name",
        "config": {},
        "label": "Nhớ danh tính ban đầu",
        "position": {
          "x": -120,
          "y": -660
        }
      },
      {
        "id": "page_identity_switch",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "identityNameFromVars": "runAsPageName"
        },
        "label": "Chuyển sang Page đã chọn",
        "position": {
          "x": -120,
          "y": -530
        }
      },
      {
        "id": "page_identity_ready",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "ready"
        },
        "label": "Kiểm tra đã chuyển Page",
        "position": {
          "x": -120,
          "y": -400
        }
      },
      {
        "id": "page_identity_enter",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Chạy hành động chiến dịch",
        "position": {
          "x": 100,
          "y": -240
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_capture_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "capture_result"
        },
        "label": "Giữ kết quả hành động",
        "position": {
          "x": 100,
          "y": 1260
        }
      },
      {
        "id": "page_identity_restore_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phần hành động",
        "position": {
          "x": 500,
          "y": 1390
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_needs_restore",
        "blockId": 1,
        "blockName": "if_else",
        "config": {
          "condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"
        },
        "label": "Cần chuyển về danh tính ban đầu?",
        "position": {
          "x": 500,
          "y": 1520
        },
        "systemType": "ifElse"
      },
      {
        "id": "page_identity_restore",
        "blockId": 2671,
        "blockName": "fb_switch_identity_by_name",
        "config": {
          "useOriginalIdentity": true
        },
        "label": "Chuyển về danh tính ban đầu",
        "position": {
          "x": 280,
          "y": 1650
        }
      },
      {
        "id": "page_identity_restored",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "restored"
        },
        "label": "Kiểm tra đã chuyển về",
        "position": {
          "x": 280,
          "y": 1780
        }
      },
      {
        "id": "page_identity_result_join",
        "blockId": 4,
        "blockName": "merge",
        "config": {
          "mode": "any"
        },
        "label": "Kết thúc phiên Page",
        "position": {
          "x": 500,
          "y": 1910
        },
        "systemType": "merge"
      },
      {
        "id": "page_identity_result",
        "blockId": -1,
        "blockName": "fb_campaign_page_identity_state",
        "config": {
          "pageIdentityStateOperation": "result"
        },
        "label": "Trả kết quả hành động",
        "position": {
          "x": 500,
          "y": 2040
        }
      }
    ],
    "edges": [
      {
        "id": "e-page_identity_restore_only-page_identity_restore_join-true",
        "source": "page_identity_restore_only",
        "target": "page_identity_restore_join",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_restore_only-page_identity_needs_switch-false",
        "source": "page_identity_restore_only",
        "target": "page_identity_needs_switch",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_original-true",
        "source": "page_identity_needs_switch",
        "target": "page_identity_original",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_switch-page_identity_enter-false",
        "source": "page_identity_needs_switch",
        "target": "page_identity_enter",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_original-page_identity_switch",
        "source": "page_identity_original",
        "target": "page_identity_switch"
      },
      {
        "id": "e-page_identity_switch-page_identity_ready",
        "source": "page_identity_switch",
        "target": "page_identity_ready"
      },
      {
        "id": "e-page_identity_ready-page_identity_enter",
        "source": "page_identity_ready",
        "target": "page_identity_enter"
      },
      {
        "id": "e-page_identity_original-page_identity_restore_join",
        "source": "page_identity_original",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_enter-resolve_url",
        "source": "page_identity_enter",
        "target": "resolve_url"
      },
      {
        "id": "e-merge_end-page_identity_capture_result",
        "source": "merge_end",
        "target": "page_identity_capture_result"
      },
      {
        "id": "e-page_identity_capture_result-page_identity_restore_join",
        "source": "page_identity_capture_result",
        "target": "page_identity_restore_join"
      },
      {
        "id": "e-page_identity_restore_join-page_identity_needs_restore",
        "source": "page_identity_restore_join",
        "target": "page_identity_needs_restore"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_restore-true",
        "source": "page_identity_needs_restore",
        "target": "page_identity_restore",
        "sourceHandle": "true"
      },
      {
        "id": "e-page_identity_needs_restore-page_identity_result_join-false",
        "source": "page_identity_needs_restore",
        "target": "page_identity_result_join",
        "sourceHandle": "false"
      },
      {
        "id": "e-page_identity_restore-page_identity_restored",
        "source": "page_identity_restore",
        "target": "page_identity_restored"
      },
      {
        "id": "e-page_identity_restored-page_identity_result_join",
        "source": "page_identity_restored",
        "target": "page_identity_result_join"
      },
      {
        "id": "e-page_identity_result_join-page_identity_result",
        "source": "page_identity_result_join",
        "target": "page_identity_result"
      }
    ],
    "variables_schema": [
      {
        "name": "runAsPage",
        "type": "boolean",
        "label": "Chạy bằng Page",
        "default": false
      },
      {
        "name": "runAsPageUid",
        "type": "string",
        "label": "ID Page",
        "default": ""
      },
      {
        "name": "runAsPageName",
        "type": "string",
        "label": "Tên Page",
        "default": ""
      },
      {
        "name": "pageIdentityReady",
        "type": "boolean",
        "label": "Đã chuyển Page trong lượt",
        "default": false
      },
      {
        "name": "originalIdentityName",
        "type": "string",
        "label": "Danh tính ban đầu",
        "default": ""
      },
      {
        "name": "pageIdentityRestoreOnly",
        "type": "boolean",
        "label": "Chỉ chuyển về danh tính ban đầu",
        "default": false
      },
      {
        "name": "pageIdentityRestoreAfterTarget",
        "type": "boolean",
        "label": "Chuyển về sau target (chạy thử)",
        "default": true
      }
    ],
    "default_variables": {
      "runAsPage": false,
      "runAsPageUid": "",
      "runAsPageName": "",
      "pageIdentityReady": false,
      "originalIdentityName": "",
      "pageIdentityRestoreOnly": false,
      "pageIdentityRestoreAfterTarget": true
    }
  }
]$patch$::jsonb;
  v_actions jsonb := $actions$[{"id":"facebook_comment_seeding","test_workflow_id":245,"workflow_id":157},{"id":"facebook_comment_seeding_post","test_workflow_id":244,"workflow_id":207},{"id":"facebook_find_data_group","test_workflow_id":246,"workflow_id":206},{"id":"facebook_find_data_search","test_workflow_id":247,"workflow_id":239},{"id":"facebook_group_post","test_workflow_id":252,"workflow_id":1},{"id":"facebook_join_group","test_workflow_id":285,"workflow_id":284}]$actions$::jsonb;
  v_blocks jsonb := $blocks$[{"id":2670,"name":"fb_get_current_identity_name","checksum":"5a5e3991653e873585a9277ddf1ec197"},{"id":2671,"name":"fb_switch_identity_by_name","checksum":"1df06a85e209a8e931f3a6b4e381dd9d"},{"id":1,"name":"if_else","checksum":"680745bceb6e3233f0c14ef804591396"},{"id":4,"name":"merge","checksum":"bfac1e72f476ebf1aa1992fc9d0c62c7"}]$blocks$::jsonb;
  v_item jsonb;
  v_checksum text;
  v_state_block_id bigint;
  v_nodes jsonb;
BEGIN
  -- Lock/check every dependency before inserting or updating anything.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_actions) LOOP
    PERFORM 1 FROM public.auto_campaign_actions a WHERE a.id=v_item->>'id'
      AND a.workflow_id=(v_item->>'workflow_id')::bigint
      AND a.test_workflow_id=(v_item->>'test_workflow_id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Page action mapping changed: %', v_item->>'id'; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_blocks) LOOP
    SELECT md5(to_jsonb(b)::text) INTO v_checksum FROM public.auto_blocks b
      WHERE b.id=(v_item->>'id')::bigint AND b.name=v_item->>'name' FOR UPDATE;
    IF v_checksum IS DISTINCT FROM v_item->>'checksum' THEN
      RAISE EXCEPTION 'Page block changed since live capture: %', v_item->>'name';
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch) LOOP
    SELECT md5(to_jsonb(w)::text) INTO v_checksum FROM public.auto_workflows w
      WHERE w.id=(v_item->>'id')::bigint FOR UPDATE;
    IF v_checksum IS DISTINCT FROM v_item->>'checksum' THEN
      RAISE EXCEPTION 'Page workflow changed since live capture: %', v_item->>'id';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name='fb_campaign_page_identity_state') THEN
    RAISE EXCEPTION 'Page identity state block already exists; inspect before applying';
  END IF;
  INSERT INTO public.auto_blocks(name, description, category, kind, code, config_schema, output_schema, default_config, is_builtin)
  VALUES ('fb_campaign_page_identity_state', 'Giữ trạng thái phiên Page và kết quả hành động; không thao tác DOM', 'facebook', 'js',
    $state_code$const mode = String(input.pageIdentityStateOperation || '')
if (mode === 'ready' || mode === 'restored') {
  if (input.ok !== true) throw new Error(String(input.message || (mode === 'ready' ? 'Không chuyển được sang Page đã chọn' : 'Không chuyển về được danh tính ban đầu')))
  vars.pageIdentityReady = mode === 'ready'
  return { ok: true, identityName: input.identityName }
}
if (mode === 'capture_result') { vars.pageIdentityResult = { ...input }; delete vars.pageIdentityResult.pageIdentityStateOperation; return vars.pageIdentityResult }
if (mode === 'result') return vars.pageIdentityResult || {}
throw new Error('Cấu hình trạng thái phiên Page không hợp lệ')$state_code$,
    '[{"name":"pageIdentityStateOperation","type":"string","label":"Bước trạng thái (ready/capture_result/restored/result)"}]'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true)
  RETURNING id INTO v_state_block_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch) LOOP
    SELECT jsonb_agg(CASE WHEN n.value->>'blockName'='fb_campaign_page_identity_state'
      THEN jsonb_set(n.value, '{blockId}', to_jsonb(v_state_block_id)) ELSE n.value END ORDER BY n.ordinality)
    INTO v_nodes FROM jsonb_array_elements(v_item->'nodes') WITH ORDINALITY AS n(value, ordinality);
    UPDATE public.auto_workflows SET
      nodes=nodes || v_nodes,
      edges=edges || (v_item->'edges'),
      variables_schema=COALESCE(variables_schema,'[]'::jsonb) || (v_item->'variables_schema'),
      default_variables=COALESCE(default_variables,'{}'::jsonb) || (v_item->'default_variables'),
      updated_at=now()
    WHERE id=(v_item->>'id')::bigint;
  END LOOP;
END;
$migration$;
COMMIT;
