// Block Breaker: forward-only writing for the stories site.
//
// The page never puts a story's text on screen. It shows the last few lines
// (to match voice), a recap from canon/<story>.json (so there is no need to
// reread), and an empty box. "Commit" appends the box to the story's Markdown
// through the GitHub API, the same way the site editor saves.
(function () {
  'use strict';

  var cfg = JSON.parse(document.getElementById('bb-config').textContent);
  var root = document.getElementById('bb');
  var API = 'https://api.github.com/repos/' + cfg.repo + '/contents/';
  var AIRLOCK_WORDS = 150;

  // ---------- small helpers ----------

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function storeJSON(k, v) {
    if (v === undefined) { try { return JSON.parse(store(k)); } catch (e) { return null; } }
    store(k, v === null ? null : JSON.stringify(v));
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids || []).forEach(function (c) {
      if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function countWords(md) {
    var t = md
      .replace(/<?data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+>?/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ');
    var m = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    return m ? m.length : 0;
  }
  function plural(n, w) { return n.toLocaleString() + ' ' + w + (n === 1 ? '' : 's'); }

  function toBase64(text) {
    var bytes = new TextEncoder().encode(text), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function fromBase64(b64) {
    var bin = atob(b64.replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- GitHub ----------

  // The site editor's token if this browser is signed in there, else one
  // pasted here.
  function getToken() {
    var own = store('sfm-breaker-token');
    if (own) return own;
    var user = storeJSON('sveltia-cms.user');
    return user && user.token ? user.token : null;
  }

  function gh(path, opts) {
    opts = opts || {};
    var url = API + path.split('/').map(encodeURIComponent).join('/');
    if (!opts.method) url += '?ref=' + encodeURIComponent(cfg.branch);
    return fetch(url, {
      method: opts.method || 'GET',
      cache: 'no-store', // GitHub lets browsers cache reads for a minute; a stale sha fails the next save
      headers: {
        'Authorization': 'Bearer ' + getToken(),
        'Accept': opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401) { var e = new Error('GitHub rejected the token.'); e.auth = true; throw e; }
      return r;
    });
  }
  function fail(r, what) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      var e = new Error(what + ' failed (' + r.status + (j.message ? ': ' + j.message : '') + ').');
      e.status = r.status;
      throw e;
    });
  }
  // -> { text, sha } or null when the file doesn't exist.
  function readFile(path) {
    return gh(path).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return fail(r, 'Reading ' + path);
      return r.json().then(function (j) {
        if (j.encoding === 'base64' && (j.content || !j.size)) return { text: fromBase64(j.content), sha: j.sha };
        // Over 1 MB GitHub leaves the content out; fetch it raw.
        return gh(path, { raw: true }).then(function (r2) {
          if (!r2.ok) return fail(r2, 'Reading ' + path);
          return r2.text().then(function (t) { return { text: t, sha: j.sha }; });
        });
      });
    });
  }
  function writeFile(path, text, sha, message) {
    var body = { message: message, content: toBase64(text), branch: cfg.branch };
    if (sha) body.sha = sha;
    return gh(path, { method: 'PUT', body: body }).then(function (r) {
      if (!r.ok) return fail(r, 'Saving ' + path);
      return r.json().then(function (j) { return j.content.sha; });
    });
  }

  // ---------- story text ----------

  // A Google Docs export keeps its images as "[image1]: <data:...>" lines at
  // the very end. New writing goes before them, not after.
  function splitRefs(text) {
    var lines = text.replace(/\s+$/, '').split('\n'), i = lines.length;
    while (i > 0 && (/^\[[^\]]+\]:\s/.test(lines[i - 1]) || !lines[i - 1].trim())) i--;
    var refs = lines.slice(i).join('\n').trim();
    return { body: lines.slice(0, i).join('\n').replace(/\s+$/, ''), refs: refs };
  }
  function appendChunk(text, chunk) {
    var p = splitRefs(text);
    return (p.body ? p.body + '\n\n' : '') + chunk.trim() + '\n' + (p.refs ? '\n' + p.refs + '\n' : '');
  }
  // The last ~150 words, whole paragraphs where possible.
  function airlockOf(text) {
    var paras = splitRefs(text).body.split(/\n\s*\n/).map(function (p) {
      return p.replace(/^#+\s*/, '').replace(/\\([\\`*_{}\[\]()#+\-.!~>])/g, '$1').replace(/\s+/g, ' ').trim();
    }).filter(function (p) { return /[\p{L}\p{N}]/u.test(p) && !/^---+$/.test(p); });
    var out = [], n = 0;
    while (paras.length && n < AIRLOCK_WORDS) {
      var p = paras.pop(), w = p.split(' ');
      if (n + w.length > AIRLOCK_WORDS * 1.5) {
        var keep = Math.max(AIRLOCK_WORDS - n, 40);
        if (w.length > keep) p = '… ' + w.slice(-keep).join(' ');
      }
      out.unshift(p);
      n += p.split(' ').length;
    }
    return out;
  }

  // ---------- views ----------

  function show(nodes) { root.replaceChildren.apply(root, [].concat(nodes)); }

  function tokenView(message, then) {
    var input = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'GitHub access token' });
    show(el('form', { class: 'bb-card', onsubmit: function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      store('sfm-breaker-token', input.value.trim());
      then();
    } }, [
      el('h1', { text: 'Block Breaker' }),
      el('p', { text: message || 'This browser isn’t signed in to the site editor. Paste the same GitHub access token here (fine-grained, Contents: read and write on this repository). It stays in this browser.' }),
      input,
      el('button', { type: 'submit', class: 'bb-primary', text: 'Continue' }),
      el('p', { class: 'bb-muted' }, ['Or sign in at the ', el('a', { href: cfg.admin, text: 'site editor' }), ' and come back.'])
    ]));
    input.focus();
  }

  function pickerView() {
    var draftsFor = function (s) { return (store('sfm-bb-draft:' + s.path) || '').trim(); };
    show([
      el('h1', { text: 'Block Breaker' }),
      el('p', { class: 'bb-muted', text: 'Pick a story and write what happens next. You won’t see the text, only where it stopped.' }),
      el('ul', { class: 'bb-pick' }, cfg.stories.map(function (s) {
        var d = draftsFor(s);
        return el('li', {}, [
          el('a', { href: '?story=' + encodeURIComponent(s.path) }, [
            el('strong', { text: s.title || s.path }),
            el('span', { class: 'bb-muted', text: (s.series ? s.series + ' · ' : '') + plural(s.words, 'word') +
              (d ? ' · unsent draft, ' + plural(countWords(d), 'word') : '') })
          ])
        ]);
      })),
      el('p', { class: 'bb-muted' }, [el('a', { href: cfg.admin + '#/collections/stories/new', text: '+ Start a new story' }), ' in the site editor, then continue it here.'])
    ]);
  }

  function writerView(story) {
    var base = story.path.replace(/^.*\//, '').replace(/\.md$/, '');
    var canonPath = 'canon/' + base + '.json', notesPath = 'canon/' + base + '.notes.json';
    var draftKey = 'sfm-bb-draft:' + story.path, notesKey = 'sfm-bb-notes:' + story.path;
    var file = null, canon = null, notesSha = null;
    var notes = { pinned: [], fix_later: [] }, notesDirty = false;
    var session = { chunks: 0, words: 0 };
    try { session = JSON.parse(sessionStorage.getItem('sfm-bb-session:' + story.path)) || session; } catch (e) {}

    var status = el('p', { class: 'bb-status', role: 'status' });
    var airlock = el('div', { class: 'bb-airlock-text' });
    var area = el('textarea', { class: 'bb-area', placeholder: 'What happens next?', spellcheck: 'true', 'aria-label': 'New writing' });
    var count = el('span', { class: 'bb-muted' });
    var commitBtn = el('button', { type: 'button', class: 'bb-primary', text: 'Commit & append', onclick: commit });
    var discardBtn = el('button', { type: 'button', class: 'bb-quiet', text: 'Discard', onclick: function () {
      if (area.value.trim() && confirm('Throw away what’s in the box?')) { area.value = ''; onInput(); }
    } });
    var rail = el('aside', { class: 'bb-rail' });

    area.value = store(draftKey) || '';
    area.addEventListener('input', onInput);
    area.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
    });

    function onInput() {
      store(draftKey, area.value || null);
      var n = countWords(area.value);
      count.textContent = plural(n, 'word') + (session.chunks ? ' · this sitting: ' + plural(session.chunks, 'chunk') + ', ' + plural(session.words, 'word') : '');
      commitBtn.disabled = !n || !file;
      area.style.height = 'auto';
      area.style.height = Math.max(area.scrollHeight + 2, 320) + 'px';
    }
    function say(msg, kind) { status.textContent = msg; status.dataset.kind = kind || ''; }
    function drawAirlock() {
      airlock.replaceChildren.apply(airlock, airlockOf(file.text).map(function (p) { return el('p', { text: p }); }));
    }

    function commit() {
      var chunk = area.value.trim();
      if (!chunk || !file || commitBtn.disabled) return;
      commitBtn.disabled = true;
      say('Saving…');
      var words = countWords(chunk);
      // Re-read first: the story may have changed elsewhere since this page loaded.
      readFile(story.path).then(function (fresh) {
        if (!fresh) throw new Error('The story file has gone: ' + story.path);
        var text = appendChunk(fresh.text, chunk);
        return writeFile(story.path, text, fresh.sha,
          'Append ' + words + ' words to “' + (story.title || base) + '” (Block Breaker)').then(function (sha) {
          file = { text: text, sha: sha };
        });
      }).then(function () {
        area.value = '';
        session.chunks++; session.words += words;
        try { sessionStorage.setItem('sfm-bb-session:' + story.path, JSON.stringify(session)); } catch (e) {}
        drawAirlock(); onInput(); drawRail();
        say('Committed ' + plural(words, 'word') + '. The story is now ' + plural(countWords(file.text), 'word') + '. Keep going.', 'ok');
        area.focus();
        return notesDirty ? saveNotes(true) : null;
      }).catch(function (e) {
        if (e.auth) return tokenView('GitHub rejected the token. Paste a current one; your draft is safe in this browser.', start);
        say(e.message + ' Your draft is still in the box.', 'error');
        onInput();
      });
    }

    // ----- notes (pinned facts, fix later): yours, kept beside the recap -----

    function touchNotes() {
      notesDirty = true;
      storeJSON(notesKey, notes);
      drawRail();
    }
    function saveNotes(quiet) {
      return readFile(notesPath).then(function (remote) {
        return writeFile(notesPath, JSON.stringify(notes, null, 2) + '\n', remote && remote.sha,
          'Notes for “' + (story.title || base) + '” (Block Breaker)');
      }).then(function (sha) {
        notesSha = sha; notesDirty = false; storeJSON(notesKey, null);
        drawRail();
        if (!quiet) say('Notes saved.', 'ok');
      }).catch(function (e) { say('Notes not saved yet (' + e.message + ') They’re kept in this browser.', 'error'); });
    }
    function noteList(key, label, hint, placeholder, open) {
      var input = el('input', { type: 'text', placeholder: placeholder, 'aria-label': label });
      return section(key, label + (notes[key].length ? ' (' + notes[key].length + ')' : ''), [
        el('p', { class: 'bb-muted', text: hint }),
        el('ul', { class: 'bb-notes' }, notes[key].map(function (t, i) {
          return el('li', {}, [el('span', { text: t }),
            el('button', { type: 'button', class: 'bb-x', title: 'Remove', 'aria-label': 'Remove', text: '×', onclick: function () {
              notes[key].splice(i, 1); touchNotes();
            } })]);
        })),
        el('form', { class: 'bb-add', onsubmit: function (e) {
          e.preventDefault();
          if (!input.value.trim()) return;
          notes[key].push(input.value.trim());
          store('sfm-bb-open:' + key, '1');
          touchNotes();
          var again = rail.querySelector('[data-key="' + key + '"] input'); if (again) again.focus();
        } }, [input, el('button', { type: 'submit', text: 'Add' })])
      ], open);
    }

    // ----- the rail -----

    function section(key, title, kids, openByDefault) {
      var saved = store('sfm-bb-open:' + key);
      var d = el('details', { 'data-key': key, open: saved === null ? !!openByDefault : saved === '1' }, [el('summary', { text: title })].concat(kids));
      d.addEventListener('toggle', function () { store('sfm-bb-open:' + key, d.open ? '1' : '0'); });
      return d;
    }
    function list(items, render) { return el('ul', {}, (items || []).map(render)); }
    function pair(name, note) { return el('li', {}, [el('strong', { text: name }), note ? ' — ' + note : '']); }

    function drawRail() {
      var kids = [];
      if (canon) {
        var behind = file && canon.source_sha !== file.sha ? Math.max(countWords(file.text) - (canon.source_words || 0), 0) : 0;
        kids.push(el('div', { class: 'bb-where' }, [
          el('h2', { text: 'Where we are' }),
          el('p', { text: canon.where_we_are || '' })
        ]));
        if (file && canon.source_sha !== file.sha) {
          kids.push(el('p', { class: 'bb-muted bb-stale' }, [
            'Recap is ' + (behind ? plural(behind, 'word') : 'a little') + ' behind the story; a new one follows each commit by a minute or two. ',
            el('button', { type: 'button', class: 'bb-link', text: 'Check again', onclick: loadCanon })
          ]));
        }
        kids.push(section('loops', 'Open loops (' + (canon.open_loops || []).length + ')', list(canon.open_loops, function (l) {
          return el('li', {}, [el('strong', { text: l.thread }), el('span', { class: 'bb-kind', text: l.kind }), el('br'), l.detail]);
        }), true));
        kids.push(section('sofar', 'Story so far', (canon.story_so_far || []).map(function (s) {
          return el('div', {}, [el('h3', { text: s.section }), list(s.events, function (e) { return el('li', { text: e }); })]);
        })));
        kids.push(section('people', 'People', list(canon.characters, function (c) {
          return el('li', {}, [el('strong', { text: c.name }), ' — ' + c.who, el('br'), el('span', { class: 'bb-muted', text: 'Now: ' + c.state })]);
        })));
        kids.push(section('things', 'Places & things', list(canon.things_and_places, function (t) { return pair(t.name, t.note); })));
        kids.push(section('details', 'Details', list(canon.details, function (d) { return el('li', { text: d }); })));
      } else {
        kids.push(el('div', { class: 'bb-where' }, [
          el('h2', { text: 'No recap yet' }),
          el('p', { class: 'bb-muted' }, ['One is written a minute or two after the first commit to this story, once the recap workflow has its API key (see the README). ',
            el('button', { type: 'button', class: 'bb-link', text: 'Check again', onclick: loadCanon })])
        ]));
      }
      kids.push(noteList('fix_later', 'Fix later', 'Spotted something to fix? Park it here and keep writing.', 'e.g. Ch 3: the hangar scene drags', true));
      kids.push(noteList('pinned', 'Pinned facts', 'Things you’ve decided and must not lose.', 'e.g. The relay loses power at nightfall'));
      if (notesDirty) kids.push(el('p', { class: 'bb-muted' }, ['Notes go up with your next commit. ',
        el('button', { type: 'button', class: 'bb-link', text: 'Save them now', onclick: function () { saveNotes(false); } })]));
      rail.replaceChildren.apply(rail, kids);
    }

    function loadCanon() {
      return readFile(canonPath).then(function (c) {
        try { canon = c ? JSON.parse(c.text) : null; } catch (e) { canon = null; }
        drawRail();
      });
    }

    // ----- layout -----

    var airlockBox = section('airlock', 'Last lines', [airlock], true);
    airlockBox.classList.add('bb-airlock');
    show([
      el('header', { class: 'bb-head' }, [
        el('h1', { text: story.title || base }),
        el('p', { class: 'bb-muted' }, [el('a', { href: '?', text: '← Other stories' })])
      ]),
      el('div', { class: 'bb-grid' }, [
        el('section', { class: 'bb-canvas' }, [
          airlockBox, area,
          el('div', { class: 'bb-bar' }, [count, el('span', { class: 'bb-spacer' }), discardBtn, commitBtn]),
          status
        ]),
        rail
      ])
    ]);
    onInput();
    say('Loading…');

    Promise.all([readFile(story.path), readFile(notesPath), loadCanon()]).then(function (r) {
      if (!r[0]) throw new Error('Can’t find ' + story.path + ' in the repository.');
      file = r[0];
      var local = storeJSON(notesKey), remote = null;
      try { remote = r[1] ? JSON.parse(r[1].text) : null; } catch (e) {}
      notesSha = r[1] && r[1].sha;
      if (local) { notes = local; notesDirty = true; } else if (remote) notes = remote;
      notes.pinned = notes.pinned || []; notes.fix_later = notes.fix_later || [];
      drawAirlock(); drawRail(); onInput();
      say(area.value.trim() ? 'Picked up your unsent draft.' : '');
      area.focus();
    }).catch(function (e) {
      if (e.auth) return tokenView('GitHub rejected the token. Paste a current one.', start);
      say(e.message, 'error');
    });
  }

  function start() {
    if (!getToken()) return tokenView('', start);
    var path = new URLSearchParams(location.search).get('story');
    if (!path) return pickerView();
    var story = cfg.stories.filter(function (s) { return s.path === path; })[0];
    // A story newer than the last site build isn't in the list yet; it can still be continued.
    if (!story && /^content\/.+\.md$/.test(path) && path.indexOf('..') < 0) story = { path: path, title: '' };
    if (!story) return pickerView();
    writerView(story);
  }
  start();
})();
