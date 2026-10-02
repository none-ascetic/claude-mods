# claude-mods

Small add-ons ("mods") for Claude Code, kept in one place so every session can use them.

| Mod | What it does |
| --- | --- |
| [`house-rules`](./house-rules) | Enforces Paddy's writing rules: no em dashes, and short replies. |

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
