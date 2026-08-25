# Windows installer upgrade test matrix

This matrix is the release gate for the assisted per-machine NSIS installer.
Run destructive scenarios only in a disposable Windows 10/11 x64 VM snapshot.

## Invariants checked in every scenario

- `appId` remains `com.akabiz.auto`; package `name` remains `aka-biz-auto`; `productName` is `akaAgent`.
- The selected install directory contains `akaAgent.exe`, `resources/app.asar`,
  and the required unpacked dependency manifests.
- `HKLM` `InstallLocation` equals the actual selected directory after a fixed
  installer succeeds.
- `PendingFileRenameOperations` contains no `aka-biz-auto`, `akaBizAuto`, or
  `app.asar` entry created by the fixed installer.
- Electron `userData` is not removed or relocated.
- The local SQLite sentinel, remembered app login, Facebook/Zalo Web Chromium
  partitions, and stored Zalo QR session still work after a successful update.
- Cancelling before file replacement leaves the previously installed app
  launchable with all required files present.

Before packaging, run:

```bash
npm run test:windows-installer-contract
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build:win
```

## A. Fresh fixed installation

| ID | Scenario | Expected result |
|---|---|---|
| A1 | Accept UAC and default directory | Installs to `C:\Program Files\akaAgent`; app launches. |
| A2 | Select a custom directory on `D:` with spaces | Installs and launches from the exact selected directory; registry matches it. |
| A3 | Select a path containing Vietnamese characters | Installer and app launch without path truncation or mojibake. |
| A4 | Cancel UAC | No application files, uninstall entry, or shortcut are created. |
| A5 | Cancel on the directory page | No application files, uninstall entry, or shortcut are created. |
| A6 | Network download is interrupted | `.download` is removed; no partial file is executed. |
| A7 | Downloaded response is not a PE/MZ installer | Update is rejected while the running app remains usable. |

## B. Legacy pre-fix to first fixed version

Prepare a legacy installation under
`%LOCALAPPDATA%\Programs\aka-biz-auto`, including a logged-in browser account,
a remembered app login, a Zalo session, and a known row in
`userData\local-data\aka_agent_local.db`.

| ID | Scenario | Expected result |
|---|---|---|
| B1 | Update while not logged into akaBizAuto | New assisted installer defaults to `C:\Program Files\akaAgent`; successful install preserves all data. |
| B2 | Update while logged in, no active runtime | Setup downloaded by the legacy client as `akaAgent.exe` skips the self-matching akaAgent guard, closes only `akaBizAuto.exe`, and completes migration without startup ENOENT. |
| B3 | Update while campaign/Zalo/automation cleanup is active | Installer requests a normal close and waits for cleanup before replacing files. |
| B4 | Cancel the legacy updater's `app is running` prompt | Legacy installation remains launchable; all required package manifests remain. |
| B5 | Choose default `Program Files` | Old per-user program files are removed by the standard old uninstaller; new HKLM path is correct. |
| B6 | Choose custom `D:` directory | App launches from `D:` and future updates use that exact path. |
| B7 | Legacy machine already has pending deletes for the old LocalAppData path | Reboot processing cannot delete the new default/custom path; after reboot the new app still launches. |
| B8 | UAC is cancelled | Legacy installation remains usable and can retry later. |

## C. Fixed version to a later fixed version

| ID | Scenario | Expected result |
|---|---|---|
| C1 | Update default `Program Files` install while logged out | Hidden PowerShell starts Setup with `--updated` and the exact main-process PID; the exact HKLM path is reused. |
| C2 | Update default install while logged in | Electron begins graceful quit as soon as Setup opens; NSIS waits only for the validated source PID and never terminates `akaAgent.exe` by image name. |
| C3 | Update custom `D:` install | Directory page is skipped for in-app update and the exact existing path is reused. |
| C4 | Update with campaign/Zalo/automation active | Setup waits for the normal asynchronous cleanup before replacing application files. |
| C5 | Cancel UAC after the app has exited | Existing installed files remain intact; reopening the app works and update can be retried. |
| C6 | Run the new Setup manually while app is open, then Cancel its running-app prompt | Existing version remains intact because no destructive `customInit` runs. |
| C7 | Run Setup manually and change the install directory | Old program files are uninstalled normally, new path is registered, userData remains unchanged. |
| C8 | Reinstall the same version | Install is repaired without deleting userData or creating pending-delete entries. |

## D. Failure, restart, and multi-user coverage

| ID | Scenario | Expected result |
|---|---|---|
| D1 | Attempt to cancel while the install section is replacing files | Installer asks the user to wait and completes the short commit section instead of leaving a partial install. |
| D2 | Kill Setup or power off during extraction | User data remains intact; rerunning the same installer repairs the program files. |
| D3 | Insufficient disk space or read-only custom directory | Installation fails visibly and never launches a package missing required manifests. |
| D4 | Reboot immediately after successful update | New app launches; no akaBizAuto/akaAgent pending-delete entry exists. |
| D5 | Install as administrator, run as the original standard Windows user | Program files are shared; that user's existing Electron userData/session is retained. |
| D6 | A different Windows user launches the per-machine app | Program files work; Electron creates/uses that user's separate userData as expected. |
| D7 | Path contains an apostrophe and spaces | Direct PowerShell quoting and NSIS path persistence remain correct. |
| D8 | User cancels UAC or direct PowerShell launch fails | Update reports an error and keeps the currently running application open. |

## Evidence to capture

For each release candidate, retain:

- old/new version and installer SHA-256;
- selected path and registry `InstallLocation` before/after;
- `Test-Path` results for required package files;
- filtered `PendingFileRenameOperations` before reboot and after update;
- whether UAC and Setup opened before the desktop began graceful quit;
- `%TEMP%\akaAgent-installer.log` with the source-PID wait or legacy `taskkill.exe` result;
- screenshots/results for login, Facebook/Zalo session, and SQLite sentinel;
- Setup exit result and whether repair was required.
