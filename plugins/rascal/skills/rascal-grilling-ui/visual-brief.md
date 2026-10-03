# Visual brief

You are drawing the **visual** for a grilling-ui design interview: one HTML file showing
the design as it stands. The interviewer (the agent that launched you) has told you the
session folder, the kind (prototype or diagram), the project root, and what changed. This
file holds the rules; follow every one.

## What you read

- `<session>/state.json`: `topic`, `terms` (use these words in labels), `questions`. Each
  question has `status`, `options`, `rec` (the recommendation), `answer` when answered,
  `thread`, and sometimes `explore`. `visual.thread` holds the user's feedback on earlier
  versions, newest last.
- `<session>/visual.html` when it exists (a redraw): edit it. Keep layout, names, and
  everything the change list does not mention stable, so the user can see what moved.
- The project root when the visual should match real UI or code (a prototype of a page that
  exists, a diagram of modules that exist): look first, then draw what is there plus the
  design. The interviewer's brief says whether the topic is a change to an existing app and
  where it lands (a route, page, or component).

## Source of truth

The questions are the source of truth; the visual is derived from them.

- **Answered** question: draw the decision, plain.
- **Open, reopened, or deferred** question: draw its recommended option and mark that region
  **assumed · Qn open** (dashed outline, or a small tag in the corner), so the visual reads
  as a map of what is settled and what is not.
- Never draw something the questions contradict, even if feedback asks for it. The
  interviewer handles that by reopening the question; you draw what the change list says.

## The file

`<session>/visual.html`, **one self-contained file**: inline CSS and JS, system fonts, no
network requests, no external assets. The page shows it in an iframe with
`sandbox="allow-scripts"` and no same-origin access, so a fetch, a CDN font, or an image
URL fails silently. Before you finish, run `grep -n '://' <session>/visual.html`; the only
allowed hit is the Mermaid script tag described below.

Start the file with an HTML comment: the topic, the questions it reflects (id and one
phrase each), which regions are assumed, and for a redraw what this version changed.

**Prototype** (kind = prototype): a working page, not a picture of one. Real layout, real
controls; the clicks, toggles, and states the design has; plausible fake data for the topic.

- **A change to an existing app** (an improvement or a new feature): the prototype shows
  what the user will actually see in the app, in place. Reproduce the real page it lands on,
  with the app's own chrome around it (navigation, header, sidebar, footer, neighbouring
  content), and the app's own look: read its stylesheets, design tokens, and the components
  the page uses; copy the colours, type scale, spacing, radii, borders, and control styles
  rather than approximating them. Existing parts are drawn as they are today; the new or
  changed parts are drawn as designed, so the two can be judged together. A screenshot-like
  fidelity is the goal: someone who uses the app should not be able to tell from the frame
  that it is a prototype. If the app loads a web font, use its nearest system fallback and
  say so in the header comment (the frame has no network).
- **A new UI** with nothing to match: the fidelity of a good wireframe. Neutral palette,
  clear hierarchy, no decoration the design did not decide.

**Diagram** (kind = diagram): inline SVG, or HTML boxes with an SVG arrow layer, with a
legend; architecture, data flow, sequence, or state, whichever fits the topic. Label the
edges. Past roughly fifteen nodes hand layout stops working; then you may embed Mermaid from
a CDN inside the file, with a one-line note in the file that it needs network.

## Linking regions to questions

The page links the visual to the questions: hovering a question outlines its regions, clicking a
region selects its question, and ⌘↵ / Esc pressed inside the visual reach the page. This only
works when the file carries the tags and the listener below; without them linking silently does
nothing.

- Every region that a question decides gets `data-q="qN"` (the question's id, lower case):
  the element that shows the decision, or the box drawn as **assumed · Qn open**. A region
  that several questions decide takes the one that decides most of it; put the others on its
  children.
- Include this listener **verbatim**, as the last thing before `</body>`. Do not edit it, and
  do not add another message or keydown handler of your own.

```html
<script>
/* grilling-ui linkage: copy verbatim */
(() => {
  const P = window.parent;
  const st = document.createElement("style");
  st.textContent = ".grill-hl{outline:2px solid #8a5a12;outline-offset:2px}";
  document.head.appendChild(st);
  addEventListener("message", (e) => {
    if (e.source !== P || !e.data || !Array.isArray(e.data.highlight)) return;
    const ids = e.data.highlight.filter((x) => /^q\d+$/.test(x));
    document.querySelectorAll("[data-q]").forEach((el) => el.classList.toggle("grill-hl", ids.includes(el.dataset.q)));
  });
  addEventListener("click", (e) => { const r = e.target.closest("[data-q]"); if (r) P.postMessage({ clicked: r.dataset.q }, "*"); });
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); P.postMessage({ key: "send" }, "*"); }
    else if (e.key === "Escape") P.postMessage({ key: "escape" }, "*");
  });
})();
</script>
```

Before you finish, run `grep -n 'data-q' <session>/visual.html`: it must return at least one
hit for every answered question the visual depicts, and the listener must be present
(`grep -c 'grilling-ui linkage: copy verbatim' <session>/visual.html` prints 1).

## Reply

Do not paste the file back. Reply with ONE line: what the visual now shows, or for a redraw
what changed, naming question ids ("v3: discussion panel on the right per Q3, sidebar
collapsible per feedback"). The interviewer copies it into the version note.
