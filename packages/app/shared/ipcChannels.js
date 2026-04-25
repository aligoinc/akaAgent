/**
 * IPC channel names — shared giữa main process và renderer.
 *
 * Phase 7a minimum: list workflows + run workflow + progress events.
 */
export const IPC_CHANNELS = {
    // Workflows
    WORKFLOW_LIST: 'workflow:list',
    WORKFLOW_GET: 'workflow:get',
    WORKFLOW_SAVE: 'workflow:save', // upsert workflow + new revision
    WORKFLOW_CREATE: 'workflow:create', // blank workflow
    WORKFLOW_DELETE: 'workflow:delete',
    // Runs
    RUN_ENQUEUE: 'run:enqueue',
    RUN_LIST: 'run:list',
    RUN_GET_STEPS: 'run:getSteps',
    // Channels
    CHANNEL_LIST: 'channel:list',
    CHANNEL_REGISTER: 'channel:register',
    // Realtime broadcast (main → renderer)
    RUN_PROGRESS: 'run:progress',
    // Block registry
    BLOCK_LIST: 'block:list',
    // Named selectors
    SELECTOR_LIST: 'selector:list',
    SELECTOR_GET_BY_NAME: 'selector:getByName',
    SELECTOR_SAVE: 'selector:save',
    SELECTOR_DELETE: 'selector:delete',
    // Element picker
    PICKER_START: 'picker:start',
    PICKER_CANCEL: 'picker:cancel'
};
//# sourceMappingURL=ipcChannels.js.map