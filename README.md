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
- **+ New story**: opens a blank story in the site editor.

Visitors never see it. Add `?edit=on` or `?edit=off` to any page URL to toggle it.

## Reading controls

Every story has **A−/A+** (text size, 14–28px) and a **width slider** under its title,
borrowed from openlogz: it runs from a narrow column to the full screen on a log
scale, measured in characters so bigger text keeps the same words per line.
**Reset** restores the defaults. Choices are remembered per browser. On phones only
the size buttons show. Code: `layouts/partials/reader-controls.html` and the
`sfmReader` script in `layouts/_default/baseof.html`.

## Layout

- `layouts/`: page templates (`index.html` is the story index).
- `layouts/partials/edit-bar.html`: the edit buttons.
- `assets/css/main.css`: colours and type. Light and dark palettes are the
  variables at the top.
- `static/admin/`: the editor and its config.

To preview locally: `hugo server`, then open http://localhost:1313/stories/.
