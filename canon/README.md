# Recaps for Block Breaker

One pair of files per story, named after the story's Markdown file:

- `<story>.json`: the recap (where we are, open loops, story so far, people,
  details). Written by `.github/workflows/canon.yml` after each push that
  changes the story. Regenerated from the whole text every time, so don't edit
  it by hand; it will be overwritten.
- `<story>.notes.json`: yours. Pinned facts and the "fix later" list, saved by
  the Block Breaker page. Never touched by the workflow.

Nothing here is published on the site.
