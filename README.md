# migit

A minimal Git-like version control CLI for TypeScript/Node projects, with merge support, team policies, and optional AI-assisted commits and documentation.

## Quick start

```bash
npm install
npm link          # optional — install `migit` globally

migit init
echo "hello" > README.txt
migit add .
migit commit -m "Initial commit"

migit branch feature/my-task
migit checkout feature/my-task
# … edit files …
migit add .
migit commit -m "Add my task"

migit checkout main
migit merge feature/my-task --preview   # see conflict risk before merging
migit merge feature/my-task
```

## Commands

| Command | Description |
|---------|-------------|
| `init [-f\|--force]` | Initialize `.migit/` (config, policy, ownership, ignore file) |
| `add <paths…>` | Stage files for commit |
| `status` | Three-way status (HEAD ↔ index ↔ working tree) |
| `commit -m "msg"` | Record staged changes |
| `commit --smart [-y]` | AI-generated commit message (Gemini) |
| `commit --override-policy` | Maintainer bypass for protected-branch commits |
| `log [-n count]` | First-parent commit history |
| `checkout <branch> [-f]` | Switch branch (dirty-tree protection by default) |
| `branch` | List branches (`*` = current) |
| `branch <name>` | Create branch at current HEAD |
| `branch -d <name>` | Delete a branch |
| `branch --standards` | Show branch naming conventions |
| `branch --no-verify` | Skip naming standards on create (policy still applies) |
| `branch risk <branch>` | Conflict risk report (hash-only, no blob reads) |
| `merge <branch>` | Merge into current branch (fast-forward or conflict pause) |
| `merge <branch> --preview` | Conflict risk + merge analysis (read-only) |
| `merge --continue` | Finish merge after resolving conflicts |
| `merge --abort` | Cancel merge and restore pre-merge tree |
| `merge -f` | Discard local changes and merge anyway |
| `conflicts` | List unresolved/resolved conflicts during merge |
| `resolve <paths…>` | Mark conflict paths resolved (after editing files) |
| `config` | Get/set author and AI settings |
| `history [--explain]` | Command audit log |
| `document [-o path]` | Generate project documentation |
| `doctor` | Deep repository health checks |

## Branch naming

Trunk branch is **`main`**. Task branches use allowed prefixes:

| Prefix | Example |
|--------|---------|
| `feature/` | `feature/user-login`, `feature/DS-142-login-validation` |
| `bugfix/` | `bugfix/token-expiry` |
| `hotfix/` | `hotfix/database-connection` |
| `docs/` | `docs/api-documentation` |
| `team/` | `team/backend/order-service` (requires three segments) |

Nested names are supported (`feature/login` is stored at `.migit/refs/heads/feature/login`).

```bash
migit branch --standards    # print full conventions
migit branch feature/login  # validated on create
```

Optional overrides in `.migit/config.json`:

```json
{
  "branches": {
    "enabled": true,
    "defaultBranch": "main",
    "allowedPrefixes": ["feature", "bugfix", "hotfix", "docs", "team"],
    "minDescriptionLength": 3
  }
}
```

## Merge workflow

MiGit supports fast-forward merges and three-way merges with conflict markers. When conflicts occur, the merge **pauses** — no commit is created until you resolve and continue.

```bash
# 1. Preview before merging
migit branch risk feature/login
# or
migit merge feature/login --preview

# 2. Merge
migit merge feature/login

# 3. If conflicts — edit files, then:
migit conflicts
migit resolve src/auth/token.ts
migit merge --continue

# Or cancel:
migit merge --abort
```

Conflict markers use a diff3-style format:

```
<<<<<<< current:main
…your version…
||||||| base
…merge base…
=======
…incoming version…
>>>>>>> incoming:feature/login
```

During an in-progress merge, checkout, commit, branch delete, and second merges are blocked until `--continue` or `--abort`.

## Policies and team rules

On `migit init`, three governance files are created under `.migit/`:

### `.migit/policy.json`

Declarative branch and merge policies. **No shell commands or hooks** — rejected on load for security.

```json
{
  "version": 1,
  "defaultBranch": "main",
  "protectedBranches": ["main"],
  "allowedBranchPatterns": [
    "feature/*",
    "bugfix/*",
    "hotfix/*",
    "docs/*",
    "team/*"
  ],
  "requireCleanWorkingTreeForMerge": true,
  "preventDirectCommitToProtectedBranches": true,
  "warnChangedFilesAbove": 100,
  "warnSharedPaths": true
}
```

**Protected `main`:** Direct commits to protected branches are blocked after the first commit. The error suggests a working branch:

