/**
 * IPC channel names — shared giữa main process và renderer.
 *
 * Phase 7a minimum: list workflows + run workflow + progress events.
 */
export declare const IPC_CHANNELS: {
    readonly WORKFLOW_LIST: "workflow:list";
    readonly WORKFLOW_GET: "workflow:get";
    readonly WORKFLOW_SAVE: "workflow:save";
    readonly WORKFLOW_CREATE: "workflow:create";
    readonly WORKFLOW_DELETE: "workflow:delete";
    readonly RUN_ENQUEUE: "run:enqueue";
    readonly RUN_LIST: "run:list";
    readonly RUN_GET_STEPS: "run:getSteps";
    readonly CHANNEL_LIST: "channel:list";
    readonly CHANNEL_REGISTER: "channel:register";
    readonly RUN_PROGRESS: "run:progress";
    readonly BLOCK_LIST: "block:list";
    readonly SELECTOR_LIST: "selector:list";
    readonly SELECTOR_GET_BY_NAME: "selector:getByName";
    readonly SELECTOR_SAVE: "selector:save";
    readonly SELECTOR_DELETE: "selector:delete";
    readonly PICKER_START: "picker:start";
    readonly PICKER_CANCEL: "picker:cancel";
};
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
export interface WorkflowListItem {
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    is_block: boolean;
    current_version: number;
    updated_at: string | null;
}
export interface RunListItem {
    id: string;
    workflow_id: string;
    workflow_version: number;
    channel_id: string | null;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    duration_ms: number | null;
    error: string | null;
}
export interface ChannelListItem {
    id: string;
    name: string;
    channel_type: string;
    status: string;
}
export interface NamedSelectorRow {
    id: string;
    name: string;
    domain: string | null;
    description: string | null;
    selector_type: 'css' | 'xpath' | 'text-match';
    expression: string;
    fallbacks: Array<{
        type: string;
        expression: string;
    }> | null;
    last_verified_at: string | null;
    organization_id: number | null;
    created_by: number | null;
    created_at: string;
    updated_at: string | null;
}
export interface PickResult {
    selectorType: 'css' | 'xpath';
    expression: string;
    fallbacks: Array<{
        type: 'css' | 'xpath' | 'text-match';
        expression: string;
    }>;
    text: string;
    tagName: string;
    url: string;
}
export interface PickerStartArgs {
    channelId: string;
    url?: string;
}
//# sourceMappingURL=ipcChannels.d.ts.map