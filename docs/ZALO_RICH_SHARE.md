# Zalo rich-text share campaigns

`zalo_message_friend` and `zalo_message_group` keep `zaloMessageSendMode: share` when `formattedContentEnabled` is enabled. Local/Desktop and legacy App Server share the same scheduler/runtime; Chat Sync uses the system worker and Zalo Server runtime.

## Wire format

Rich HTML is rendered per batch. Spin runs only on text nodes, recipient tokens remain literal, and rich share bypasses whole-message AI rewriting. Each request contains at most 50 targets with distinct client IDs. Existing quotas, cooldowns, per-target results, self-target exclusion and failure policy stay in force. Media still sends per target before the shared text; failed media targets are excluded from forwarding.

If the entire spun message is blank and the batch has no media, select the first nonblank rendered branch at each spin group (including nested groups), then render the final text/styles again. This deterministic fallback sends `{|Hi}` as `Hi` even when the RNG keeps selecting the empty branch. Preserve the original spin when any text remains or media is present; never force every optional branch to be nonempty during normal rendering. If every branch is blank and there is no media, keep inputs pending and report the missing content without a send or success detail. The recovered text still uses one forward request for up to 50 targets.

Both `/api/message/mforward` (friends) and `/api/group/mforward` (groups) use:

```ts
const msgInfo = JSON.stringify({
  message: 'Đậm',
  rtfProps: JSON.stringify({ styles: [{ start: 0, len: 3, st: 'b' }], ver: 0 })
})
```

In code, construct `msgInfo = JSON.stringify({ message, rtfProps: JSON.stringify({ styles, ver: 0 }) })`. Plain text omits `rtfProps`. `textProperties` is not the forwarding field. Trimming text shifts/clips style ranges in UTF-16 code units. Convert `ind_$` plus `indentSize` into Zalo's `ind_10`, `ind_20`, etc. Keep `src/shared/zaloForwardMessage.ts` in akaAgent and `packages/zalo-zca-adapter/src/forwardMessage.ts` in Chat API synchronized.

Forwarded rich messages echo as `webchat` with object content `{ action: "rtf", title, params }`, sometimes `propertyExt: null`. Chat Sync classifies these as text and extracts styles from `params`; the original content stays preserved. No schema change or automatic historic-message backfill is involved.

## Rollout and verification

Deploy Chat API's updated event normalizer and all Zalo runtimes before the system worker starts emitting structured `forward_message.message`; older runtimes accept only strings. Ship the updated Desktop/App Server builds and WebApp controls together. Existing campaigns already saved as share + formatted need no data migration. Campaigns previously saved as normal remain normal until the user changes their mode.

The group wire format was confirmed with an explicitly authorized single-group live diagnostic on 2026-09-20. Friend transport and 50-target behavior are covered by isolated mocks, not a live 50-recipient send. Regression checks must never start real campaigns or send real Zalo messages.

Desktop checks:

```sh
node scripts/zalo-rich-share-smoke-test.cjs
node scripts/run-zalo-rich-share-ui-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
```

Chat API: `npm run typecheck`, `npm test`, `npm run build`. Tests cover wire payloads, 50-target friend/group batches, mixed results, runtime command dispatch, plain text compatibility and incoming RTF normalization. WebApp: normal typecheck/test/build plus the `rich share` cases in `apps/web/e2e/control.spec.ts` with Desktop and Android Chromium fixtures.
