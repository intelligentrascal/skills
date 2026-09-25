// Mockup data for design/mockups (spec §9.1). Inlined into each *.template.html by build.mjs.
// SESSION is in the real state.json shape (spec §4; Jason's schema, grill-with-ui SKILL.md:392-417):
// questions is an ARRAY; rounds are derived from question.round.
// Rounds 1–8 are Jason Ku's real grill-with-ui design session of 2026-09-06 (commit daafa1e,
// design/mockups/data.js), text unchanged. Round 9 (q18–q25) is synthetic: 7 open + q23 deferred;
// q15 and q16 were answered, then reopened (see their threads); the visual (v3) is stale.
// VISUAL_HTML is the v3 prototype: regions carry data-q and it ends with the verbatim
// grilling-ui linkage listener (plan Task 20). "<\/script>" keeps it safe when inlined in <script>.
const SESSION = {
  "topic": "grill-with-ui skill",
  "doc": "docs/design.md",
  "project": "~/Projects/grill-with-ui",
  "created": "2026-09-06T21:00:00Z",
  "agent": {
    "status": "waiting",
    "since": "2026-09-06T22:46:00Z",
    "handled": 9
  },
  "note": "Round 9 is open. Q15 and Q16 were reopened by later answers; Q23 is deferred.",
  "visual": {
    "kind": "prototype",
    "version": 3,
    "at": "2026-09-06T22:31:00Z",
    "stale": true,
    "note": "v3: Inbox layout with the doc path in the send bar per Q9; stale since Q15 was reopened",
    "thread": [
      {
        "who": "user",
        "text": "Put the doc path next to Finish so I can see where it will write.",
        "at": "2026-09-06T22:26:00Z"
      },
      {
        "who": "agent",
        "text": "Done in v3: the send bar shows → docs/design.md and the section order from Q16.",
        "at": "2026-09-06T22:31:00Z"
      }
    ]
  },
  "terms": [
    {
      "term": "Round",
      "def": "One agent turn's worth of new questions: the current frontier.",
      "avoid": [
        "batch",
        "wave"
      ]
    },
    {
      "term": "Frontier",
      "def": "Questions whose prerequisites are all settled and can be asked now.",
      "avoid": [
        "queue",
        "next up"
      ]
    },
    {
      "term": "Send",
      "def": "One press of Send to Agent: every staged action shipped as a single event.",
      "avoid": [
        "submit",
        "reply"
      ]
    },
    {
      "term": "Durable decision",
      "def": "Hard to reverse, surprising without context, a real trade-off. Goes under Locked decisions.",
      "avoid": [
        "ADR",
        "big decision"
      ]
    }
  ],
  "questions": [
    {
      "id": "q1",
      "round": 1,
      "deps": [],
      "title": "UI surface",
      "body": "What is the UI surface, and how does it talk to the running session? This is the root decision; state format, threads and resume all hang off it.",
      "options": [
        {
          "k": "A",
          "text": "Local browser app. A tiny bundled server serves a page and reads/writes one state file per session. Terminal stays a parallel input."
        },
        {
          "k": "B",
          "text": "Read-only side panel. Claude re-renders an HTML summary each turn; you still answer in the terminal by number."
        },
        {
          "k": "C",
          "text": "MCP app panel. Only if Claude Code renders it. Heavier to build and install."
        },
        {
          "k": "D",
          "text": "Terminal TUI. Doesn't solve scrollback. Listed to rule out."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Works in any terminal today, nothing to install, and the file protocol is agent-neutral so a Codex version is packaging, not a rewrite."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A",
        "text": "A is exactly what I was thinking"
      },
      "thread": []
    },
    {
      "id": "q2",
      "round": 2,
      "deps": [
        "q1"
      ],
      "title": "Transport",
      "body": "How does a browser answer reach the running Claude session? Docs check: Monitor wakes an idle session; a background shell exiting does not; Channels need a launch flag.",
      "options": [
        {
          "k": "A",
          "text": "Persistent Monitor on the server's WebSocket. Every browser action is one event and one Claude turn."
        },
        {
          "k": "B",
          "text": "Claude Code Channels. Officially blessed, but needs a startup flag and a plugin."
        },
        {
          "k": "C",
          "text": "Manual nudge: answer in the browser, type 'go' in the terminal."
        }
      ],
      "rec": {
        "option": "A",
        "why": "No startup flags, works from inside the skill. Live test fired while idle: verified."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "text",
        "text": "Simpler: the web app writes to a local JSON and the agent has a file-change watcher on it."
      },
      "thread": [
        {
          "who": "agent",
          "text": "Yes, and simpler than what I proposed. Refinement: two files, not one. state.json written only by the agent; events.jsonl appended only by the web app, watched with plain tail -F.",
          "at": "2026-09-06T21:11:00Z"
        }
      ]
    },
    {
      "id": "q3",
      "round": 3,
      "deps": [
        "q2"
      ],
      "title": "Questions per turn",
      "body": "When Claude replies to a batch, how many new questions does it post on top of the thread replies?",
      "options": [
        {
          "k": "A",
          "text": "Exactly one new primary question per turn. Keeps 'resolve dependencies one by one'."
        },
        {
          "k": "B",
          "text": "Up to a few new questions when they're independent. Fewer round trips; recommendations can go stale."
        }
      ],
      "rec": {
        "option": "A",
        "why": "You already batch on your side; keeping Claude to one at a time is what makes recommendations trustworthy."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "option",
        "option": "B",
        "text": ""
      },
      "thread": []
    },
    {
      "id": "q4",
      "round": 3,
      "deps": [
        "q1"
      ],
      "title": "Thread context",
      "body": "What does 'chat more about a question without losing context' mean mechanically?",
      "options": [
        {
          "k": "A",
          "text": "One Claude session; threads are labeled messages. Nothing is separate under the hood."
        },
        {
          "k": "B",
          "text": "A subagent per thread, seeded with a summary. Isolation, but loses exactly the context you want."
        }
      ],
      "rec": {
        "option": "A",
        "why": "The thing you're missing is navigation, not isolation. The page provides that."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q5",
      "round": 4,
      "deps": [
        "q4"
      ],
      "title": "Question card shape",
      "body": "What does a question look like on the page, and how do you answer it? This fixes the state schema.",
      "options": [
        {
          "k": "A",
          "text": "Structured card: title, body, lettered options, a recommendation pointing at one, a rationale. Answer by option, Accept, or free text. Thread box separate."
        },
        {
          "k": "B",
          "text": "Free text everywhere. Simpler schema, no one-click accept."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Grilling already produces lettered options and a named recommendation, so structure costs nothing."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q6",
      "round": 4,
      "deps": [
        "q1"
      ],
      "title": "Terminal role",
      "body": "What does the terminal do while a grill runs in the page?",
      "options": [
        {
          "k": "A",
          "text": "One-line status per turn, plus the URL. Terminal typing still works and is recorded into state."
        },
        {
          "k": "B",
          "text": "Terminal goes silent. Launch only."
        },
        {
          "k": "C",
          "text": "Terminal mirrors the full text. Defeats the purpose."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Same scrollback cost as silence, and it gives you the 'Claude is waiting' signal where you're already looking."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q7",
      "round": 4,
      "deps": [
        "q2"
      ],
      "title": "Server lifecycle",
      "body": "Who starts and stops the local server, and how do we guarantee it dies? Orphaned processes have bitten this machine before.",
      "options": [
        {
          "k": "A",
          "text": "The server is the monitor. It lives exactly as long as the monitor: killed at session end or on Finish. Nothing to orphan."
        },
        {
          "k": "B",
          "text": "Server in the background, separate tail watcher. Needs its own shutdown story; every option is a way to leak."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Same file-based design, with writer and watcher collapsed into one process the harness already manages."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q8",
      "round": 5,
      "deps": [
        "q5"
      ],
      "title": "Finish + deliverable",
      "body": "How does a grill end, and what's the deliverable? Past grills all ended as design docs.",
      "options": [
        {
          "k": "A",
          "text": "Explicit Finish button; Claude writes a markdown decisions doc from state. Doc path asked once at start."
        },
        {
          "k": "B",
          "text": "No explicit end; the state file is the record."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Writing from a structured state file is more faithful than writing from a long transcript."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": [
        {
          "who": "user",
          "text": "Can you also look up Matt Pocock's grill-with-docs skill to see what we can borrow for the docs part, and compare it to the docs we already generate?",
          "at": "2026-09-06T21:39:00Z"
        },
        {
          "who": "agent",
          "text": "Fetched it. It's one line: run grilling + domain-modeling. The docs part writes a repo-wide CONTEXT.md glossary and sparse ADRs gated on hard-to-reverse, surprising, real trade-off. Your docs are the opposite shape: one exhaustive topic doc builders consume as the spec. Turned into Q9.",
          "at": "2026-09-06T21:41:00Z"
        }
      ]
    },
    {
      "id": "q9",
      "round": 5,
      "deps": [
        "q8"
      ],
      "title": "What Finish writes",
      "body": "Your exhaustive topic doc, Matt's sparse ADRs and glossary, or both?",
      "options": [
        {
          "k": "A",
          "text": "Your design doc, with two borrows: a per-decision durable flag (Locked vs Routine sections) and a Terms section with Avoid lists."
        },
        {
          "k": "B",
          "text": "Your design doc plus ADRs in docs/adr and a root CONTEXT.md. Two places to keep in sync."
        },
        {
          "k": "C",
          "text": "Matt's files only. Rejected: builders need the exhaustive doc."
        }
      ],
      "rec": {
        "option": "A",
        "why": "The durable flag and the terms section fix two real problems; repo-wide files can be an opt-in flag later."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q10",
      "round": 6,
      "deps": [
        "q7"
      ],
      "title": "State location + resume",
      "body": "Where does session state live, and how does resume work? Several worktrees per project here.",
      "options": [
        {
          "k": "A",
          "text": "Per-session folder under home, keyed by git common root (working directory when not in git). Resume lists unfinished sessions for the project."
        },
        {
          "k": "B",
          "text": "Inside the repo, gitignored. Lives in one worktree; ws reset wipes it."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Worktree independence decides it here; for adopters it also means zero repo changes."
      },
      "status": "answered",
      "durable": true,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": [
        {
          "who": "user",
          "text": "Hm, what would be easier for other people to adopt?",
          "at": "2026-09-06T21:52:00Z"
        },
        {
          "who": "agent",
          "text": "Outside the repo, by a wider margin: zero repo changes, one mental model, works outside git, resume is discoverable anyway. Only loss: sessions don't travel with a clone, which is a non-goal.",
          "at": "2026-09-06T21:54:00Z"
        }
      ]
    },
    {
      "id": "q11",
      "round": 6,
      "deps": [
        "q10"
      ],
      "title": "Stack",
      "body": "What is the server and page built with? Must run the moment the skill is installed.",
      "options": [
        {
          "k": "A",
          "text": "Plain Node, no dependencies, no build step. One server script, one self-contained HTML page."
        },
        {
          "k": "B",
          "text": "Bun. Nicer API, not on most machines."
        },
        {
          "k": "C",
          "text": "React with a build step."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Claude Code requires Node, so every adopter has it. Polish comes from CSS, not the framework."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q12",
      "round": 7,
      "deps": [
        "q9"
      ],
      "title": "Relation to grilling skills",
      "body": "How does grill-with-ui relate to the grilling and grill-me skills you already have?",
      "options": [
        {
          "k": "A",
          "text": "Self-contained new skill with its own interview prompt (frontier-per-round) plus the page protocol. Developed in its own repo, symlinked in."
        },
        {
          "k": "B",
          "text": "Composition, Matt-style: invoke grilling plus a protocol skill. Two skills fighting over output format."
        },
        {
          "k": "C",
          "text": "A flag on grill-me."
        }
      ],
      "rec": {
        "option": "A",
        "why": "One folder, one prompt, nothing to depend on. Publishable later without extraction."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q13",
      "round": 7,
      "deps": [
        "q11"
      ],
      "title": "Agent neutrality",
      "body": "Claude Code only, or agent-neutral from the start? Codex has no Monitor; Bedrock/Vertex Claude Code lacks it too.",
      "options": [
        {
          "k": "A",
          "text": "Add a blocking wait mode to the server now: blocks in the foreground until the next Send, prints it, exits. About twenty lines."
        },
        {
          "k": "B",
          "text": "Claude Code only for v1."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Cheap, also the fallback for Claude Code without Monitor, keeps the no-lock-in promise."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q14",
      "round": 7,
      "deps": [
        "q13"
      ],
      "title": "Build order",
      "body": "What gets built first? One assumption is unverified: the harness labels monitor events 'not user input'; the skill prompt says Send events are your answers.",
      "options": [
        {
          "k": "A",
          "text": "Spike the wake-up path first: minimal server, one-textarea page, stub prompt with only the event rule. One real round."
        },
        {
          "k": "B",
          "text": "Build everything, then test end to end."
        }
      ],
      "rec": {
        "option": "A",
        "why": "The only piece that can't be reasoned out from what we already know."
      },
      "status": "answered",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": []
    },
    {
      "id": "q15",
      "round": 8,
      "deps": [
        "q11"
      ],
      "title": "Page visual direction",
      "body": "Three mockups are on the table. Which layout carries forward into the spike page?",
      "options": [
        {
          "k": "A",
          "text": "Inbox: question list on the left, one detail card on the right, sticky send bar."
        },
        {
          "k": "B",
          "text": "Scroll: single column of cards grouped by round, outline rail for jumping."
        },
        {
          "k": "C",
          "text": "Tree + focus: dependency tree on the left, one focused card, thread drawer."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Best fit for 'go back to an earlier question' and it keeps the current question in view while you read history."
      },
      "status": "reopened",
      "durable": false,
      "updated": false,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": [
        {
          "who": "agent",
          "text": "Reopened: Q19 puts the visual in a sandboxed iframe that needs real width, and the Inbox has no room for it beside the card. The layout choice should be made against the three mockups with the visual in place, not before it existed.",
          "at": "2026-09-06T22:44:00Z"
        }
      ]
    },
    {
      "id": "q16",
      "round": 8,
      "deps": [
        "q9"
      ],
      "title": "Doc template sections",
      "body": "Section order for the generated design doc: Terms, Why, Locked decisions, Routine choices, Deferred, Follow-ups?",
      "options": [
        {
          "k": "A",
          "text": "That order, with the header carrying the locked-decision count and the date."
        },
        {
          "k": "B",
          "text": "Decisions first, Terms at the end as an appendix."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Terms first is what makes cold re-entry work; the header count is your existing convention."
      },
      "status": "reopened",
      "durable": false,
      "updated": true,
      "answer": {
        "kind": "accept",
        "option": "A"
      },
      "thread": [
        {
          "who": "agent",
          "text": "Reopened: Q24 lets Finish run with open questions, so the doc needs somewhere to list them. The accepted order has Deferred but no Open threads section. Proposed: add Open threads after Deferred, and a Verified facts section before Risks.",
          "at": "2026-09-06T22:45:00Z"
        }
      ]
    },
    {
      "id": "q17",
      "round": 8,
      "deps": [
        "q15"
      ],
      "title": "Keyboard shortcuts",
      "body": "j/k to move between questions, a/b/c to pick an option, enter to stage, cmd+enter to send?",
      "options": [
        {
          "k": "A",
          "text": "Yes, all of them, shown in a footer hint."
        },
        {
          "k": "B",
          "text": "Defer to after the spike."
        }
      ],
      "rec": {
        "option": "B",
        "why": "Zero cost to add later; not on the critical path."
      },
      "status": "deferred",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q18",
      "round": 9,
      "deps": [
        "q9"
      ],
      "title": "Where does Finish save the visual?",
      "body": "The visual lives in the session folder while the grill runs. When Finish writes the design doc, where does the final visual go?",
      "options": [
        {
          "k": "A",
          "text": "Copy it next to the doc as docs/<slug>-visual.html and link it from the doc header."
        },
        {
          "k": "B",
          "text": "Leave it in the session folder and link the absolute path."
        },
        {
          "k": "C",
          "text": "Inline a screenshot into the doc; drop the HTML."
        }
      ],
      "rec": {
        "option": "A",
        "why": "It travels with the doc in the repo and still opens offline. Costs one more file per design in docs/."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q19",
      "round": 9,
      "deps": [
        "q15"
      ],
      "title": "Should the visual run sandboxed?",
      "body": "The visual is agent-written HTML with scripts. How is it embedded in the page?",
      "options": [
        {
          "k": "A",
          "text": "iframe with sandbox=\"allow-scripts\" and no same-origin; talk to it only through postMessage."
        },
        {
          "k": "B",
          "text": "Same-origin iframe so the page can reach into its DOM for highlighting."
        },
        {
          "k": "C",
          "text": "Render it as a static screenshot; no scripts at all."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Agent-written scripts never touch the session token or state. Costs a small verbatim listener in every visual for highlighting and ⌘↵."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q20",
      "round": 9,
      "deps": [
        "q19"
      ],
      "title": "When does a stale visual get redrawn?",
      "body": "Ordinary decisions can make the visual out of date. Who triggers the redraw?",
      "options": [
        {
          "k": "A",
          "text": "Only the user, via Visualize. The page marks the visual stale until then."
        },
        {
          "k": "B",
          "text": "The agent redraws after every round that touches a drawn region."
        },
        {
          "k": "C",
          "text": "Redraw on a timer when stale for more than five minutes."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Draws are slow and burn a subagent each; a stale badge is cheap. The cost is that the user has to notice the badge."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q21",
      "round": 9,
      "deps": [
        "q2"
      ],
      "title": "What if the agent looks stuck?",
      "body": "Send is disabled while the agent works. If the agent never patches back, how does the user recover?",
      "options": [
        {
          "k": "A",
          "text": "Re-enable Send after 5 minutes with a 'still working?' note; staged work is kept."
        },
        {
          "k": "B",
          "text": "Keep Send disabled until the agent answers, however long."
        },
        {
          "k": "C",
          "text": "Show a Cancel button that writes a cancel event."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Nothing is lost and a genuinely slow agent just sees one extra send. Costs a possible duplicate turn if the agent was only slow."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q22",
      "round": 9,
      "deps": [
        "q5"
      ],
      "title": "Should staged work survive a reload?",
      "body": "A half-staged round is lost if the tab reloads or the hub restarts. Keep it?",
      "options": [
        {
          "k": "A",
          "text": "Stage into localStorage keyed by session id; clear on a successful send."
        },
        {
          "k": "B",
          "text": "Stage on the hub so any tab or device sees it."
        },
        {
          "k": "C",
          "text": "No persistence; reloading drops staged picks."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Survives reloads and layout switches with no server change. Staging does not follow you to another browser."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q23",
      "round": 9,
      "deps": [
        "q4"
      ],
      "title": "Should threads accept file attachments?",
      "body": "Users sometimes want to drop a screenshot or log into a thread message.",
      "options": [
        {
          "k": "A",
          "text": "Yes: store attachments in the session folder and pass paths to the agent."
        },
        {
          "k": "B",
          "text": "No for v1: paste text only."
        }
      ],
      "rec": {
        "option": "B",
        "why": "Paths cover most cases and attachments need upload, size limits and cleanup. The cost is copying logs by hand."
      },
      "status": "deferred",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q24",
      "round": 9,
      "deps": [
        "q8"
      ],
      "title": "Can Finish run with open questions?",
      "body": "The user presses Finish while some questions are still open or reopened.",
      "options": [
        {
          "k": "A",
          "text": "Allow it after a confirm; list the open ones under Open threads in the doc."
        },
        {
          "k": "B",
          "text": "Block Finish until every question is answered or deferred."
        },
        {
          "k": "C",
          "text": "Auto-defer every open question, then finish."
        }
      ],
      "rec": {
        "option": "A",
        "why": "The user decides when enough is enough, and nothing silently disappears. Costs a doc that may ship with loose ends."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    },
    {
      "id": "q25",
      "round": 9,
      "deps": [
        "q5"
      ],
      "title": "Who may reopen an answered question?",
      "body": "Reopening sends a settled decision back to the frontier and can invalidate downstream answers.",
      "options": [
        {
          "k": "A",
          "text": "Both: the user from the page, the agent when a later answer conflicts, always with a thread note."
        },
        {
          "k": "B",
          "text": "Only the user."
        },
        {
          "k": "C",
          "text": "Only the agent."
        },
        {
          "k": "D",
          "text": "Nobody; ask a new question instead."
        }
      ],
      "rec": {
        "option": "A",
        "why": "Conflicts found by the agent surface where the decision lives, not in the terminal. Costs some churn when the agent reopens too eagerly."
      },
      "status": "open",
      "durable": false,
      "updated": false,
      "answer": null,
      "thread": []
    }
  ]
};

const VISUAL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>grill-with-ui v3</title>
<style>
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f1c18; background: #f7f4ee; }
  .chrome { display: flex; gap: 8px; align-items: center; padding: 6px 10px; background: #e6e0d4; font-size: 12px; color: #625b51; }
  .url { flex: 1; background: #fff; border-radius: 4px; padding: 2px 8px; font-family: ui-monospace, Menlo, monospace; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e6e0d4; background: #fff; }
  header h1 { font: 600 16px/1.2 "Iowan Old Style", Charter, Georgia, serif; margin: 0; }
  .chip { font-size: 12px; padding: 1px 8px; border: 1px solid #e6e0d4; border-radius: 99px; color: #625b51; }
  .app { display: grid; grid-template-columns: 180px 1fr; min-height: 260px; }
  nav { border-right: 1px solid #e6e0d4; padding: 10px; font-size: 13px; }
  nav div { padding: 3px 6px; border-radius: 4px; }
  nav .cur { background: #fff; box-shadow: inset 3px 0 0 #1f1c18; }
  main { padding: 14px; }
  .card { background: #fff; border: 1px solid #e6e0d4; border-radius: 8px; padding: 12px 14px; }
  .card h2 { font: 600 15px/1.3 "Iowan Old Style", Charter, Georgia, serif; margin: 0 0 8px; }
  .opt { border: 1px solid #e6e0d4; border-radius: 4px; padding: 6px 8px; margin: 4px 0; }
  .opt.rec { border-style: dashed; border-color: #8a5a12; }
  footer { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 8px 14px; border-top: 1px solid #e6e0d4; background: #fff; }
  footer .doc { margin-right: auto; font-size: 12px; color: #625b51; font-family: ui-monospace, Menlo, monospace; }
  button { font: inherit; padding: 4px 12px; border-radius: 4px; border: 1px solid #e6e0d4; background: #fff; }
  button.primary { background: #9a3a26; border-color: #9a3a26; color: #fff; }
  .term { background: #1f1c18; color: #e6e0d4; font: 12px/1.4 ui-monospace, Menlo, monospace; padding: 8px 12px; }
  .assumed { position: relative; outline: 1px dashed #8a5a12; outline-offset: -1px; }
  .assumed::before { content: attr(data-tag); position: absolute; top: -9px; right: 8px; background: #f8ecd2; color: #8a5a12; font-size: 11px; padding: 0 6px; border-radius: 3px; }
  [data-q] { cursor: pointer; }
</style>
</head>
<body>
  <div class="chrome" data-q="q1"><span>●●●</span><span class="url">127.0.0.1:4317/s/20260906-210200-a3f9/</span><span>local browser app</span></div>
  <header data-q="q12"><h1>grill-with-ui</h1><span class="chip">self-contained skill</span><span class="chip">round 9 · 7 open</span></header>
  <div class="app assumed" data-q="q15" data-tag="assumed · Q15 open">
    <nav>
      <div>R1 · UI surface ✓</div><div>R2 · Transport ✓</div><div>R8 · Page visual direction ↺</div><div class="cur">R9 · Where does Finish save…</div><div>R9 · Should the visual run…</div>
    </nav>
    <main>
      <div class="card" data-q="q5">
        <h2>Where does Finish save the visual?</h2>
        <div class="opt rec">A · Copy it next to the doc as docs/&lt;slug&gt;-visual.html</div>
        <div class="opt">B · Leave it in the session folder</div>
        <div class="opt">C · Inline a screenshot</div>
      </div>
    </main>
  </div>
  <footer data-q="q9"><span class="doc">→ docs/design.md · Terms · Locked · Routine</span><button>Finish grill</button><button class="primary">Send to Agent</button></footer>
  <div class="term" data-q="q6">● grill-with-ui: round 9 posted · 7 open · waiting on the page</div>
<script>
/* grilling-ui linkage: copy verbatim */
(() => {
  const P = window.parent;
  const st = document.createElement("style");
  st.textContent = ".grill-hl{outline:2px solid #8a5a12;outline-offset:2px}";
  document.head.appendChild(st);
  addEventListener("message", (e) => {
    if (e.source !== P || !e.data || !Array.isArray(e.data.highlight)) return;
    const ids = e.data.highlight.filter((x) => /^q\\d+$/.test(x));
    document.querySelectorAll("[data-q]").forEach((el) => el.classList.toggle("grill-hl", ids.includes(el.dataset.q)));
  });
  addEventListener("click", (e) => { const r = e.target.closest("[data-q]"); if (r) P.postMessage({ clicked: r.dataset.q }, "*"); });
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); P.postMessage({ key: "send" }, "*"); }
    else if (e.key === "Escape") P.postMessage({ key: "escape" }, "*");
  });
})();
<\/script>
</body>
</html>
`;
