#!/usr/bin/env node

const path = require('path')
const { signAsync } = require('@electron/osx-sign')

async function main() {
  const appPath = process.argv[2]
  if (!appPath) {
    throw new Error('Usage: node scripts/sign-mac-adhoc.cjs <path-to-app>')
  }

  const entitlements = path.resolve('build/entitlements.mac.plist')

  await signAsync({
    app: appPath,
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: false,
    optionsForFile: () => ({
      entitlements,
      hardenedRuntime: false
    })
  })

  console.log(`Ad-hoc signed: ${appPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
