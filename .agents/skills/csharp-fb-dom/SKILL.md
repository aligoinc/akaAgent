---
name: csharp-fb-dom
description: Use when the user provides or references known-good C# Selenium Facebook automation and wants Codex to compare, create, or fix an Electron/JavaScript workflow by trusting the C# code as the source of truth for DOM interactions. Trigger on phrases like "C# DOM mode", "trust C#", "bám C#", "làm giống C#", or "đối chiếu DOM theo C#".
---

# C# Facebook DOM

## Core Rule

Treat the provided C# Facebook automation as the source of truth for DOM interaction only.

Preserve these C# behaviors unless the user explicitly asks for a difference:
- XPath selectors.
- Parent/root scope used for `FindElement` and `FindElements`.
- Order of DOM operations.
- Click targets and click sequence.
- Scroll target and scroll method.
- Sleep, delay, poll interval, and poll timeout tied to DOM loading.
- Whether a missing element is fatal or best-effort based on the C# `try/catch`.

Do not add DOM heuristics unless the user approves:
- Extra fallback selectors.
- English selectors when C# only uses Vietnamese, or vice versa.
- `contains(@class, ...)` when C# uses exact `@class='...'`.
- Visible filters when C# uses raw `FindElements`.
- Scroll container fallbacks when C# uses `scrollIntoView` or `window.scrollBy`.
- Clicking "see more" buttons that are commented out in C#.

Logic outside DOM may differ if it fits the workflow engine and the user accepts it:
- DB save/upsert/dedupe.
- Logging/progress/cancel.
- Workflow variables/default variables.
- Stop policy such as `maxNoChangeCycles`.
- Data fan-out, export, or UI state.

## Required Workflow

Before implementing, produce a comparison table:

```text
C# step | Workflow step hiện tại/dự kiến | Khác DOM không | Lý do
```

Keep the table focused on DOM interaction. Do not list differences that are purely DB, logging, dedupe, UI, fan-out, or stop-policy unless the user asks.

If the workflow already exists:
- Query or read the workflow/block/element source of truth first.
- Compare exact selectors and block code against the C#.
- Plan only DOM changes.
- Preserve existing non-DOM behavior unless the user requests otherwise.

If creating a new workflow:
- Map C# DOM steps directly into workflow blocks.
- Use workflow variables only for values the C# receives as parameters or values the user needs to tune.
- Ask before changing any DOM behavior that cannot be represented exactly in Electron.

## Implementation Rules

When editing DB-backed workflows, prefer an idempotent SQL migration that updates `auto_elements`, `auto_blocks`, and `auto_workflows` by stable names.

After applying a migration, verify with DB queries that:
- XPath values match the C#.
- Raw `FindElements` equivalents do not contain unwanted `.filter(isVisible)`.
- Scroll calls match the C# method.
- Removed/commented C# actions are not present in workflow code.
- Any accepted non-DOM difference remains intentional.

Run the repo's normal verification when code files changed. For akaAgent, use:

```bash
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
```

## Short User Triggers

Treat these user phrases as a request to use this skill:
- `dùng skill csharp-fb-dom`
- `C# DOM mode`
- `trust C#`
- `bám C#`
- `làm giống C#`
- `đối chiếu DOM theo C#`
