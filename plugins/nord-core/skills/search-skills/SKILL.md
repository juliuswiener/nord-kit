---
name: search-skills
description: "Search the open agent-skills ecosystem (skills.sh / `npx skills`) for a skill that already exists, check whether it is trustworthy, and install it on request. Use on 'find a skill for X', 'is there a skill that…', 'gibt es dafür einen Skill', or when a capability is missing and someone has probably already built it. To write one instead, use `author-skills`; for the prompts.chat registry, `install-skill`."

disable-model-invocation: true
---

# search-skills — find one before writing one

`npx skills` is the package manager for the open agent-skills ecosystem; the catalogue is
at <https://skills.sh/>.

| command | what it does |
|---|---|
| `npx skills find [query]` | search by keyword, or interactively |
| `npx skills add <owner/repo@skill> -g -y` | install — `-g` user level, `-y` no prompts |
| `npx skills check` · `npx skills update` | updates for what is already installed |

## Run

1. **Name the need as domain plus task** — "react performance", "pr review", "changelog".
   A one-word query returns noise.
2. **Check the leaderboard first.** <https://skills.sh/> ranks by installs, which surfaces
   the battle-tested options without a search at all. `vercel-labs/agent-skills` (React,
   Next.js, web design) and `anthropics/skills` (frontend design, document processing) are
   both above 100k.
3. **Search** only if the leaderboard does not cover it: `npx skills find <query>`. Nothing
   found → broaden once, then report that nothing was found. **Never name a skill that was
   not in the results.**
4. **Verify before recommending.** Search rank is not endorsement:
   - installs — prefer 1k+, treat anything under 100 with suspicion
   - source — `vercel-labs`, `anthropics`, `microsoft` are known quantities; an unknown
     author is not disqualifying, but say so out loud
   - the repo — under 100 stars means read the SKILL.md before installing anything
5. **Present** name, what it does, install count, source, the exact install command and
   the skills.sh link. The user chooses.
6. **Install only on an explicit yes.** Then say it activates at the next session start,
   not in this one.

## When nothing fits

Say so plainly, offer to do the task directly, and mention `npx skills init <name>` if it
is something the user does often.

Do not stretch a near-match into a recommendation. An installed skill costs its
description in the cached prefix of **every session from then on**, whether it is ever
invoked or not — a skill that half fits is a permanent charge for an occasional
convenience.
