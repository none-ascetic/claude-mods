# claude-mods

Small add-ons ("mods") for Claude Code, kept in one place so every session can use them.

| Mod | What it does |
| --- | --- |
| [`house-rules`](./house-rules) | Enforces Paddy's writing rules: no em dashes, and short replies. |
| [`identity-guard`](./identity-guard) | Stops commits and pushes under the wrong git identity before they reach GitHub. |

## House Rules

Paddy's writing rules get followed when they are in the conversation and dropped when they are not. Written preferences carry the rules; this mod only enforces the two things a written rule cannot.

### What it does

**The law: no em dash (the long dash, U+2014) reaches Paddy, a file, or anyone Paddy writes to.** A spaced en dash (a short dash with spaces either side) counts as an em dash. An unspaced en dash in a range ("2-3 days" written with the en dash) is fine.

| Where | What happens |
| --- | --- |
| **Chat replies** | The dash is swapped for a spaced hyphen ( - ) as the reply appears, so Paddy never sees one. Fenced code blocks are left alone. Any spaces around the dash collapse to exactly one either side. |
| **Files** (Write, Edit, NotebookEdit) | A write that **adds** an em dash is blocked. Claude is told which line, and asked to repunctuate (commas, full stops, colons, semicolons, or restructure). Em dashes already in the file are left alone. |
| **Outbound messages** (Gmail drafts, sends, replies and forwards; Slack messages and canvases; GitHub issues, PRs and comments; Plain replies and notes; ClickUp comments) | Every em dash in the text fields is swapped for a spaced hyphen before the message goes out. |
| **Long replies** | A reply over **300 words of prose** (fenced code and tables do not count) earns Claude one quiet note before its next reply. Paddy sees nothing. Nothing is ever blocked. |

What "right" looks like:

- Claude writes "The fix is simple [em dash] drop the override." Paddy sees "The fix is simple - drop the override."
- Claude tries to write a README with "Fast [em dash] and cheap". The write is blocked with: *"This adds 1 em dash (line 12: 'Fast ... and cheap'). Repunctuate: commas, full stops, colons or restructure."* Claude rewrites it as "Fast and cheap." and the write goes through.
- Claude edits a file that already has em dashes elsewhere, adding none. The edit goes straight through.
- A routine drafts a Gmail saying "Quick one [em dash] are you free Thursday?". The draft lands as "Quick one - are you free Thursday?".
- Claude writes a 520-word explanation. Before its next reply it reads: *"your last reply was 520 words of prose. Paddy wants short replies: bullets, under 300 words unless he asks for depth."* Paddy sees nothing.

### How to install it

In Claude Code (desktop app or terminal):

```
/plugin marketplace add none-ascetic/claude-mods
/plugin install house-rules@claude-mods
```

Mods need Claude Code 2.1.287 or newer.

### How to switch it on for a repo's cloud sessions

Add this to the repo's `.claude/settings.json` (create the file if there is not one), commit it, and cloud sessions on that repo load the mod:

```json
{
  "extraKnownMarketplaces": {
    "claude-mods": { "source": { "source": "github", "repo": "none-ascetic/claude-mods" } }
  },
  "enabledPlugins": { "house-rules@claude-mods": true }
}
```

