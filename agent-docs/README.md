# Agent Docs

Persistent working memory for coding agents operating in this repository.
These files let an agent (or a human) pick up context across sessions
without re-deriving it from scratch each time.

## Structure

```
agent-docs/
├── README.md              # This file
├── main/                  # State tied to the `main` branch
│   └── index.md           # Branch overview + pointers to context files
├── issue/                 # Per-issue working folders
│   └── templates/         # Templates copied when starting an issue
│       ├── TEMPLATE-index.md
│       ├── TEMPLATE-plan.md
│       └── TEMPLATE-progress.md
└── github/
    └── info.json          # Detected repo metadata (owner, branches)
```

`main` is both the GitHub default branch and the PR base branch for this
repo, so there is a single branch folder.

## Working with an issue

When starting work on issue `#<number>`:

1. Create `agent-docs/issue/<number>/`.
2. Copy the three templates from `issue/templates/` into it, renaming
   `TEMPLATE-index.md` → `index.md`, etc.
3. Fill in `index.md` (triage), `plan.md` (implementation plan), and
   keep `progress.md` updated as work proceeds (newest entries first).
4. Add a `research.md` if you gather findings worth persisting.

## Conventions

- **Base branch:** `main`. Branch + PR flow — never commit directly to
  `main`. All PRs are squash-merged.
- Keep entries concise and factual; prefer newest-first ordering in logs.
- `github/info.json` is the machine-readable source of truth for repo
  owner and branch names.

## Repo metadata

See [github/info.json](github/info.json).
