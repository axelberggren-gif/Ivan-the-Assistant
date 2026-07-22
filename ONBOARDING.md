# Working with this repo (a plain-language guide)

This project is set up to be **AI-first with guardrails**: AI agents write the code,
automated checks catch mistakes, and **you press the final Merge button**. You don't need
to be technical to run it. This page explains the few things you'll actually do.

## The big picture

- Nothing reaches the live code (`main`) without going through a **pull request (PR)**.
- Every PR runs **three automatic checks**. All three must be green before you merge.
- One of those checks is an **AI reviewer** that reads the change against this project's
  rules (in `AGENTS.md`) and **blocks** anything risky.
- When the checks are green, **you click "Merge"** (Squash and merge). That's the only
  manual step.

## The three checks

| Check | What it proves | If it's red (failed) |
|-------|----------------|----------------------|
| **ci** | The code type-checks, the tests pass, and the app builds | Tell the AI "CI is failing, please fix it" |
| **claude-review** | The AI reviewer found no bugs and no broken project rules | Open the PR's review comments to see what it flagged, then tell the AI to address them |
| **pr-title-lint** | The PR title is in the required format (e.g. `feat: add london system`) | Edit the PR title (pencil icon) to start with `feat:`, `fix:`, `docs:`, `chore:`, … |

## Your normal flow

1. Ask the AI (in Claude Code) to do something. It creates a branch and opens a PR.
2. Wait a minute or two for the checks to run (spinners, then ✓ or ✗ on the PR page).
3. **All green?** Click the green **Merge** button (choose "Squash and merge"). Done.
4. **Something red?** See the table above.

## One-time setup you need to do (the parts the AI can't do for you)

1. **Make the repo public** (Settings → General → Danger Zone → Change visibility).
   On a free GitHub account, the rules below are only *enforced* on public repos. This
   app has no secrets or personal data — same call you made for `health-data-hub`
   (see `docs/decisions/0002-ai-first-guardrails.md`). If you prefer to stay private,
   everything still runs, but the checks are advisory rather than enforced.
2. **Protect `main`** (Settings → Branches → Add branch ruleset or classic protection
   rule for `main`): require a pull request before merging (0 approvals needed), and
   require these status checks to pass: **`build`**, **`review`**, **`lint`**.
   Also tick "Do not allow bypassing" if offered, and allow only squash merging
   (Settings → General → Pull Requests → untick merge commits and rebase).
3. **Give the AI reviewer its key.** Create a pay-per-use API key at
   <https://console.anthropic.com> (API keys → Create key; add a small monthly cap), then:
   `gh secret set ANTHROPIC_API_KEY --repo axelberggren-gif/Ivan-the-Assistant`
   (or Settings → Secrets and variables → Actions → New repository secret).
4. **Install the Claude GitHub App** on this repo: <https://github.com/apps/claude> →
   Install → pick this repo. This lets the reviewer post its review.

## Emergency: merging anyway (rare)

If a check is wrong or stuck and you genuinely need to merge: as repo admin you'll see an
override option on the PR page. Use it only when you understand why the check is wrong,
and afterwards ask the AI to add a short note in `docs/decisions/` explaining why.

## Where the rules live

- `AGENTS.md` — the rules the AI follows and the reviewer enforces.
- `CONTEXT.md` — the project's vocabulary (what a Trap, Blunder, Fix move, … mean).
- `docs/decisions/` — why things are the way they are.
- `CHANGELOG.md` — what changed, newest first.