This is the standard way to switch a plugin on per repo. It is confirmed for real in the inni pilot (ticket #3); until then treat it as the expected route.

### Settings

Change these with `claude plugin configure house-rules`, or in the plugin's settings row inside Claude Code.

| Setting | Default | What it does |
| --- | --- | --- |
| `lengthThreshold` | `300` | Words of prose in one reply before Claude gets the quiet note. |
| `exemptPaths` | none | File globs where em dashes are allowed in written files, for example `docs/quotes/*.md`. `*` matches within one folder, `**` matches across folders. |
| `outboundTools` | built-in list | Tool-name patterns (`*` is a wildcard) treated as outbound. If you fill this in it **replaces** the built-in list, so copy across any built-in pattern you still want. |

The built-in outbound patterns match whatever the connector is called in a session:
`mcp__*__create_draft`, `update_draft`, `send_message`, `reply`, `forward` (Gmail);
`slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas` (Slack);
`issue_write`, `add_issue_comment`, `update_issue_comment`, `create_pull_request`, `update_pull_request`, `pull_request_review_write`, `add_comment_to_pending_review`, `add_reply_to_pull_request_comment` (GitHub);
`replyToThread`, `createNote`, `addGeneratedReply` (Plain);
`clickup_create_comment`, `clickup_create_task_comment`, `clickup_update_comment` (ClickUp). Each one is written `mcp__*__<name>`.

### Step 0: do this first (2 minutes, no code)

The mod enforces; your preferences carry the rules. Add this to your claude.ai preferences (Settings, then Profile):

```
- No em dashes anywhere (chat, files, code comments, drafts). In my voice use a spaced hyphen ( - ); elsewhere repunctuate with commas, full stops or colons.
- Keep replies short: under 300 words of prose unless I ask for depth. Bullets over paragraphs.
- Git: commit as me (paddy.davies@me.com / none-ascetic), or as Claude's noreply in cloud sessions. Never the work email.
```

The third line replaces the old "MUST use paddy.davies@me.com" line (see the identity guard spec, #1).

### What it does not do

- It does not put rules into the system prompt (your preferences already do that).
- It does not fix US spellings.
- It cannot see em dashes written by shell commands (heredocs, scripts). Those slip past.
- Inline code in chat (single backticks) is not protected; only fenced blocks are.
- For notebooks, every dash in the new cell source counts as added, because the old cell is not compared.

### For developers

```
claude plugin validate ./house-rules
claude plugin test ./house-rules
node scripts/check-no-em-dashes.mjs     # the repo itself must contain no literal em dashes
```

Tests build their dashes from escape codes so the repo stays clean. The streaming swap, the file guard, the outbound swap and the length note are each covered in `house-rules/tests/`.

## Identity Guard

Vercel rejects builds when a commit is authored under the work email, and the error it gives does not say why. This mod catches a wrong identity before it reaches GitHub, and tells Claude exactly how to fix it.

### What it does

**The law: every commit created or pushed from a Claude Code session has an author and a committer that are each on the allow-list.** Anything else is blocked: the work email, a typo, an unknown address, an empty identity.

| Allowed identity | Where it is normal |
| --- | --- |
| `Paddy Davies <paddy.davies@me.com>` | Paddy's own machine (desktop app Code tab) |
| `Claude <noreply@anthropic.com>` | Claude Code cloud sessions. The container requires it, and commits under it deploy fine on Vercel. |

Email is compared in any case, the name exactly. A mix (author Paddy, committer Claude) is fine.

| Where | What happens |
| --- | --- |
| **Commit check** (`commit`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `pull`) | Reads the identity git would use, plus any override written in the command (`-c user.email=`, `--author=`, `GIT_AUTHOR_EMAIL=` and friends). A breach is blocked with the identity found, the allow-list and the exact fix. A pop-up appears. |
| **Push check** (`git push`) | Lists the commits about to leave (on the pushed branch, not on any remote). If any is off the list, the push is blocked, each offender is listed by short SHA, and the fix is given. A pop-up appears. |
| **Band** | One red line above the prompt while the current repo's identity is off the list. Nothing when it is fine, or when the folder is not a git repo. |

The commit check reads the words of the command, so it is a safety net. The push check reads what git actually recorded, so it catches anything that got past (scripts, aliases, `cd` tricks).

What "right" looks like:

- Claude runs `git -c user.email="paddy@dines.co.uk" commit -m "..."`. It is blocked with "Drop the override from the command". Claude drops it and the commit goes through.
- A repo is set to the work email. If the global identity is on the list, the fix is to remove the repo's own setting (`git config --unset user.name; git config --unset user.email`), so commits fall back to Claude in the cloud or Paddy on the laptop. Otherwise the fix is to set the repo to Paddy.
- A push carries an unpushed work-email commit. The fix is to correct the identity, then re-stamp only the unpushed commits: `git rebase --exec 'git commit --amend --no-edit --reset-author' <oldest unpushed commit>^`. History already on GitHub is never rewritten.
- A cloud session at its default identity, or a laptop repo set to Paddy: nothing appears and commits go straight through.

The guard never tells anyone to move off `Claude <noreply@anthropic.com>` when that is the global identity, because the cloud container's end-of-turn check requires it.

### How to install it

In Claude Code (desktop app or terminal):

```
/plugin marketplace add none-ascetic/claude-mods
/plugin install identity-guard@claude-mods
```

Mods need Claude Code 2.1.287 or newer.

### How to switch it on for a repo's cloud sessions

Add this to the repo's `.claude/settings.json` (create the file if there is not one), commit it, and cloud sessions on that repo load the mod:

```json
{
  "extraKnownMarketplaces": {
    "claude-mods": { "source": { "source": "github", "repo": "none-ascetic/claude-mods" } }
  },
  "enabledPlugins": { "identity-guard@claude-mods": true }
}
```

This is the standard way to switch a plugin on per repo. It is confirmed for real in the inni pilot (ticket #3); until then treat it as the expected route.

### How to change the allow-list

Change it with `claude plugin configure identity-guard`, or in the plugin's settings row inside Claude Code.

| Setting | Default | What it does |
| --- | --- | --- |
| `allowList` | `Paddy Davies <paddy.davies@me.com>`, `Claude <noreply@anthropic.com>` | The identities allowed to author and commit, each written `Name <email>`. An empty list falls back to the default. |

The setting is also the escape hatch: add an identity to let it through. There is no separate off switch.

### What it does not do

- It does not check commits Paddy makes by hand outside Claude Code.
- It does not check commits GitHub makes itself (web edits, the API, the GitHub tools that write files).
- It is not server-side enforcement, and it does not sign commits (the cloud container already does).
- It cannot see an identity set by a git alias or a script before the push. The push check catches those.

### For developers

```
claude plugin validate ./identity-guard
claude plugin test ./identity-guard
tsc -p identity-guard
```

Plugin tests have no real processes, so `identity-guard/tests/support.ts` is a small pretend git that answers only the calls the mod makes (`var`, `config --global --get`, `rev-parse`, `log`). It was checked against real git. For `tsc`, copy the types the engine writes when the mod loads into `identity-guard/.claude-plugin/types/` (gitignored).
