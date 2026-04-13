# Security

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm run security:scan` | Scan current repo for threats (post-clone) |
| `npm run security:audit-repo -- owner/repo` | Risk-score a GitHub repo before cloning |
| `npm run security:audit-deps` | Deep-audit npm dependencies |
| `npm run security:audit-mcp` | Scan MCP server configs for exposed secrets |
| `npm run security:install-hooks` | Install git hooks (run once after clone) |

## What's Protected Automatically

These run silently with zero input. You only see output if something is wrong.

- **`.npmrc`** blocks all install lifecycle scripts (`preinstall`/`postinstall`/`install`). This prevents the #1 attack vector for malicious npm packages. To allow scripts for a trusted package: `npm rebuild <package-name>`.
- **Pre-commit hook** blocks commits containing AWS keys, GitHub tokens, Slack tokens, or private keys.
- **Post-merge hook** prints a one-line warning if dependencies changed after `git pull`.
- **CI workflow** runs `npm audit` and TruffleHog secret scanning on every push/PR and weekly.

## Safe Repo Installation

Before installing any unfamiliar GitHub repo:

1. **Run the audit script**: `bash scripts/security/audit-repo.sh <github-url>`
2. **Check the author** -- account age, other repos, follower count
3. **Check the ratios** -- high stars with zero issues/PRs is a red flag
4. **Clone and scan**: `git clone <url> && bash scripts/security/scan-repo.sh <dir>`
5. **Read `package.json`** -- look for `preinstall`/`postinstall` scripts
6. **Install with scripts blocked**: `npm install` (`.npmrc` handles this)
7. **Audit dependencies**: `bash scripts/security/audit-deps.sh`
8. **Allow specific scripts if needed**: `npm rebuild <package-name>`

## MCP Server Evaluation

Before installing an MCP server, verify:

- [ ] Is the source code available and auditable?
- [ ] Who maintains it? (Verified org vs. unknown individual)
- [ ] What permissions does it request? (File system, network, command execution)
- [ ] Are secrets stored in environment variables, not inline in config?
- [ ] Has it been reviewed by the community? (Real issues, PRs, discussions)
- [ ] Can you restrict its scope to specific directories/operations?

Run `npm run security:audit-mcp` to scan your existing MCP configurations.

## Incident Response

If you suspect a malicious package ran code on your machine:

1. **Disconnect from the internet immediately**
2. **Check for new processes**: `ps aux` -- look for unfamiliar entries
3. **Check for new cron jobs**: `crontab -l` and check `/etc/cron.d/`
4. **Check SSH keys**: `ls -la ~/.ssh/` -- look for keys you didn't create
5. **Check shell profiles**: review `.bashrc`, `.zshrc`, `.profile` for injected lines
6. **Check browser**: look for new extensions, review saved passwords
7. **Rotate ALL credentials** from a different, clean device:
   - GitHub tokens
   - npm tokens
   - Cloud provider keys (AWS, GCP, Azure)
   - API keys (Gemini, GHL, Slack, etc.)
   - Email passwords
   - Crypto wallet keys (move funds immediately)
8. **If confirmed compromise**: wipe and reinstall the OS

## Maintenance

- **Weekly**: `npm audit` runs automatically via CI
- **Monthly**: Run `npm run security:audit-mcp` to review MCP server permissions
- **On new repo**: Run `audit-repo.sh` before cloning, `scan-repo.sh` after
- **On new MCP server**: Review against the checklist above before installing
