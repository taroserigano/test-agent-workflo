# Todo API — AI-Powered GitHub Actions Demo

A simple Node.js/Express REST API demonstrating a fully automated, self-healing CI/CD pipeline powered by GitHub Actions and multi-agent AI review using GPT-4 mini.

---

## Architecture Overview

```
Developer pushes code
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    GitHub Repository                     │
│                                                         │
│  Push to main/develop ──────────► CI Pipeline           │
│                                   (lint + test)         │
│                                                         │
│  Open / Update PR ──────────────► 5 Parallel Workflows  │
│                                   ├── PR Agent          │
│                                   ├── AI Review Loop    │
│                                   ├── Branch Protect    │
│                                   ├── Deploy Preview    │
│                                   └── Auto-Merge Check  │
│                                                         │
│  Push tag v* ───────────────────► Release Workflow      │
│                                                         │
│  Every Monday ──────────────────► Dependency Audit      │
│  Every day ─────────────────────► Stale Cleanup         │
└─────────────────────────────────────────────────────────┘
```

---

## AI Multi-Agent Review Pipeline

The centerpiece of this repo — a self-healing agentic loop that reviews, fixes, and re-reviews code automatically before asking for human approval.

### Agent Roles

```
PR opened / updated
        │
        ▼
┌───────────────────────────────────────────┐
│         Parallel Review Phase             │
│                                           │
│  🔍 Reviewer Agent                        │
│     - Logic bugs, edge cases              │
│     - Performance issues                  │
│     - Missing error handling              │
│                                           │
│  ✏️  Editor Agent                          │
│     - Code readability                    │
│     - Better naming / structure           │
│     - Idiomatic improvements              │
│                                           │
│  🔒 Security Agent                        │
│     - OWASP Top 10 vulnerabilities        │
│     - Hardcoded secrets / credentials     │
│     - Injection risks                     │
│     - Information leakage                 │
└───────────────────────────────────────────┘
        │ all 3 outputs
        ▼
┌───────────────────────────────────────────┐
│         🧠 Critique Agent                  │
│                                           │
│  - Removes duplicate findings             │
│  - Filters false positives                │
│  - Ranks by severity                      │
│  - Assigns verdict + confidence score     │
│                                           │
│  Verdicts:                                │
│    PASS  → safe to merge                  │
│    WARN  → non-blocking suggestions       │
│    FAIL  → critical issues found          │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│         Self-Healing Fix Loop             │
│                                           │
│  PASS (confidence ≥ 90%) ──────────────► Human Approval Gate
│                                                  │
│  WARN / FAIL                                     ▼
│     │                                     🧑 You approve/reject
│     ▼                                     in the GitHub Actions UI
│  🔧 Fix Agent (max 3 iterations)                 │
│     - Reads medium + critical findings           ▼
│     - Sends code + findings to GPT-4 mini   ✅ Auto-merge (squash)
│     - Applies fixes to source files
│     - Commits as fix-agent[bot]
│     - Pushes with PAT → triggers workflow again
│          │
│          └──► Loop back to Reviewer / Editor / Security / Critique
│
│  After 3 failed iterations:
│     → Posts "needs human help", stops
└───────────────────────────────────────────┘
```

### Review Modes

Controlled by `REVIEW_MODE` env var in `ai-review.yml`:

| Mode | Behaviour |
|------|-----------|
| `observer` | Agents comment only, never merge |
| `suggest` | Agents comment + recommend merge |
| `auto` | Agents review → fix loop → human gate → auto-merge |

### Auto-Merge Eligibility

A PR is eligible for auto-merge (after human approval) only when ALL of these are true:
- Critique Agent verdict is `PASS`
- Confidence score ≥ 90%
- Lines changed ≤ 200
- Security Agent found no issues

---

## All Workflows

### 1. CI (`ci.yml`)
**Trigger:** Push or PR to `main` / `develop`

```
Install deps → ESLint → Jest (Node 18 + 20 matrix) → Upload coverage
```

### 2. PR Agent (`pr-agent.yml`)
**Trigger:** PR opened / updated

- Reads all changed files
- Auto-applies labels: `feature`, `testing`, `ci/cd`, `dependencies`, `documentation`
- Creates missing labels automatically
- Posts structured summary comment with file list, line stats, review checklist

### 3. AI Review (`ai-review.yml`)
**Trigger:** PR opened / updated

