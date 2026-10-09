// Current composer regression suite. The superseded v374 suite is archived in
// migrations/snapshots/fb-composer-policy-v375/v374-composer-smoke.cjs.
require('./fb-composer-policy-v375-smoke.cjs').main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
