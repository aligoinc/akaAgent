// Operational security policy, incident records and private captures stay outside Git.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const privateSecurityRoot = path.resolve(process.env.AKA_AGENT_PRIVATE_SECURITY_DIR ||
  path.join(os.homedir(), '.codex/incident-recovery/akaAgent-ip-block'))

function privateSecurityAsset(relative) {
  const target = path.resolve(privateSecurityRoot, relative)
  if (!target.startsWith(privateSecurityRoot + path.sep)) throw new Error('Private asset must stay inside its configured directory')
  if (!fs.existsSync(target)) throw new Error(`Missing private security asset: ${target}. Set AKA_AGENT_PRIVATE_SECURITY_DIR to the external archive; do not recreate production IP rules from repository history.`)
  return target
}

module.exports = { privateSecurityRoot, privateSecurityAsset }