See the full pipeline above. Files involved:
- `.github/workflows/ai-review.yml` — orchestration
- `.github/scripts/ai-review.js` — 4-agent review pipeline
- `.github/scripts/fix-agent.js` — self-healing fix loop

### 4. Branch Protection (`branch-protect.yml`)
**Trigger:** PR to `main`

- Validates all commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  - Format: `type(scope): description`
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Rejects PRs with empty description body

### 5. Deploy Preview (`deploy-preview.yml`)
**Trigger:** PR opened / updated

- Installs deps, starts Express server
- Hits `GET /health`, `POST /todos`, `GET /todos`
- Posts pass/fail result as PR comment

### 6. Release (`release.yml`)
**Trigger:** Git tag pushed matching `v*`

```
Run tests → Build archive → Create GitHub Release → Upload artifact
```
Auto-generates changelog from commit messages.

### 7. Dependency Check (`dependency-check.yml`)
**Trigger:** Every Monday 9 AM UTC (or manual)

- Runs `npm audit`
- Automatically opens a GitHub Issue with vulnerability table if found
- Automatically closes the issue when all vulnerabilities are resolved

### 8. Stale Cleanup (`stale.yml`)
**Trigger:** Daily midnight UTC

- Labels issues/PRs with no activity for **14 days** as `stale`
- Auto-closes after **7 more days** of inactivity
- Posts warning comment before closing
- Exempt labels: `pinned`, `security`, `no-stale`

### 9. Auto-Merge Dependabot (`auto-merge.yml`)
**Trigger:** Dependabot PR opened / updated

- Auto-approves **patch** and **minor** version updates
- Merges after CI passes
- Major version updates still require human review

---

## Repository Structure

```
.
├── src/
│   ├── app.js              Express app setup, middleware, error handlers
│   └── routes/
│       └── todos.js        CRUD + search endpoints
├── tests/
│   └── todos.test.js       Jest integration tests (supertest)
├── .github/
│   ├── dependabot.yml      Weekly npm + actions updates
│   ├── scripts/
│   │   ├── ai-review.js    Multi-agent review pipeline (GPT-4 mini)
│   │   └── fix-agent.js    Self-healing fix agent
│   └── workflows/
│       ├── ai-review.yml   AI review + fix loop + human gate + auto-merge
│       ├── auto-merge.yml  Dependabot auto-merge
│       ├── branch-protect.yml  Conventional commits + PR body check
│       ├── ci.yml          Lint + test
│       ├── dependency-check.yml  Weekly npm audit
│       ├── deploy-preview.yml   Smoke test on PR
│       ├── pr-agent.yml    Auto-label + summarize
│       ├── release.yml     Auto-release on tag
│       └── stale.yml       Auto-close stale issues/PRs
├── .eslintrc.json
├── package.json
└── .gitignore
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/todos` | List all todos |
| `GET` | `/todos?q=keyword` | Search todos by title |
| `GET` | `/todos/:id` | Get single todo |
| `POST` | `/todos` | Create todo `{ title }` |
| `PATCH` | `/todos/:id` | Update todo `{ title?, done? }` |
| `DELETE` | `/todos/:id` | Delete todo |

---

## Setup

### Prerequisites
- Node.js 18+
- GitHub account
- OpenAI API key (for AI review agents)

### Local development
```bash
npm install
npm run dev       # start with file watching
npm test          # run tests
npm run lint      # run ESLint
```

### GitHub Secrets required

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Powers all 4 AI review agents |
| `FIX_AGENT_PAT` | PAT with `repo` scope — allows Fix Agent commits to re-trigger workflows |

### GitHub Environment required

Create a `production` environment in **Repo → Settings → Environments** with yourself as a required reviewer. This is the human approval gate before auto-merge.

---

## How the Human Approval Gate works

When the AI Review pipeline reaches a `PASS` verdict with sufficient confidence:

1. The `human-gate` job pauses and waits
2. GitHub sends you an **email notification**
3. Go to the **Actions tab** → find the paused run → click **Review deployments**
4. Read the AI analysis comment on the PR
5. Click **Approve** → merge happens automatically
6. Click **Reject** → nothing happens, PR stays open

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Node.js, Express |
| Tests | Jest, Supertest |
| Lint | ESLint |
| CI/CD | GitHub Actions |
| AI Agents | OpenAI GPT-4 mini (`gpt-4o-mini`) |
| GitHub API | `actions/github-script`, native REST |
| Dependency updates | Dependabot |
