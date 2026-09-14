(() => {
  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const text = $('sampleText');
  const cache = new Map(); // One sample per voice; replaying never synthesizes again.
  let voices = [];
  let controller = null;
  let serial = 0;

  function status(message) { $('status').textContent = message; }
  function stop() {
    serial++;
    controller?.abort();
    controller = null;
    audio.pause();
  }
  async function readJSON(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.detail || '请求失败，请重试');
    return data;
  }
  function updateCount() {
    $('favoriteCount').textContent = `已加入 ${voices.filter(v => v.favorite).length} 个候选`;
    $('voiceCount').textContent = `${voices.length} 款`;
  }
  function updateFavoriteButton(button, voice) {
    button.textContent = voice.favorite ? '已加入 ✓' : '加入候选';
    button.setAttribute('aria-pressed', String(voice.favorite));
    button.setAttribute('aria-label', `${voice.favorite ? '移除' : '加入'}候选：${voice.customName}`);
  }
  async function favorite(voice, button) {
    document.querySelectorAll('.favorite').forEach(btn => { btn.disabled = true; });
    try {
      const result = await readJSON(await fetch('/api/tts/edge-voices', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({voice:voice.uri, favorite:!voice.favorite}),
      }));
      for (const row of voices) {
        row.favorite = result.voices.find(v => v.uri === row.uri)?.favorite || false;
      }
      document.querySelectorAll('.favorite').forEach(btn => {
        const row = voices.find(v => v.uri === btn.dataset.voice);
        if (row) updateFavoriteButton(btn, row);
      });
      renderFavorites();
      updateCount();
      status(voice.favorite ? '已加入候选，回聊天或小剧场就能选择。' : '已从候选移除，仍可在这里试听。');
    } catch (error) { status(`保存失败：${error.message}`); }
    finally { document.querySelectorAll('.favorite').forEach(btn => { btn.disabled = false; }); }
  }
  async function preview(voice) {
    const sample = text.value.trim();
    if (!sample) { status('先写一小段想听的文字吧。'); text.focus(); return; }
    stop();
    const request = serial;
    controller = new AbortController();
    status(`正在生成 ${voice.customName.replace('Edge 免费 · ', '')}…`);
    try {
      let cached = cache.get(voice.uri);
      if (!cached || cached.text !== sample) {
        const response = await fetch('/api/tts', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({text:sample, voice:voice.uri}), signal:controller.signal,
        });
        if (!response.ok) await readJSON(response);
        const blob = await response.blob();
        if (request !== serial) return;
        if (!blob.size) throw new Error('没有收到音频，请重试');
        if (cached) URL.revokeObjectURL(cached.url);
        cached = {text:sample, url:URL.createObjectURL(blob)};
        cache.set(voice.uri, cached);
      }
      if (request !== serial) return;
      audio.src = cached.url;
      status(`试听：${voice.customName.replace('Edge 免费 · ', '')}`);
      try { await audio.play(); }
      catch (_) { if (request === serial) status('音频已就绪，点播放器的播放键即可。'); }
    } catch (error) {
      if (request === serial && error.name !== 'AbortError') status(`试听失败：${error.message}`);
    } finally { if (request === serial) controller = null; }
  }
  function renderVoices(container, rows) {
      const fragment = document.createDocumentFragment();
      for (const voice of rows) {
        const card = document.createElement('article');
        card.className = 'voice';
        const name = document.createElement('h3');
        name.textContent = voice.customName.replace('Edge 免费 · ', '');
        const actions = document.createElement('div');
        actions.className = 'actions';
        const play = document.createElement('button');
        play.className = 'preview'; play.textContent = '试听';
        play.setAttribute('aria-label', `试听：${name.textContent}`);
        play.addEventListener('click', () => preview(voice));
        const add = document.createElement('button'); add.className = 'favorite';
        add.dataset.voice = voice.uri;
        updateFavoriteButton(add, voice);
        add.addEventListener('click', () => favorite(voice, add));
        actions.append(play, add); card.append(name, actions); fragment.append(card);
      }
      container.replaceChildren(fragment);
  }
  function renderFavorites() {
    const favorites = voices.filter(voice => voice.favorite);
    renderVoices($('favorites'), favorites);
    $('favoritesEmpty').hidden = favorites.length > 0;
  }
  async function load() {
    try {
      voices = (await readJSON(await fetch('/api/tts/edge-voices'))).voices;
      renderVoices($('voices'), voices);
      renderFavorites();
      updateCount();
    } catch (error) {
      status(`音色加载失败：${error.message}，请刷新页面重试。`);
      $('favoriteCount').textContent = '加载失败';
      $('voiceCount').textContent = '加载失败';
    }
  }
  function navigate(url) {
    stop();
    if (window.parent !== window && typeof window.parent.openSubPage === 'function') {
      if (url === '/chat' && typeof window.parent.closeSubPage === 'function') window.parent.closeSubPage();
      else window.parent.openSubPage(url);
    } else {
      window.location.assign(url);
    }
  }
  window.handleNativeBack = () => { navigate('/'); return 'handled'; };
  $('backHome').addEventListener('click', window.handleNativeBack);
  document.querySelectorAll('[data-voice-nav]').forEach(link => {
    link.addEventListener('click', event => { event.preventDefault(); navigate(link.getAttribute('href')); });
  });
  window.onAionSubPageVisibilityChanged = visible => { if (!visible) stop(); };
  text.addEventListener('input', () => { $('charCount').textContent = `${text.value.length} / 1,000`; });
  $('charCount').textContent = `${text.value.length} / 1,000`;
  $('stop').addEventListener('click', () => { stop(); status('已停止试听。'); });
  audio.addEventListener('error', () => status('音频播放失败，请重新试听。'));
  window.addEventListener('pagehide', stop);
  load();
})();
