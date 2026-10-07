# rascal: a personal skills pack — design

## Summary

`rascal` is a standalone skills plugin in this repo, alongside `intelligentrascal`. It brings together the best of Matt Pocock's skills, Superpowers and Cursor's pstack in one pack shaped by Rahil's own agent history. It has three layers:

1. **Mining.** Rahil's past agent transcripts are distilled into reusable workflows and personal preferences.
2. **Workflows.** Named rascal skills run the right chain of skills for a kind of task.
3. **Routing.** A router, backed by a short routing note installed on every agent, picks a workflow or decides that no skill is needed.

rascal depends on no upstream at runtime. Its skills are derived from upstream skills, and a `sync` skill proposes updates when the upstreams change. A `retro` skill keeps re-mining new sessions so the pack keeps learning. All four agents (Claude Code, Codex, OpenCode, Pi) are supported equally. The repo is public; raw mining output and personal lessons never leave the machine.

## Terms

- **RJ pack / rascal.** The personal skills pack this doc designs, shipped as the `rascal` plugin. *Avoid:* "my skills", "custom flavor".
- **Upstream.** A third-party skill collection that rascal's skills are synthesized from and synced against: Pocock's skills, Superpowers, pstack. rascal never installs one. *Avoid:* "base skills", "gstack", "dependency".
- **Source.** One upstream repo that sync tracks, pinned to the commit rascal last synced from. *Avoid:* "remote", "feed".
- **Router.** The skill that looks at a task and picks the skill or chain of skills to run, including none. *Avoid:* "orchestrator", "meta-skill".
- **Chain.** An ordered sequence of skills run for one task, for example grill → plan → TDD → review. *Avoid:* "combo", "pipeline".
- **Workflow.** A named rascal skill that runs a fixed chain for one kind of task (feature, bugfix, UI and so on). *Avoid:* "recipe", "playbook".
- **Mining.** Reading past agent transcripts to extract repeated corrections, workflows and preferences. *Avoid:* "insights extraction".
- **Digest.** The compact, normalized extract of transcripts (user turns, skill calls, corrections) that the retro reads instead of raw transcripts. *Avoid:* "summary", "dump".
- **Routing note.** The short always-on text installed into each agent's global instruction file (CLAUDE.md / AGENTS.md). It tells the agent when to route and when to just do the task. *Avoid:* "bootstrap", "system prompt".
- **Canonical skill.** The single rascal skill for a concept (TDD, debugging, review) where several upstreams each ship one. *Avoid:* "preferred skill", "default skill".
- **Preferences file.** A local file that is never committed. It holds personal lessons from mining, and every agent reads it via the routing note. *Avoid:* "memory", "profile".
- **Provenance header.** A short note at the top of a rascal skill naming the upstream file(s) and commit it was derived from. Sync uses it, and it provides attribution. *Avoid:* "credits", "frontmatter".
- **Sync.** The rascal skill that reads upstream changes since each source's pin and proposes edits to the rascal skills derived from them. *Avoid:* "update", "upgrade", "pull".
- **Override layer.** A skill that loads another skill and then states where it differs, like grilling-ui's Overrides table. In rascal this survives only as a design pattern; rascal skills are self-contained. *Avoid:* "patch", "wrapper".

## Why

In Rahil's words: "I sometimes use no skill, sometimes there's a combination of skills, and sometimes I use one skill or another, then one and then another. I think now is the time for us to figure that out." They want to "look at all my past Claude Code conversations and extract insights or reusable things from there, and then marry that together with the Matt Pocock skills, the P stack skills, as well as the superpower skills." The result should be "a very custom flavor … best suited for me".

The inventory in this grill (see Verified facts) confirms the pattern. Two-thirds of sessions use no skill. Skill use concentrates on a few chains, and nothing tells the agent which overlapping upstream skill to use.

## Locked decisions

**Q1. What the pack solves: all three layers.** Mined preferences feed named workflows, and a router picks the workflow.
- Rejected: *router only*. It is only as good as the workflows behind it.
- Rejected: *fixed workflows only*. Rahil would still have to choose between them by hand.
- Rejected: *personalization only*. It leaves the choosing and chaining problems unsolved.
- Cost accepted: the biggest build, phased per Q35.

