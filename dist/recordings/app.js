import {Microphone} from '../microphone.js?v=20';
import {ACCENTS, PROMPTS, MAX_TAKE_SECONDS, coverage, makeTake, takesFor} from './data.js?v=20';
import {RecordingStore} from './store.js?v=20';
import {StudyRecorder} from './recorder.js?v=20';
import {makeArchive, takeFilename} from './archive.js?v=20';

const $ = id => document.getElementById(id), store = new RecordingStore();
const microphone = new Microphone(), rows = new Map(), selected = new Map(), urls = new Map();
const micIcon = '<svg viewBox="0 0 24 28" aria-hidden="true"><rect x="8" y="2" width="8" height="15" rx="4"/><path d="M5 12v2a7 7 0 0 0 14 0v-2M12 21v5m-4 0h8"/></svg>';
const stopIcon = '<svg viewBox="0 0 24 28" aria-hidden="true"><rect x="6" y="8" width="12" height="12" rx="1" fill="currentColor" stroke="none"/></svg>';
const cancelIcon = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="m6 8 12 12M18 8 6 20"/></svg>';
const uploadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg>';
let persistenceRequested = false;
let accent = 'british', takes = [], loading = true, importing = false, exporting = false, archiveURL = null;
const environment = () => ({userAgent: navigator.userAgent, language: navigator.language});
const message = text => { $('set-status').textContent = text; };
const seconds = n => `${Math.max(0, n).toFixed(1)} s`;
const recorder = new StudyRecorder(microphone, {
  onChange: render, onTake: saveTake, environment,
  onError: error => message(error.name === 'NotAllowedError' ? 'Microphone access was not allowed. Your saved takes are unchanged.' : error.name === 'NotFoundError' ? 'No microphone found. You can use the upload icon for an existing recording.' : error.message || 'The microphone could not start. Your saved takes are unchanged.'),
});

function invalidateArchive() {
  if (archiveURL) URL.revokeObjectURL(archiveURL);
  archiveURL = null; $('archive-link').removeAttribute('href');
}

async function saveTake(take) {
  // Keep an unsaved draft available for replay/download even on quota failure.
  takes = takes.filter(t => t.id !== take.id).concat({...take, persisted: false});
  selected.set(take.accent + ':' + take.promptId, take.id); invalidateArchive(); render();
  try {
    const committed = await store.save(take);
    takes = takes.map(t => t.id === take.id ? committed : t);
    message('Take saved.');
    // Ask the browser to protect this origin from automatic storage eviction.
    if (!persistenceRequested) { persistenceRequested = true; navigator.storage?.persist?.().catch(() => {}); }
  } catch (error) {
    message(`${error.name === 'QuotaExceededError' ? 'Browser storage is full.' : error.message} This take is still available below. Download it or retry saving before closing this tab.`);
  }
  render();
}

for (const [i, prompt] of PROMPTS.entries()) {
  const row = document.createElement('section'); row.className = 'sentence-row';
  row.setAttribute('aria-label', `Sentence ${i + 1}`);
  row.innerHTML = `<span class="sentence-number">0${i + 1}</span><div class="sentence-body"><p class="sentence-text"></p><p class="sentence-hint" hidden></p><div class="take-details"><span class="take-status">Not recorded</span><select class="take-select" aria-label="Saved takes for sentence ${i + 1}" hidden></select><button class="retry-save" hidden>Retry saving</button><a class="draft-download" hidden>Download take</a></div><audio class="take-audio" controls preload="none" hidden aria-label="Replay sentence ${i + 1}"></audio></div><div class="take-actions"><button class="take-button record" aria-label="Record sentence ${i + 1}">${micIcon}</button><button class="take-button import" aria-label="Import recording for sentence ${i + 1}">${uploadIcon}</button><input type="file" accept="audio/*,.m4a,.wav" hidden aria-label="Audio file for sentence ${i + 1}"></div>`;
  row.querySelector('.sentence-text').textContent = prompt.text;
  if (prompt.hint) { row.querySelector('.sentence-hint').textContent = prompt.hint; row.querySelector('.sentence-hint').hidden = false; }
  const record = row.querySelector('.record');
  record.onclick = () => {
    const active = recorder.active;
    if (active?.promptId === prompt.id && active.accent === accent) {
      if (active.phase === 'starting') recorder.cancel();
      else recorder.stop();
    } else {
      stopPlayback(); message(''); recorder.start(accent, prompt.id);
    }
  };
  const input = row.querySelector('input');
  row.querySelector('.import').onclick = () => input.click();
  input.onchange = () => { const file = input.files[0]; input.value = ''; if (file) importTake(file, prompt.id); };
  row.querySelector('select').onchange = event => { selected.set(accent + ':' + prompt.id, event.target.value); render(); };
  row.querySelector('.retry-save').onclick = async () => {
    const take = currentTake(prompt.id); if (!take || importing || recorder.active) return;
    importing = true; render(); await saveTake(take); importing = false; render();
  };
  $('sentences').append(row); rows.set(prompt.id, row);
}

