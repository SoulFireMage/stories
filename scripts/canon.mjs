// Writes canon/<story>.json: a recap of a story for the Block Breaker page
// (where we are, open loops, story so far, people, details), so the next part
// can be written without rereading the text.
//
// The recap is rebuilt from the whole story every time rather than patched,
// so mistakes can't accumulate from one run to the next.
//
//   node scripts/canon.mjs "content/stories/kazia.md" ...   named stories
//   node scripts/canon.mjs --all                             every story
//   add --force to rebuild a recap that is already up to date
//
// Needs ANTHROPIC_API_KEY. CANON_MODEL picks the model (default below).
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const MODEL = process.env.CANON_MODEL || 'claude-opus-5-5';
const STORY_DIR = 'content/stories';
const MIN_WORDS = 200;

const SYSTEM = `You keep the continuity notes for a novelist's work in progress.

The author gets stuck in a loop: to remind themselves what happened they reread the story, start noticing things to fix, and edit old chapters instead of writing new ones. Your notes replace that reread. They are shown beside an empty page where the author writes the next part, and the author will not look at the text itself. So the notes have to carry everything needed to carry on from the last line: what has happened, where everyone is, and what is still unresolved.

The story belongs entirely to the author, who writes it without AI help. Record only what is on the page. Do not suggest what could happen next, do not comment on the quality of the writing, and do not point out mistakes or inconsistencies; if the text contradicts itself, go with the later version. Write plainly and neutrally in your own words, in British English, rather than echoing the prose: flat notes give the author nothing to polish. Keep names, invented terms and spellings exactly as the author has them.

The text may hold several books or parts, a table of contents, and unfinished fragments. The end of the text is where the author will continue, so recent events deserve more detail than early ones.

What goes in each field:
- where_we_are: two to four sentences on the situation at the very end of the text. Who is present, where, what they are in the middle of, and what was about to happen.
- open_loops: every thread the story has raised and not yet resolved, most pressing first. Unanswered questions, dangers still hanging, promises and plans not yet carried out, relationships left in tension, things set up for the reader that have not paid off. "thread" is a short name; "detail" says what is unresolved and where it was left.
- story_so_far: the events in order, grouped by the story's own books or chapters where it has them, otherwise by natural stretches. One short line per event that matters to what follows.
- characters: everyone who may matter again. "who" is their identity and role; "state" is where they are, their condition, and what they know or want as of the end of the text.
- things_and_places: ships, places, objects, technology, factions and rules of the world that the author would need to stay consistent with.
- details: small concrete facts that are easy to forget and awkward to get wrong, such as ages, numbers, colours, distances, dates, names of minor things, and who knows which secret.`;

const str = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SCHEMA = obj({
  where_we_are: str,
  open_loops: { type: 'array', items: obj({
    thread: str,
    kind: { type: 'string', enum: ['plot', 'danger', 'mystery', 'promise', 'relationship', 'practical'] },
    detail: str,
  }) },
  story_so_far: { type: 'array', items: obj({ section: str, events: { type: 'array', items: str } }) },
  characters: { type: 'array', items: obj({ name: str, who: str, state: str }) },
  things_and_places: { type: 'array', items: obj({ name: str, note: str }) },
  details: { type: 'array', items: str },
});

// Images pasted in from Google Docs are megabytes of base64; they are not story.
const stripImages = (md) => md.replace(/<?data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+>?/g, '');

// Same count as the Block Breaker page, so "N words behind" lines up.
function countWords(md) {
  const t = stripImages(md)
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ');
  return (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

async function recap(client, story) {
  // Streamed, because a long story with a long answer can outlast a plain request.
  const params = {
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Here is the story so far.\n\n<story>\n${story}\n</story>\n\nWrite the continuity notes.` }],
  };
  // If a safety filter declines the story, let the API retry on another model
  // instead of leaving the author without a recap. Haiku has no such fallback.
  const betas = [];
  if (!MODEL.includes('haiku')) {
    betas.push('server-side-fallback-2026-07-01');
    params.fallbacks = 'default';
  }
  const message = await client.beta.messages.stream({ ...params, betas }).finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('the model declined to read this story');
  if (message.stop_reason === 'max_tokens') throw new Error('the recap was cut off before it finished');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { notes: JSON.parse(text), model: message.model, usage: message.usage };
}

const args = process.argv.slice(2);
const force = args.includes('--force');
let files = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all')) {
  files = readdirSync(STORY_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_')).map((f) => join(STORY_DIR, f));
}
if (!files.length) {
  console.log('No stories to recap.');
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('::warning::ANTHROPIC_API_KEY is not set, so no recap was written. Add it under Settings → Secrets and variables → Actions.');
  process.exit(0);
}

const client = new Anthropic();
mkdirSync('canon', { recursive: true });
let failed = 0;

for (const file of files) {
  if (!existsSync(file)) { console.log(`${file}: gone, skipped.`); continue; }
  const raw = readFileSync(file, 'utf8');
  const sha = execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim();
  const words = countWords(raw);
  const out = join('canon', basename(file, '.md') + '.json');

  if (words < MIN_WORDS) { console.log(`${file}: only ${words} words, skipped.`); continue; }
  if (!force && existsSync(out)) {
    try {
      if (JSON.parse(readFileSync(out, 'utf8')).source_sha === sha) { console.log(`${file}: recap already up to date.`); continue; }
    } catch { /* unreadable recap: rebuild it */ }
  }

  try {
    const { notes, model, usage } = await recap(client, stripImages(raw));
    const canon = {
      version: 1,
      story: file,
      generated_at: new Date().toISOString(),
      model,
      source_sha: sha,
      source_words: words,
      ...notes,
    };
    writeFileSync(out, JSON.stringify(canon, null, 2) + '\n');
    console.log(`${file}: recap written (${words} words read; ${usage.input_tokens} tokens in, ${usage.output_tokens} out).`);
  } catch (err) {
    failed++;
    if (err instanceof Anthropic.AuthenticationError) console.log(`::error::${file}: the API key was rejected.`);
    else if (err instanceof Anthropic.RateLimitError) console.log(`::error::${file}: rate limited; run the workflow again later.`);
    else if (err instanceof Anthropic.APIError) console.log(`::error::${file}: API error ${err.status}: ${err.message}`);
    else console.log(`::error::${file}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