**Q2. Standalone, no runtime upstream dependency.** rascal's own skills are synthesized from the upstreams. Users install only rascal, and an upstream-sync skill diffs upstream changes and proposes edits. This came from Rahil's thread on Q22 and replaced an earlier "mix" answer.
- Rejected: *depend* (rascal calls upstream skills by name). Users would have to install three packs, duplicates would compete, and behaviour would differ by agent.
- Rejected: *mix* (depend by default, vendor heavy changes). Kept the install and duplication problems.
- Cost accepted: rascal owns every skill. Upstream improvements arrive only through sync, and licences must be carried (Q32).

**Q3. A second plugin in this repo.** It reuses the marketplace, install scripts and smoke-run setup.
- Rejected: *folding into intelligentrascal*. Every grill-UI user would get Rahil's router and workflows.
- Rejected: *new private repo*. It would rebuild all the install infrastructure and needs GitHub auth on every agent.
- Cost accepted: the public repo needs scrubbing (Q15).

**Q4. Public pack.** Skills are generic, and raw mining output never leaves the machine.
- Rejected: *private everything*. Throws away the public setup and anything shareable.
- Rejected: *split public + private layer*. As a packaging choice this lost, but Q14 and Q25 recover the useful part: personal lessons go to a local preferences file outside the pack.

**Q6. Mining happens once now and then periodically.** One seed pass over all history now, then a periodic retro that proposes diffs for approval. The retro never edits silently.
- Rejected: *one-off*. The pack would go stale as habits change.
- Rejected: *ongoing only*. Nothing would be usable until enough runs had happened.

**Q10. Router invocation: an always-on routing note plus an explicit command.** A short note goes into CLAUDE.md / AGENTS.md on every agent, and `/rascal:go <task>` is also available.
- Rejected: *explicit only*. Rahil would have to remember to route.
- Rejected: *hooks in Claude Code*. Hooks don't exist on all four agents, and Q5 requires parity.
- Cost accepted: a few hundred tokens per session, and an install step that edits a global file.

**Q12. v1 workflows are chosen after the seed mining pass, not hand-picked now.** About 65% of sessions used no skill, so the most valuable workflows may be ones Rahil does by hand and never named. Candidates already visible: grilling → domain-modeling (8×), wayfinder → grilling (5×), Superpowers brainstorm → plan → execute, and impeccable/tastemaker for UI.
- Rejected: *hand-pick now*.
- Cost accepted: the pack isn't usable until the seed pass and the seed grill (Q24) are done.

**Q13. Copy or rewrite is decided per skill, and every skill carries a provenance header.**
- Copy and edit when a skill stays close to one upstream (TDD, debugging).
- Rewrite when it merges several upstreams or changes heavily (router, retro).
- Rejected: *copy everything*. Merged skills can't be copies.
- Rejected: *rewrite everything*. Sync becomes translation work for every change.
- Cost accepted: sync handles two kinds of skill, and headers must stay accurate.

**Q14. Personal lessons are routed locally.** The retro classifies each finding as generic or personal:
- Generic findings become proposed skill edits in the repo.
- Personal findings become proposed edits to the local preferences file (Q25) and are never committed.

Rejected: *drop personal findings*. They are often the most valuable output.

**Q16. Mining architecture: extractor scripts, then a digest, then an analyzing skill.**
- One node extractor per source normalizes transcripts into a single digest. It keeps user turns, corrections, skill and command invocations and outcomes, and drops tool output.
- A cursor file makes extraction incremental.
- The retro skill analyzes the digest, with subagents taking slices for the ~238-session seed pass.
- Each extractor reports an expected-versus-actual session count so a silent parser break is visible.
- Rejected: *pure skill grepping raw transcripts*. That is 364 MB of mostly tool output, isn't repeatable, and pulls private content into context.
- Rejected: *heuristic-only script*. It can count, but it can't recognize repeated corrections or preferences.
- Cost accepted: five parsers to maintain against formats Rahil doesn't own.

**Q18. Superpowers sources: both.** obra/superpowers is the main source for core skills, which are identical on all four agents. pcvelz's superpowers-extended-cc is a second source for Claude Code-only extras (native tasks, a commit-blocking hook while tasks are open, cheaper-model subagents). These ship as optional Claude Code features.
- Rejected: *obra only*. It loses the extras Rahil wanted.
- Rejected: *extended-cc only*. It doesn't run on Codex, OpenCode or Pi.
- Cost accepted: one more source to sync, and a small exception to "all four equal" for the Claude Code extras.