function currentTake(promptId) {
  const slot = takesFor(takes, accent, promptId), id = selected.get(accent + ':' + promptId);
  return slot.find(t => t.id === id) || slot.at(-1);
}

function stopPlayback() { for (const row of rows.values()) row.querySelector('audio').pause(); }

function render() {
  const active = recorder.active, busy = !!active || importing || exporting;
  $('total-progress').textContent = `${coverage(takes)} / 15 saved`;
  $('download-set').disabled = !takes.length || busy;
  $('download-set').textContent = exporting ? 'Building download…' : 'Download set';
  for (const button of $('accents').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.accent === accent)); button.disabled = busy;
    button.querySelector('span').textContent = `${coverage(takes, button.dataset.accent)} / 5`;
  }
  for (const [i, prompt] of PROMPTS.entries()) {
    const row = rows.get(prompt.id), isActive = active?.accent === accent && active.promptId === prompt.id;
    const record = row.querySelector('.record'), status = row.querySelector('.take-status'), take = currentTake(prompt.id);
    record.disabled = loading || importing || exporting || (!!active && (!isActive || ['saving', 'stopping'].includes(active.phase)));
    const label = isActive ? active.phase === 'starting' ? `Cancel microphone request for sentence ${i + 1}` : active.phase === 'recording' ? `Stop sentence ${i + 1} and save` : 'Saving take' : `Record${take ? ' another take for' : ''} sentence ${i + 1}`;
    record.setAttribute('aria-label', label); record.title = label;
    const shape = isActive && active.phase === 'starting' ? 'cancel' : isActive ? 'stop' : 'mic';
    if (record.dataset.shape !== shape) { record.innerHTML = shape === 'mic' ? micIcon : shape === 'cancel' ? cancelIcon : stopIcon; record.dataset.shape = shape; }
    record.classList.toggle('active', !!isActive);
    row.classList.toggle('is-recording', isActive && active.phase === 'recording');
    row.querySelector('.import').disabled = loading || busy;
    if (isActive) {
      status.textContent = active.phase === 'starting' ? 'Allow microphone access…' : active.phase === 'recording' ? `Recording · ${seconds((performance.now() - active.started) / 1000)} / 30 s` : 'Saving…';
    } else status.textContent = take ? `${take.persisted === false ? 'Not saved' : 'Saved'} · ${seconds(take.duration)}${take.interrupted ? ' · interrupted' : ''}${take.peak !== undefined && take.peak < .0001 ? ' · very quiet' : take.clipping > .004 ? ' · clipping' : ''}` : 'Not recorded';
    status.classList.toggle('saved', !!take && take.persisted !== false && !isActive);
    status.classList.toggle('unsaved', take?.persisted === false);
    const slot = takesFor(takes, accent, prompt.id), select = row.querySelector('select');
    const key = slot.map(t => t.id + ':' + t.persisted).join('|');
    if (select.dataset.key !== key) {
      select.replaceChildren(...slot.map((t, n) => {
        const option = document.createElement('option'); option.value = t.id;
        option.textContent = `Take ${n + 1} · ${seconds(t.duration)}${t.persisted === false ? ' · unsaved' : ''}`; return option;
      })); select.dataset.key = key;
    }
    select.hidden = slot.length < 2; select.disabled = busy; if (take) select.value = take.id;
    row.querySelector('.retry-save').hidden = take?.persisted !== false;
    row.querySelector('.retry-save').disabled = busy;
    const audio = row.querySelector('audio'), previous = urls.get(prompt.id), download = row.querySelector('.draft-download');
    if (take?.id !== previous?.id) {
      audio.pause(); audio.removeAttribute('src');
      if (previous) URL.revokeObjectURL(previous.url);
      if (take) {
        const url = URL.createObjectURL(take.blob); urls.set(prompt.id, {id: take.id, url}); audio.src = url;
      } else { urls.delete(prompt.id); audio.load(); }
    }
    audio.hidden = !take;
    download.hidden = take?.persisted !== false;
    if (take) { download.href = urls.get(prompt.id).url; download.download = takeFilename(take, Math.max(1, slot.findIndex(t => t.id === take.id) + 1)).split('/').at(-1); }
  }
}