```
Direct commits to protected branch "main" are not allowed.

Create a working branch:

  migit branch feature/change-app
  migit checkout feature/change-app
```

Emergency override (recorded in `history.log`):

```bash
migit commit -m "Emergency fix" --override-policy
```

### `.migit/ownership.json`

Path → team rules for coordination **warnings only** (commits are never blocked):

```json
{
  "rules": [
    { "pattern": "src/api/**", "team": "backend" },
    { "pattern": "src/components/**", "team": "frontend" },
    { "pattern": "src/models/**", "team": "database" },
    { "pattern": "infra/**", "team": "devops" }
  ]
}
```

On `team/frontend/…` branches, changing a backend-owned path prints a warning with the suggested owner team.

### Conflict risk report

Before merging, compare paths changed on each branch since the merge base:

```bash
migit branch risk feature/login
```

Example output:

```
Conflict risk report

Low risk:
  42 files changed on only one branch

Possible overlap:
  src/auth/token.ts
  src/routes/user.ts

High-risk generated files:
  package-lock.json

This does not promise that a conflict will happen. It warns about overlapping paths.
```

Analysis is **hash-only** — tree maps are compared without reading blob contents.

## Repository layout

```
your-project/
├── .migitignore
├── .migit/
│   ├── HEAD                 # ref: refs/heads/<branch>
│   ├── config.json          # author + AI provider (no API keys)
│   ├── policy.json          # branch/merge policies
│   ├── ownership.json       # team path ownership
│   ├── index                # staged files (JSON)
│   ├── history.log          # command audit (JSONL)
│   ├── merge-state.json     # present during conflict merge
│   ├── MERGE_MSG            # default merge commit message draft
│   ├── locks/               # repository lock during merge
│   ├── objects/             # content-addressed blobs, trees, commits (gzip)
│   └── refs/heads/          # branch tips (supports nested names)
│       ├── main
│       └── feature/
│           └── login
└── … source files
```

Objects use SHA-256 content addressing. Commits store a `parents[]` array (empty for root, one for normal commits, two for merges).

## Repository config

`.migit/config.json` stores author info and AI provider — **never API keys**.

```bash
migit config user.name "Your Name"
migit config user.email "you@example.com"
migit config ai.model "gemini-2.5-flash"   # optional
migit config --list
```

```json
{
  "user": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "ai": {
    "provider": "gemini"
  }
}
```

## Setup (optional AI)

API keys belong in the environment only:

```bash
cp .env.example .env
# Add GEMINI_API_KEY to .env (never commit .env)
export GEMINI_API_KEY=your_key_here
```

`.env`, `.env.*`, and credential files are excluded from scans, documentation, and smart-commit analysis.

## Ignore rules

A default `.migitignore` is created on `migit init`:

```
node_modules/
dist/
build/
coverage/
.env
.env.*
*.log
uploads/
```

Always ignored (even if omitted from `.migitignore`): `.migit/`, `.git/`, `node_modules/`, `.env`, `.env.*`.

Additional behavior:

- Paths with `..` or outside the repository root are rejected
- Symbolic links are not followed
- Files larger than 10 MB are skipped with a warning
- Permission-denied paths are skipped with a warning

## Development

```bash
npm install
npm run build
npm test            # 151 automated tests (Node test runner + tsx)
npm link            # install `migit` globally on your PATH
migit --help
```

Without linking:

```bash
npm start -- init
npm start -- status
npm start -- merge feature/sample --preview
```

### Test coverage

| Area | What is verified |
|------|------------------|
| Object storage | Blob/tree/commit headers, hash/path mismatches |
| Commits | Multi-parent commits, legacy `parent` migration, generation |
| Status | Three-way staged/working/untracked/deleted states |
| Checkout | Dirty-tree blocking, file restoration |
| Branches | Nested refs, naming standards, policy patterns |
| Merge | Fast-forward, conflicts, resolve, continue, abort, preview |
| Conflict risk | Hash-only overlap analysis, high-risk file detection |
| Policies | Protected branches, `--override-policy`, history audit |
| Ownership | Team path warnings (non-blocking) |
| Doctor | Refs, objects, index, commit graph, policy/ownership files |
| Secrets | History args and errors redact API keys |

## Limitations

- Not full Git — no rebase, stash, remotes, tags, or submodules
- Clean three-way merges (zero conflicts) still pause — automatic merge commit for that case is not supported yet
- `migit log` follows first-parent history only (no `--graph` yet)
- Offline bundle export/import is planned but not implemented
- Flat tree storage (hierarchical trees deferred for performance)

## License

See project root for license details.