**Q19. pstack is a source like the others.** Rahil: "it comes in the same way as the other two skills… If we think there are skills that we are modifying heavily enough, then we no longer need to … be in sync with [the upstream creator]. So be it."
- Under standalone, rascal derives from pstack and sync tracks it, and nothing is installed.
- Cursor-bound pstack skills inform designs only. These are poteto-mode, arena, swarm, interrogate, recall and setup-pstack, which need Cursor model slugs, `~/.cursor` rules or Cursor-only skills.
- poteto-mode's "router + playbooks + figure-it-out when none fits" design is the blueprint for rascal's router. pstack's `reflect` is the blueprint for the retro.
- Rejected: *installing pstack wholesale*. It doesn't work off Cursor, and it would add a second router.

**Q22. One skill per concept.** Where the upstreams overlap, rascal ships one canonical skill and doesn't carry the others:
- TDD: Pocock tdd / Superpowers test-driven-development / pstack tdd.
- Debugging: Pocock diagnosing-bugs / Superpowers systematic-debugging.
- Review: Pocock code-review / Superpowers requesting-code-review.
- Planning: Pocock to-spec / Superpowers writing-plans.

The canonical table becomes rascal's skill list. The seed grill decides which upstream each canonical skill derives from.
- Rejected: *a canonical table with every upstream installed*. That would bring the duplicates back.
- Rejected: *per-workflow choice*. Nothing would govern the "just do it" route.

**Q23. Routing note contents: a short generated index of ≤30 lines.** It contains:
- when to just do the task;
- the workflow list with one-line triggers;
- the canonical-skill table;
- an explicit override of Superpowers' "even a 1% chance means use a skill" rule, which is still relevant on Rahil's machine where the desktop app injects Superpowers.

The note is generated from the workflow list, never hand-edited, so it can't drift.
- Rejected: *a one-liner*. It gives no criteria and no override.
- Rejected: *the full router inline*. Too costly per session, and Codex/OpenCode truncate large AGENTS.md files.
- Testing needed: whether the note beats hook-injected bootstraps on each agent (Q36).

**Q25. Personal lessons live in a single file, `~/.rascal/preferences.md`.** The routing note tells every agent to read it.
- Rejected: *each agent's native memory*. Four copies would diverge.
- Cost accepted: Claude Code's own memory folder keeps growing separately unless the retro folds it in.

**Q30. Sync works from pinned sources.**
- `sources.json` pins each source repo at a commit.
- `/rascal:sync` fetches upstream diffs since each pin and maps changed upstream files to rascal skills via provenance headers.
- It proposes edits on a branch for review, then advances the pins.
- Rejected: *re-synthesize affected skills each time*. Large, noisy diffs.
- Rejected: *report only*. Leaves all the porting to Rahil.
- Cost accepted: changes are missed if provenance headers are wrong.

**Q31. rascal ships its own grilling, in both terminal and browser-UI forms.** Grilling is Rahil's most-used skill, and they use both forms. intelligentrascal's current grill skills stay untouched: they keep loading Pocock's grilling as they do today.

**Q34. The grill transport lives in one shared folder.** The browser page, `hub.mjs` and the listener move into a shared folder in this repo.
- A copy script copies it into both plugins, because Claude Code caches only a plugin's own folder.
- `--check` reports drift without writing and runs from the pre-commit hook. Per Rahil, this check gets no CI (the privacy scrub, Q15, does).
- Rejected: *two independent copies*. Fixes would have to be made twice.
- Rejected: *rascal depending on intelligentrascal*. That breaks standalone.
- Cost accepted: a repo-layout refactor for intelligentrascal. Its skills and behaviour are unchanged.

## Routine choices

