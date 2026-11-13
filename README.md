# Stories

Fiction by Richard Griffiths, published at **https://starship-whisperer.com/stories/**.

A small [Hugo](https://gohugo.io/) site. Every push to `main` rebuilds it through
`.github/workflows/hugo.yml` (usually live in 1–2 minutes).

## Adding stories

Put each story in `content/stories/` as a Markdown file and push.

From Google Docs: **File → Download → Markdown (.md)**. The file works as it is:

- With no front matter, the title is made from the file name
  (`the-long-fold.md` → "The Long Fold"). If the document starts with its own
  `# Title` heading, that heading is used and is not shown twice.
- Prefer file names without spaces (`the-long-fold.md`); the file name becomes
  the web address (`/stories/the-long-fold/`).
- Google Docs embeds images as base64 text at the end of the file. That works
  but makes the file large; for image-heavy stories, upload the images through
  the editor instead.

Optional front matter, all of which can be set in the editor:

```yaml
---
title: Starship Whisperer I
series: Aktarian Tales   # stories sharing a series are grouped on the index
weight: 1                # order within the series (lowest first)
description: Where it begins.
draft: true              # still published, marked "work in progress"
---
```

## The index page

The home page is `content/_index.md`: its text is shown above the list of
stories, and the list itself updates on its own from whatever is in `content/`.

## Editing in the browser

Same setup as the main site.

**Site editor:** https://starship-whisperer.com/stories/admin/ runs
[Sveltia CMS](https://sveltiacms.app/en/docs), which edits the Markdown here through
the GitHub API. Sign in with **Sign In Using Access Token** and a fine-grained
GitHub token with **Contents: Read and write** on this repository. The easiest
route is to edit the token you already use for the main site and add
`stories` to its repositories. Ignore **Sign In with GitHub**; it needs an
OAuth relay server, which this site doesn't run.

The live word count from the main site's editor is here too.

**Edit buttons:** once this browser has opened an `/admin/` page (here or on the
main site), every page shows a button bar at the bottom left:

- **✎ Edit here**: opens the story, or the index text, in the site editor.
- **GitHub**: opens the page's Markdown in GitHub's own editor (your normal login).
- **▶ Continue**: opens the story in Block Breaker (below).
- **+ New story**: opens a blank story in the site editor.

Visitors never see it. Add `?edit=on` or `?edit=off` to any page URL to toggle it.

## Block Breaker: writing forward without rereading

https://starship-whisperer.com/stories/breaker/ (or **▶ Continue** in the edit
buttons on any story) is for getting on with a story instead of re-editing it.
It never shows the story's text. You get:

- **Last lines**: the final ~150 words, read-only, to match the voice.
- **An empty box**. **Commit & append** (or Ctrl/⌘+Enter) adds what you wrote to
  the end of the story's Markdown as a commit to `main`, then empties the box.
  The box is saved in the browser as you type, so a closed tab loses nothing.
- **A recap** in place of rereading: where we are, open loops, story so far,
  people, places and things, details.
- **Fix later**: when you spot something wrong, note it here and keep going.
  **Pinned facts** are for decisions that mustn't get lost. Both are saved to
  `canon/<story>.notes.json` with your next commit.

It uses the site editor's sign-in. In a browser that hasn't signed in there, it
asks for the same access token once.

**The recap** is written by `.github/workflows/canon.yml`, which runs
`scripts/canon.mjs` after every push that changes a story and commits
`canon/<story>.json` a minute or two later. It reads the whole story each time
and only records what is on the page; it suggests nothing and writes no prose.
To switch it on:

1. Create an API key at https://platform.claude.com/ and add it to this
   repository as a secret named `ANTHROPIC_API_KEY`
   (Settings → Secrets and variables → Actions).
2. Run **Update story recaps** once from the Actions tab to write a recap for
   every story.

Without the key everything else still works; the recap panel just stays empty.
The model is `claude-opus-5-5` unless a repository variable `CANON_MODEL` says
otherwise (`claude-sonnet-5-5` or `claude-haiku-5-5` cost less per run).

Code: `layouts/_default/breaker.html`, `assets/js/breaker.js`, and the
"Block Breaker" block at the end of `assets/css/main.css`.

## Reading controls

Every story has **A−/A+** (text size, 14–28px) and a **width slider** under its title,
borrowed from openlogz: it runs from a narrow column to the full screen on a log
scale, measured in characters so bigger text keeps the same words per line.
**Reset** restores the defaults. Once you scroll past them, the same controls sit behind a floating **Aa** button at the bottom right. Choices are remembered per browser. On phones only
the size buttons show. Code: `layouts/partials/reader-controls.html` and the
`sfmReader` script in `layouts/_default/baseof.html`.

## Layout

- `layouts/`: page templates (`index.html` is the story index).
- `layouts/partials/edit-bar.html`: the edit buttons.
- `assets/css/main.css`: colours and type. Light and dark palettes are the
  variables at the top.
- `static/admin/`: the editor and its config.

To preview locally: `hugo server`, then open http://localhost:1313/stories/.
