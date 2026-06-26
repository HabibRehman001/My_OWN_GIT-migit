# migit

A minimal Git-like version control CLI with project documentation generation.

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new repository (creates `.migitignore` if missing) |
| `add` | Stage files for commit |
| `status` | Show working tree status |
| `commit` | Record changes (`-m`, `--smart`, or `--smart --paths-only`) |
| `log` | Show commit history |
| `checkout` | Switch branches (`-f` / `--force` to discard local changes) |
| `branch` | List, create, or delete branches |
| `history` | Show command history (`history explain`, or `--explain` alias) |
| `document` | Generate project documentation |
| `doctor` | Diagnose repository health |
| `config` | Get or set author and AI settings |

## Repository config

On `migit init`, `.migit/config.json` stores author info and AI provider — **not** API keys.

```bash
migit config user.name "Habib Ur Rehman"
migit config user.email "habib@example.com"
migit config ai.model "gemini-2.5-flash"   # optional; defaults from MIGIT_AI_MODEL env
migit config --list
```

Example `.migit/config.json`:

```json
{
  "user": {
    "name": "Habib Ur Rehman",
    "email": "habib@example.com"
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

Create `.migitignore` at the repository root (a default file is created on `migit init`):

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

These paths are **always** ignored, even if omitted from `.migitignore`:

- `.migit/`
- `.git/`
- `node_modules/`
- `.env` and `.env.*`

Additional behavior:

- Paths with `..` or outside the repository root are rejected
- Symbolic links are not followed
- Files larger than 10 MB are skipped with a warning
- Permission-denied paths are skipped with a warning
- Binary files are stored as blobs when staged

## Development

```bash
npm install
npm run build
npm link          # install `migit` globally on your PATH
migit --help
```

During development without linking:

```bash
npm start -- init
npm start -- status
```