for (const button of $('accents').querySelectorAll('button')) button.onclick = async () => {
  if (recorder.active || importing || exporting) return;
  stopPlayback(); accent = button.dataset.accent; message(''); render();
  await refresh();
};

async function refresh() {
  try {
    const saved = await store.list(), drafts = takes.filter(t => t.persisted === false && !saved.some(s => s.id === t.id));
    takes = saved.concat(drafts); invalidateArchive();
  } catch (error) { message(`${error.message || 'Browser storage is unavailable.'} You can still record and download a take.`); }
  loading = false; render();
}

async function importTake(file, promptId) {
  if (recorder.active || importing || exporting) return;
  importing = true; const intended = accent; stopPlayback(); render(); message('Opening recording…');
  let url;
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error('Choose a recording under 16 MB and 30 seconds.');
    const audio = new Audio(); url = URL.createObjectURL(file);
    const duration = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { audio.removeAttribute('src'); audio.load(); reject(new Error('This audio file could not be opened. Try WAV or M4A.')); }, 10000);
      audio.onloadedmetadata = () => { clearTimeout(timeout); resolve(audio.duration); };
      audio.onerror = () => { clearTimeout(timeout); reject(new Error('This audio format could not be opened. Try WAV or M4A.')); };
      audio.src = url;
    });
    audio.removeAttribute('src'); audio.load();
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_TAKE_SECONDS + .01) throw new Error('Choose a recording up to 30 seconds. Your saved takes are unchanged.');
    await saveTake(makeTake(intended, promptId, {blob: file, duration}, {source: 'file', originalName: file.name, ...environment()}));
  } catch (error) { message(error.message || 'This file could not be imported.'); }
  finally { if (url) URL.revokeObjectURL(url); importing = false; render(); }
}

$('download-set').onclick = async () => {
  if (!takes.length || recorder.active || importing || exporting) return;
  exporting = true; render(); stopPlayback();
  try {
    const blob = await makeArchive(takes);
    invalidateArchive(); archiveURL = URL.createObjectURL(blob);
    const link = $('archive-link'); link.href = archiveURL;
    link.download = `prosody-recordings-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
    message('Recording set downloaded. Original audio and its prompt details are included.');
  } catch (error) { message(error.message || 'The download could not be created. Your saved takes are unchanged.'); }
  finally { exporting = false; render(); }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPlayback();
    if (recorder.active?.phase === 'starting') recorder.cancel();
    else if (recorder.active?.phase === 'recording') recorder.stop(true);
  } else if (!recorder.active && !importing && !exporting) refresh();
});
window.addEventListener('beforeunload', event => {
  if (recorder.active || importing || exporting || takes.some(t => t.persisted === false)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => {
  microphone.release(); stopPlayback(); for (const value of urls.values()) URL.revokeObjectURL(value.url);
  urls.clear(); invalidateArchive();
});
window.addEventListener('pageshow', event => { if (event.persisted) { recorder.active = null; refresh(); } });
setInterval(() => {
  const active = recorder.active;
  if (active?.phase === 'recording') rows.get(active.promptId).querySelector('.take-status').textContent =
    `Recording · ${seconds((performance.now() - active.started) / 1000)} / 30 s`;
}, 100);
render(); refresh();
if (window.isSecureContext && window.AudioWorkletNode) Promise.resolve().then(() => microphone.prepare()).catch(() => {});