- **Q5:** All four agents (Claude Code, Codex, OpenCode, Pi) are supported equally. Skills can't rely on Claude Code-only features except the optional extended-cc extras (Q18).
- **Q7:** "P stack" is Cursor's pstack (`cursor/plugins/pstack`, by Lauren Tan, MIT), not gstack.
- **Q8:** The plugin is named `rascal`: `/rascal:go`, `/rascal:retro`, `/rascal:sync`.
- **Q9:** Mining reads every store: Claude Code CLI, Claude desktop, Codex, OpenCode and Cursor (~238 sessions).
- **Q11:** "Just do it" is a first-class route for small, clear tasks. The router needs a crisp rule for "small and clear".
- **Q15:** Leaks are stopped by review plus a scrub check before commit. The check is a pre-commit hook using a local, gitignored deny-list (names, home paths, emails, token patterns). The same check runs on the digest and on retro proposals before Rahil sees them. CI also runs it, with generic patterns only (paths, emails, token shapes), because the deny-list stays local. This is the only CI check; the transport copy check (Q34) runs pre-commit only.
- **Q17:** The retro is run manually, and the router nudges when it's due.
- **Q20:** `install-agents.sh` installs rascal only, on all four agents: its skills, the routing note per agent, and the `~/.rascal/` scaffold. It installs no upstreams. *Amended in step 6:* rascal's installer is `install-rascal.sh`; `install-agents.sh` stays intelligentrascal's (`docs/rascal-v1-design.md`, "Step 6").
- **Q21:** pstack skills rascal draws from and sync tracks are the portable set: principle-* (22), reflect, unslop, how, why, teach, blast-radius and architect.
- **Q24:** Seed findings are reviewed in a grill. They become questions on a grill page, and Rahil answers them like this session; that grill chooses v1 workflows and canonical skills.
- **Q26:** Mining state lives in `~/.rascal/`: `mining/` (digest), `cursor.json`, `denylist.txt` and `preferences.md`. It sits outside every checkout, so it can't be committed by accident.
- **Q27:** The seed pass is not a separate skill. `/rascal:retro --all` is the seed pass, and plain `/rascal:retro` is incremental.
- **Q28:** The retro nudge fires after 15 new sessions across all agents or 14 days since the last retro, whichever comes first. State lives in `~/.rascal/`.
- **Q29:** The experimental wayfinder × poteto-mode skill is decided in the seed grill alongside the other workflow candidates. It would chart a big goal into tickets (wayfinder), then run each ticket through its matched playbook (poteto-mode-style routing).
- **Q32:** Attribution uses a `THIRD_PARTY_NOTICES` file with each source's licence plus a per-skill provenance header. Sync appends a licence when a source is added. Each repo's LICENSE must be checked before shipping.
- **Q33:** `/rascal:sync` is a separate skill. The retro nudge also checks upstream pins and suggests sync when they've moved.
- **Q35:** Build order:
  1. rascal grilling, terminal and UI, including the Q34 shared-transport refactor.
  2. Extractors and digest.
  3. `/rascal:retro --all` seed pass.
  4. Seed grill.
  5. The chosen workflows and canonical skills.
  6. Router and routing note.
  7. Sync.

  Status (2026-10-07): steps 1–6 are built; step 7 (sync) is next.
- **Q36:** Verification is a smoke-run checklist per agent, per release:
  - install works;
  - the routing note is present;
  - the router picks "just do it" for a trivial task and a workflow for a feature task;
  - retro runs on a tiny digest;
  - sync dry-runs.

  Results are recorded like the existing smoke-run record.

## Verified facts

Established during the grill by inspecting the machine and the upstream repos (2026-10-02):

- **Claude Code history** (`~/.claude/projects`): 24 project dirs, 242 `.jsonl` files (364 MB), of which 68 are top-level sessions and 174 are subagent transcripts. They are dated 2026-09-03 to 2026-10-02, so history is about a month deep.
- **Skill use over those 68 sessions:**
  - 43 Skill tool calls and 35 slash commands.
  - 65% of sessions used no skill or command, 4% exactly one, and 31% two or more (the last figure includes built-ins like `/clear`).
  - Top skills: Pocock grilling 11, domain-modeling 8, `/wayfinder` 7.
  - Most common pairs: grilling → domain-modeling 8, `/wayfinder` → grilling 5.
  - Superpowers was used about 7 times (brainstorming 2; execute-plan, executing-plans, finishing-a-development-branch, using-git-worktrees and subagent-driven-development once each).
  - Others: impeccable, tastemaker, design-md-planner, appspace-branding, claude-api.
