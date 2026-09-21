# Facebook post media: v302 test and v303 production promotion

## Current state: v303

After the user confirmed successful testing, v303 was applied on 2026-09-21 to
linked production `cgjbsmqtfhqvttudyjzq`. Migration history:
`20260921031635`, name `migration_v303_promote_facebook_post_media_upload`.

The two shared blocks now contain the exact live tested override code:

| Block | ID | Source code MD5 | Promoted code MD5 |
| --- | --- | --- | --- |
| `fb_drop_post_images` | 29 | `5158ca080780a76b21bde1e0b6f3664b` | `75bf3975ef06fc9a6f6b9613f248af16` |
| `fb_post_current_identity_ui` | 2672 | `448a190506a6470a8b36dd8febd2382e` | `c42c9828416a761a782f4cf12bdff9f7` |

`codeOverride` was removed only from workflow 250's `post_current_identity_ui`
node and workflows 251/252's `drop_images` nodes. Both real and test workflows
now use the same shared code. Existing workflow graphs, node configuration,
action/staff settings, elements, runtime helpers and other media blocks remain
unchanged. Block names/IDs and non-code metadata are preserved.

The migration was built from newly queried live block rows and live test
overrides, with a full-row checksum preflight for blocks, all six related
workflows, action mappings and `FbComposerForm`. It also requires the three live
overrides to match the promotion target exactly. No historical migration body
was used as the source, and v302 was not edited or reapplied.

Validation for v303:

- The existing Electron/CDP smoke now reads v303's promoted code and passed.
- Bad block and workflow checksums were independently rejected by live
  preflight; the actual migration passed in a transaction ending in `ROLLBACK`.
- Only v303 was applied via `supabase db query --linked`; history was inserted
  into the existing table in the same transaction. No RPC/DDL, extra connection
  source, helper DDL or schema reload was introduced.
- Postflight confirmed both shared code bodies are byte-for-byte equal to the
  freshly captured tested overrides and that all three override properties were
  removed. Every other captured field was preserved, aside from update times on
  the two blocks and three test workflows. Stored migration SQL checksum matched
  the local v303 file.
- No further Facebook post was published by the agent during promotion.

No app build or element cache refresh is needed. Reopen any already loaded
workflow/block editor to fetch the latest definitions. Historical comments in
the promoted JavaScript were retained to preserve exact code identity.

## Historical v302 rollout

Applied on 2026-09-21 to linked production `cgjbsmqtfhqvttudyjzq`.
Migration history: `20260921025630`, name
`migration_v302_facebook_post_media_test_overrides`.

### Scope at v302

Only the following `auto_workflows.nodes[].codeOverride` values changed:

| Test workflow | ID | Node | Base block |
| --- | --- | --- | --- |
| `facebook_page_post__test__facebook_page_post` | 250 | `post_current_identity_ui` | `fb_post_current_identity_ui` (2672) |
| `facebook_timeline_post__test__facebook_timeline_post` | 251 | `drop_images` | `fb_drop_post_images` (29) |
| `facebook_group_post__test__facebook_group_post` | 252 | `drop_images` | `fb_drop_post_images` (29) |

Shared blocks 29/2672, real workflows 1/2/226, the `FbComposerForm` element,
action mappings, runtime methods, node configuration and workflow graphs were
verified unchanged. No staff `use_test_workflow` setting was changed. Reels,
comments and Messenger nodes keep their existing behavior.

### Behavior

The user reproduced post images appearing in an open Messenger draft when the
post editor received synthetic drag/drop events. Manually selecting an image
through the post form's own file input attached it to the intended post. The
exact Facebook event handler responsible for the earlier routing was not traced.

The v302 overrides, now promoted into the shared blocks by v303, were derived
from the captured live block bodies. They replace the
post media `page.dropFile` call with a scoped `page.uploadFile` call. The helper:

1. Resolves the existing `FbComposerForm` XPath and requires exactly one form.
2. Requires exactly one file input inside that form, enabled and accepting
   image/video, with `multiple` enabled when uploading more than one file.
3. Temporarily marks the validated form with a unique token, calls
   `page.uploadFile` on that form, then removes its marker in `finally`.
4. Fails on ambiguity, cancellation, upload exceptions or a returned file count
   that differs from the requested count. It never falls back to drag/drop.

The visible form is intentional: the current PageController resolver filters
hidden elements, while Facebook's native file input is hidden. `uploadFile`
already resolves a file input inside a visible container. Checking that the form
has exactly one file input ensures that its internal `querySelector` selects the
validated input, without changing input visibility or shared runtime code.

Existing content handling, delays, navigation and publication confirmation are
preserved. `fileCount` still means files were injected, not that Facebook has
finished uploading/rendering attachment previews.

No new element was needed for the v302 test change, so no element cache refresh
or app build is required. Reopen a test workflow in the editor before running it
to load the latest node overrides. Campaign routing still depends on the staff's
existing test-workflow setting.

### Validation at v302

- `node scripts/facebook-post-upload-test-smoke.cjs` passed using actual
  Electron/CDP and the unchanged `PageController` in a hidden/offscreen window.
- Local fixtures covered one image, multiple images, video file transport,
  mixed image/video transport, empty input, missing/duplicate forms and inputs,
  disabled/non-media inputs, a single-file-only input, cancellation, CDP failure,
  incomplete file count and marker cleanup.
- Composer files matched the requested files. The unrelated Messenger input
  remained empty; no drag/drop event was dispatched. The native input stayed
  hidden. These fixtures do not test Facebook's uploader or video processing.
- Both complete generated override bodies passed JavaScript syntax checks.
- A deliberately wrong source checksum was rejected by the live preflight.
- The real migration passed inside a transaction ending in `ROLLBACK` before
  application. Apply used `supabase db query --linked` and inserted history into
  the existing history table in the same transaction, without auxiliary DDL or
  PostgREST schema reload.
- Post-apply comparisons confirmed exactly three node overrides plus workflow
  timestamps changed; all other captured values were identical. Migration
  history's stored SQL checksum matched the local migration file.
- No live Facebook workflow was executed or post published during verification.

Override code MD5:

| Block used by test node | MD5 |
| --- | --- |
| 29 (workflows 251/252) | `75bf3975ef06fc9a6f6b9613f248af16` |
| 2672 (workflow 250) | `c42c9828416a761a782f4cf12bdff9f7` |

Before v303, removing these three overrides would revert the test to the old
shared blocks. That rollback instruction no longer applies: a future rollback
must first capture the current shared blocks/workflows and use a new guarded
migration, preserving any subsequent changes.
