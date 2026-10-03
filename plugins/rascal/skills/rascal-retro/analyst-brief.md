# Retro analyst brief

You are reading digest records of a user's agent sessions. Each file is JSON: `source`, `id`, `cwd`, `start`, `end`, `turns` (the user's own messages, redacted), `skills` (skills/commands invoked, with `via`), `tools` (tool call counts) and `assistantTurns`. Read every file in your slice. Do not open anything else.

Return ONLY a JSON array of findings:

    [{ "kind": "workflow" | "correction" | "preference" | "skill-gap" | "no-skill-pattern",
       "scope": "generic" | "personal",
       "summary": "one sentence",
       "evidence": ["<source>:<id>", …],
       "proposal": "what rascal should change: a workflow, a skill edit, or a preference line" }]

- **workflow**: the same sequence of steps or skills across sessions (e.g. grill → domain-model → plan), whether or not skills were used.
- **correction**: the user repeatedly corrects the agent the same way ("no, don't…", "I said…", "stop asking").
- **preference**: a standing taste or rule the user states (format, tone, autonomy, tooling).
- **skill-gap**: the user does by hand, repeatedly, something a skill could do.
- **no-skill-pattern**: a kind of task the user handles well without any skill. These define the "just do it" route.

`scope` is **personal** when the finding names or depends on the user's clients, colleagues, private projects, or individual taste that wouldn't help anyone else. Otherwise it is **generic**. When unsure, choose personal. Never quote more than ten words of a user turn, and never include names, paths, emails or URLs in `summary` or `proposal`.