- **Other transcript stores:**
  - Claude desktop (`~/Library/Application Support/Claude/local-agent-mode-sessions`): 127 `.jsonl`.
  - Codex (`~/.codex/sessions`): 13 sessions.
  - OpenCode (`~/.local/share/opencode/opencode.db`, SQLite): 4 sessions.
  - Cursor (`~/.cursor/projects/*/agent-transcripts`): 26 files.
- **Installed:**
  - Pocock `mattpocock-skills@mattpocock` 1.2.3.
  - intelligentrascal 0.1.0.
  - `superpowers-extended-cc` is supplied inline by the Claude desktop app and isn't in `installed_plugins.json`.
  - gstack is not installed anywhere and was never used.
  - `~/.agents/skills` holds Pocock's grilling, domain-modeling, research, prototype and the intelligentrascal -ui skills.
- **pstack** (`cursor/plugins/pstack` v0.15.5, MIT, Lauren Tan):
  - A Cursor plugin (`.cursor-plugin/plugin.json`) with plain SKILL.md folders.
  - Router: `poteto-mode`, with 23 playbooks, and `figure-it-out` for when no playbook fits.
  - 22 `principle-*` skills, plus reflect, unslop, how, why, teach, blast-radius, architect, arena, swarm, interrogate, recall, setup-pstack, tdd and others.
  - Cursor-only dependencies: `~/.cursor/rules/pstack-models.mdc`, Cursor model slugs, Cursor transcripts (recall), cursor-team-kit skills, and Cursor automations (`benny`).
- **Superpowers:**
  - obra/superpowers (MIT, about 294k stars) is canonical and installs on Claude Code, Codex, OpenCode, Pi and Cursor.
  - superpowers-extended-cc is the pcvelz/superpowers fork (about 1.3k stars) and runs on Claude Code only.
  - The two use different skill namespaces.
- **This repo's install path today:**
  - Claude Code gets Pocock via a `plugin.json` dependency, which needs `claude plugin marketplace add mattpocock/skills` first.
  - `scripts/install-agents.sh` symlinks the -ui skills into `~/.agents/skills` and installs missing Pocock skills with `npx skills add mattpocock/skills -g -a codex opencode pi --skill …`. It supports `--no-install` and records what it found in `upstream.local.json`.

## Risks

- **Thin history.** One month and ~238 sessions may not reveal stable workflows. The seed grill should treat findings as hypotheses, and the retro will correct them.
- **Parser rot.** Five transcript formats Rahil doesn't own (OpenCode is SQLite) can change silently. The expected-versus-actual counts in the extractors are the only guard.
- **Routing note vs bootstraps.** On Claude Code (desktop) and Pi, Superpowers re-injects its "always use a skill" bootstrap via hook, which may override the note's 1% override. This must be tested per agent (Q36).
- **Public leaks.** Mining touches private client and project content. The scrub check only catches what the deny-list and patterns know, so review is still required, and a leaked public commit is effectively permanent.
- **Upstream drift.** Sync depends on accurate provenance headers. Rewritten, merged skills need judgement to port changes, and pstack moves fast (v0.15).
- **Two grilling skills on Rahil's machine.** rascal's grilling and the Pocock grilling used by intelligentrascal will diverge by design (Q31). Rahil must know which one a given command runs.
- **Shared-transport refactor.** Moving `hub.mjs` and the page into a shared folder touches intelligentrascal's layout. A missed copy would break the published grill-ui plugin; the pre-commit `--check` is the guard.
- **Router under-routing.** With "just do it" as a first-class route, a vague "small and clear" rule could skip workflows that would have helped.
- **Licences.** All three upstreams are believed to be MIT, but this must be confirmed from each LICENSE before the first public release.

## Deferred

None. Every question was answered.

## Open threads

- **Which upstream each canonical skill derives from** (TDD, debugging, review, planning, grilling). Deliberately left to the seed grill (Q22, Q24).
- **The v1 workflow list**, including whether the experimental wayfinder × playbook skill makes it. Left to the seed grill (Q12, Q29).
- **The "small and clear" rule for the just-do-it route** (Q11). Its wording should come from the mined no-skill sessions.
- **Folding Claude Code's memory folder into `~/.rascal/preferences.md`** (Q25 cost). The retro might absorb existing memories, but how hasn't been decided.
