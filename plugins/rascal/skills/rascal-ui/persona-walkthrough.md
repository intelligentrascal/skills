# Persona walkthrough

Two people use the build the way they would for real, and report what got in their way.

## Scratch space

Everything goes under `.rascal/walkthrough/<slug>/` in the project. Make sure `.rascal/` is ignored by git: if `.rascal/.gitignore` doesn't exist, write it with the single line `*`.

## Personas

From the grill's or spec's jobs-to-be-done, write two contrasting personas to `.rascal/walkthrough/<slug>/personas.md`. Give each:
- who they are;
- the job they came to do;
- what they already know;
- the one thing that would make them give up.

Make them differ in what matters most to them, for example a first-time user against a daily power user.

## Browser

Use the browser tool this agent has (for example Claude in Chrome, or a Playwright or browser MCP). If it has none, install Playwright into the scratch space, never into the project's dependencies:

```bash
npm install --prefix .rascal/walkthrough playwright
npx --prefix .rascal/walkthrough playwright install chromium
```

Then drive each journey with a script at `.rascal/walkthrough/<slug>/<persona>.mjs` (it imports `playwright` from `.rascal/walkthrough/node_modules`), run with `node`. If the install fails (offline, blocked), put that under **Needs you** in the handoff and skip the walkthrough.

## Walk

Start the app with the command from the handoff's **Try it**. For each persona (in parallel subagents when available), walk their job end to end and take a screenshot at every step. Record each issue with:
- the step;
- the screenshot path;
- what they expected and what happened;
- a severity: **blocks the job**, **slows it**, or **cosmetic**.

Add the questions the persona would ask. Write it all to `.rascal/walkthrough/<slug>/<persona>-findings.md`.

## Triage

Merge both findings files into one numbered list. Fix every **blocks the job** item, re-walk that step, and attach the new screenshot. List the rest in the handoff with their screenshot paths.
