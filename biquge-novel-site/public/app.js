(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    searchForm: $('#searchForm'),
    searchInput: $('#searchInput'),
    sourceSelect: $('#sourceSelect'),
    importButton: $('#importButton'),
    importModal: $('#importModal'),
    importInput: $('#importInput'),
    importConfirm: $('#importConfirm'),
    modalClose: $('#modalClose'),
    toast: $('#toast'),
    shelfGrid: $('#shelfGrid'),
    shelfEmpty: $('#shelfEmpty'),
    shelfCount: $('#shelfCount'),
    historyRows: $('#historyRows'),
    historyEmpty: $('#historyEmpty'),
    historyCount: $('#historyCount'),
    discoverGrid: $('#discoverGrid'),
    searchGrid: $('#searchGrid'),
    searchEmpty: $('#searchEmpty'),
    searchCount: $('#searchCount'),
    searchTitle: $('#searchTitle'),
    bookDetail: $('#bookDetail'),
    bookBack: $('#bookBack'),
    reader: $('#reader'),
    readerBack: $('#readerBack'),
    readerBookTitle: $('#readerBookTitle'),
    readerChapterTitle: $('#readerChapterTitle'),
    readerSource: $('#readerSource'),
    readerList: $('#readerList'),
    chapterDrawer: $('#chapterDrawer'),
    drawerChapters: $('#drawerChapters'),
    drawerClose: $('#drawerClose'),
    readerContent: $('#readerContent'),
    prevChapter: $('#prevChapter'),
    nextChapter: $('#nextChapter'),
    fontMinus: $('#fontMinus'),
    fontPlus: $('#fontPlus'),
    themeToggle: $('#themeToggle'),
  };

  const STORE_KEYS = {
    shelf: 'biquge.shelf',
    history: 'biquge.history',
    settings: 'biquge.settings',
  };

  const SOURCE_NAMES = {
    biquge321: '笔趣阁321',
    biqugie: '笔趣阁网',
    sudugu: '速读谷',
  };

  const THEMES = ['paper', 'green', 'dark'];

  const DISCOVER_BOOKS = [
    {
      title: '夜无疆',
      author: '辰东',
      source: 'biqugie',
      url: 'https://www.biqugie.com/28/28293/',
      latest: '第782章 真魔踏青霄【下】',
    },
    {
      title: '神通者',
      author: '天蚕土豆',
      source: 'biquge321',
      url: 'https://www.biquge321.com/xiaoshuo/463528/',
      latest: '第12章 高玉',
    },
  ];

  const RELIABLE_BOOK_URLS = {
    夜无疆: {
      source: 'biqugie',
      url: 'https://www.biqugie.com/28/28293/',
    },
  };

  let shelf = readStore(STORE_KEYS.shelf, []);
  let history = readStore(STORE_KEYS.history, []);
  let settings = Object.assign(
    { fontSize: 18, theme: 'paper' },
    readStore(STORE_KEYS.settings, {})
  );

  const state = {
    currentBook: null,
    currentIndex: 0,
    chapters: [],
    chapterData: null,
    searchBooks: [],
    returnView: 'home',
  };

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function sourceName(id) {
    return (
      SOURCE_NAMES[id] ||
      (id && id.startsWith('gh-') ? 'GitHub书源' : id || '网络源')
    );
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function formatTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - Number(ts);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)}小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
    const date = new Date(Number(ts));
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function renderIcons() {
    if (window.lucide) {
      requestAnimationFrame(() => lucide.createIcons());
    }
  }

  function coverHtml(book, large = false) {
    const title = book.title || '书';
    if (book.cover) {
      return `<img src="${escapeAttr(book.cover)}" alt="${escapeAttr(title)}" loading="lazy">`;
    }
    const cls = large ? 'cover-lg-fallback' : 'cover-fallback';
    return `<div class="${cls}">${escapeHtml(String(title).slice(0, 1))}</div>`;
  }

  function bookCard(book) {
    return `
      <article class="book-card" data-url="${escapeAttr(book.url)}" data-source="${escapeAttr(book.source || '')}" data-title="${escapeAttr(book.title || '')}">
        <div class="cover">${coverHtml(book)}</div>
        <div class="book-meta">
          <h3>${escapeHtml(book.title || '')}</h3>
          <p>${escapeHtml(book.author || '')}</p>
          <span class="source-tag">${escapeHtml(sourceName(book.source))}</span>
        </div>
      </article>`;
  }

  function paragraphs(text) {
    return String(text || '')
      .split(/\n+/)
      .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
      .join('');
  }

  function currentVisibleView() {
    const active = $('.view.active');
    return active ? active.id.replace('view-', '') : 'home';
  }

  function showView(name) {
    $$('.view').forEach((view) => view.classList.remove('active'));
    const target = $(`#view-${name}`);
    if (target) target.classList.add('active');
    $$('.nav-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === name);
    });
    if (name === 'home') renderShelf();
    if (name === 'history') renderHistory();
    if (name === 'discover') renderDiscover();
  }

  function renderShelf() {
    els.shelfCount.textContent = shelf.length ? `${shelf.length} 本` : '';
    els.shelfGrid.innerHTML = shelf.map(bookCard).join('');
    els.shelfEmpty.classList.toggle('hidden', shelf.length > 0);
    renderIcons();
  }

  function renderHistory() {
    els.historyCount.textContent = history.length ? `${history.length} 条` : '';
    els.historyRows.innerHTML = history
      .map(
        (item) => `
          <button class="history-row" data-url="${escapeAttr(item.url)}" data-source="${escapeAttr(item.source || '')}" data-title="${escapeAttr(item.title || '')}">
            <span class="history-title">${escapeHtml(item.title || '')}</span>
            <span class="history-chapter">${escapeHtml(item.chapterTitle || '')}</span>
            <time>${escapeHtml(formatTime(item.time))}</time>
          </button>`
      )
      .join('');
    els.historyEmpty.classList.toggle('hidden', history.length > 0);
    renderIcons();
  }

  function renderDiscover() {
    els.discoverGrid.innerHTML = DISCOVER_BOOKS.map(bookCard).join('');
    renderIcons();
  }

  async function api(path, options = {}) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data;
  }

  async function runSearch(query, source) {
    showView('search');
    els.searchTitle.textContent = `“${query}”`;
    els.searchCount.textContent = '';
    els.searchEmpty.classList.add('hidden');
    els.searchGrid.innerHTML =
      '<div class="empty-state"><i data-lucide="loader-circle"></i><span>搜索中</span></div>';
    renderIcons();
    try {
      const data = await api(
        `/api/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(source || '')}`
      );
      state.searchBooks = data.books || [];
      els.searchCount.textContent = state.searchBooks.length
        ? `${state.searchBooks.length} 个结果`
        : '';
      els.searchGrid.innerHTML = state.searchBooks.map(bookCard).join('');
      els.searchEmpty.classList.toggle('hidden', state.searchBooks.length > 0);
      if (data.errors && data.errors.length && state.searchBooks.length === 0) {
        toast(data.errors.map((e) => `${sourceName(e.source)}：${e.message}`).join('；'));
      }
      renderIcons();
    } catch (err) {
      state.searchBooks = [];
      els.searchGrid.innerHTML = '';
      els.searchEmpty.classList.remove('hidden');
      toast(err.message);
    }
  }

  function isOnShelf(url) {
    return shelf.some((book) => book.url === url);
  }

  function toggleShelf(book) {
    const index = shelf.findIndex((item) => item.url === book.url);
    if (index >= 0) {
      shelf.splice(index, 1);
      toast('已移出书架');
    } else {
      shelf.unshift({
        url: book.url,
        source: book.source,
        title: book.title,
        author: book.author,
        cover: book.cover,
        latest: book.latest,
      });
      toast('已加入书架');
    }
    writeStore(STORE_KEYS.shelf, shelf);
    renderBook(book);
  }

  async function openBook(url, source, title) {
    const reliable = RELIABLE_BOOK_URLS[title || ''];
    if (reliable && reliable.url !== url) {
      url = reliable.url;
      source = reliable.source;
    }
    state.returnView = currentVisibleView();
    showView('book');
    els.bookDetail.innerHTML =
      '<div class="empty-state"><i data-lucide="loader-circle"></i><span>加载中</span></div>';
    renderIcons();
    try {
      const book = await api(
        `/api/book?url=${encodeURIComponent(url)}${source ? `&source=${encodeURIComponent(source)}` : ''}`
      );
      state.currentBook = book;
      renderBook(book);
    } catch (err) {
      els.bookDetail.innerHTML =
        '<div class="empty-state"><i data-lucide="alert-circle"></i><span>' +
        escapeHtml(err.message) +
        '</span></div>';
      renderIcons();
    }
  }

  function filterChapters(book, keyword) {
    $$('#chapterList .chapter-item').forEach((item) => {
      const title = item.querySelector('.chapter-title');
      const matched = !keyword || (title && title.textContent.includes(keyword));
      item.style.display = matched ? '' : 'none';
    });
  }

  let cachePollTimer = null;

  async function refreshCacheStatus(book) {
    const status = await api(
      `/api/cache/status?url=${encodeURIComponent(book.url)}`
    ).catch(() => null);
    renderCacheStatus(book, status);
  }

  async function startBookCache(book) {
    try {
      const data = await api(`/api/cache/start?url=${encodeURIComponent(book.url)}`, {
        method: 'POST',
      });
      toast('开始缓存全部章节');
      pollCacheJob(book, data.jobId);
    } catch (err) {
      toast(err.message);
    }
  }

  function prefetchNextChapters(book, fromIndex, count = 5) {
    if (!book || !book.chapters || fromIndex >= book.chapters.length) return;
    const slice = book.chapters
      .slice(fromIndex, fromIndex + count)
      .map((chapter) => ({ url: chapter.url, title: chapter.title }));
    if (!slice.length) return;
    api(
      `/api/cache/range?url=${encodeURIComponent(book.url)}&title=${encodeURIComponent(
        book.title || ''
      )}&chapters=${encodeURIComponent(JSON.stringify(slice))}`,
      { method: 'POST' }
    ).catch(() => {});
  }

  function pollCacheJob(book, jobId) {
    clearTimeout(cachePollTimer);
    const tick = async () => {
      const data = await api(
        `/api/cache/status?jobId=${encodeURIComponent(jobId)}`
      ).catch(() => null);
      if (!data || !data.job) {
        await refreshCacheStatus(book);
        return;
      }
      renderCacheStatus(book, data);
      if (data.job.status === 'running') {
        cachePollTimer = setTimeout(tick, 1500);
      } else {
        await refreshCacheStatus(book);
      }
    };
    tick();
  }

  async function removeBookCache(book) {
    try {
      await api(`/api/cache/remove?url=${encodeURIComponent(book.url)}`, {
        method: 'DELETE',
      });
      toast('已清除缓存');
      await refreshCacheStatus(book);
    } catch (err) {
      toast(err.message);
    }
  }

  function renderCacheStatus(book, status) {
    const start = $('#cacheStart');
    if (!start) return;
    const remove = $('#cacheRemove');
    const progress = $('#cacheProgress');
    const bar = $('#cacheBarInner');
    const text = $('#cacheStatusText');
    const job = status && status.job;
    const cached = status && status.cached;
    const total = (job && job.total) || (cached && cached.total) || (book.chapters ? book.chapters.length : 0);
    const done =
      (job && job.done) || (cached && cached.completed ? cached.total : cached ? cached.total : 0);
    const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

    if (job && job.status === 'running') {
      start.disabled = true;
      start.querySelector('span').textContent = '缓存中';
      remove.classList.add('hidden');
      progress.classList.remove('hidden');
      bar.style.width = `${percent}%`;
      text.textContent = `${done}/${total} · ${job.current || ''}`;
      return;
    }

    start.disabled = false;
    if (cached && cached.completed) {
      start.querySelector('span').textContent = '重新缓存';
      remove.classList.remove('hidden');
      progress.classList.remove('hidden');
      bar.style.width = '100%';
      text.textContent = `已缓存 ${cached.total} 章${
        cached.locked ? ` · ${cached.locked} 章锁定` : ''
      }${cached.failed ? ` · ${cached.failed} 章失败` : ''}`;
    } else if (cached && !cached.completed) {
      start.querySelector('span').textContent = '重新缓存';
      remove.classList.remove('hidden');
      progress.classList.remove('hidden');
      bar.style.width = `${percent}%`;
      text.textContent = `已缓存 ${cached.total}/${total} 章`;
    } else {
      start.querySelector('span').textContent = '缓存全部章节';
      remove.classList.add('hidden');
      progress.classList.add('hidden');
    }
    renderIcons();
  }

  function renderBook(book) {
    const onShelf = isOnShelf(book.url);
    const chaptersHtml = (book.chapters || [])
      .map(
        (chapter, index) => `
          <button class="chapter-item" data-index="${index}">
            ${chapter.needPay ? '<i class="lock-icon" data-lucide="lock"></i>' : ''}
            <span class="chapter-title">${escapeHtml(chapter.title || '')}</span>
          </button>`
      )
      .join('');
    els.bookDetail.innerHTML = `
      <div class="book-hero">
        <div class="book-cover-lg">${coverHtml(book, true)}</div>
        <div class="book-info">
          <h1>${escapeHtml(book.title || '')}</h1>
          <p class="book-meta-line">${escapeHtml(
            [book.author, book.status, book.latest].filter(Boolean).join(' · ')
          )}</p>
          <p class="book-desc">${escapeHtml(book.description || '暂无简介')}</p>
          <div class="book-actions">
            <button id="startRead" class="primary-button"><i data-lucide="book-open"></i><span>开始阅读</span></button>
            <button id="shelfToggle" class="ghost-button">
              ${
                onShelf
                  ? '<i data-lucide="bookmark-check"></i><span>已在书架</span>'
                  : '<i data-lucide="bookmark-plus"></i><span>加入书架</span>'
              }
            </button>
          </div>
        </div>
      </div>
      <div class="cache-panel">
        <div class="cache-panel-head">
          <strong>本地缓存</strong>
          <div class="cache-actions">
            <button id="cacheStart" class="ghost-button">
              <i data-lucide="download"></i><span>缓存全部章节</span>
            </button>
            <button id="cacheRemove" class="ghost-button hidden">
              <i data-lucide="trash-2"></i><span>清除缓存</span>
            </button>
          </div>
        </div>
        <div id="cacheProgress" class="cache-progress hidden">
          <div class="cache-bar"><div id="cacheBarInner" class="cache-bar-inner"></div></div>
          <p id="cacheStatusText"></p>
        </div>
      </div>
      <div class="chapter-panel">
        <div class="chapter-panel-head">
          <strong>目录 · ${book.chapters ? book.chapters.length : 0}</strong>
          <input id="chapterFilter" type="search" placeholder="过滤章节">
        </div>
        <div id="chapterList" class="chapter-list">${chaptersHtml}</div>
      </div>`;

    $('#startRead').addEventListener('click', () => startReading(book));
    $('#shelfToggle').addEventListener('click', () => toggleShelf(book));
    $('#cacheStart').addEventListener('click', () => startBookCache(book));
    $('#cacheRemove').addEventListener('click', () => removeBookCache(book));
    $('#chapterFilter').addEventListener('input', (event) => {
      filterChapters(book, event.target.value.trim());
    });
    refreshCacheStatus(book);
    renderIcons();
  }

  function startReading(book) {
    if (!book.chapters || !book.chapters.length) {
      toast('暂无章节');
      return;
    }
    const entry = history.find((item) => item.url === book.url);
    let index = 0;
    if (entry && entry.chapterUrl) {
      const found = book.chapters.findIndex((chapter) => chapter.url === entry.chapterUrl);
      if (found >= 0) index = found;
    }
    openChapter(book, index);
  }

  function openChapter(book, index) {
    if (!book.chapters || !book.chapters.length) {
      toast('暂无章节');
      return;
    }
    index = Math.max(0, Math.min(book.chapters.length - 1, index));
    state.currentBook = book;
    state.currentIndex = index;
    state.chapters = book.chapters;
    const chapter = book.chapters[index];
    els.readerBookTitle.textContent = book.title || '';
    els.readerChapterTitle.textContent = chapter.title || '';
    els.reader.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderChapterDrawer();
    applySettings();
    loadChapter(chapter);
  }

  async function loadChapter(chapter) {
    els.readerContent.innerHTML = '<div class="reader-loading">加载中</div>';
    els.readerSource.textContent = '';
    try {
      const params = new URLSearchParams({
        url: chapter.url,
        bookUrl: state.currentBook.url,
        bookTitle: state.currentBook.title || '',
        chapterTitle: chapter.title || '',
        index: String(state.currentIndex),
      });
      const data = await api(`/api/chapter?${params.toString()}`);
      state.chapterData = data;
      els.readerSource.textContent = data.source
        ? data.fallback
          ? `已切换 · ${sourceName(data.source)}`
          : sourceName(data.source)
        : '';
      if (data.locked) {
        renderLocked(data);
      } else {
        els.readerContent.innerHTML =
          '<div class="reader-content-inner">' + paragraphs(data.content) + '</div>';
        els.readerChapterTitle.textContent = data.title || chapter.title || '';
      }
      saveProgress(data, chapter);
      prefetchNextChapters(state.currentBook, state.currentIndex + 1, 5);
      updateNav();
      renderIcons();
    } catch (err) {
      els.readerContent.innerHTML =
        '<div class="reader-error">' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderLocked(data) {
    const title = data.bookTitle || state.currentBook.title || '';
    els.readerContent.innerHTML = `
      <div class="locked-panel">
        <i data-lucide="lock"></i>
        <strong>本章需要会员</strong>
        <span>可在笔趣阁免费源继续阅读</span>
        <button id="fallbackSearch" class="primary-button">
          <i data-lucide="search"></i><span>在笔趣阁找免费源</span>
        </button>
      </div>`;
    $('#fallbackSearch').addEventListener('click', () => {
      const query = title || state.currentBook.title || '';
      closeReader();
      runSearch(query, 'biquge321');
    });
  }

  function renderChapterDrawer() {
    els.drawerChapters.innerHTML = state.chapters
      .map(
        (chapter, index) => `
          <button class="drawer-chapter ${index === state.currentIndex ? 'active' : ''}" data-index="${index}">
            ${escapeHtml(chapter.title || '')}
          </button>`
      )
      .join('');
    renderIcons();
  }

  function updateNav() {
    els.prevChapter.disabled = state.currentIndex <= 0;
    els.nextChapter.disabled = state.currentIndex >= state.chapters.length - 1;
  }

  function saveProgress(data, chapter) {
    const book = state.currentBook;
    if (!book) return;
    history = history.filter((item) => item.url !== book.url);
    history.unshift({
      url: book.url,
      source: book.source,
      title: book.title,
      author: book.author,
      cover: book.cover,
      chapterUrl: chapter.url,
      chapterTitle: data.title || chapter.title || '',
      time: Date.now(),
    });
    history = history.slice(0, 30);
    writeStore(STORE_KEYS.history, history);
  }

  function toggleDrawer(force) {
    const willShow =
      typeof force === 'boolean'
        ? force
        : els.chapterDrawer.classList.contains('hidden');
    els.chapterDrawer.classList.toggle('hidden', !willShow);
  }

  function closeReader() {
    els.reader.classList.add('hidden');
    document.body.style.overflow = '';
    els.chapterDrawer.classList.add('hidden');
  }

  function applySettings() {
    els.reader.dataset.theme = settings.theme;
    els.readerContent.style.setProperty('--reader-font', `${settings.fontSize}px`);
  }

  function adjustFont(delta) {
    settings.fontSize = Math.min(26, Math.max(14, settings.fontSize + delta));
    writeStore(STORE_KEYS.settings, settings);
    applySettings();
  }

  function cycleTheme() {
    const index = THEMES.indexOf(settings.theme);
    settings.theme = THEMES[(index + 1) % THEMES.length];
    writeStore(STORE_KEYS.settings, settings);
    applySettings();
  }

  let toastTimer = null;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
  }

  function showImport() {
    els.importModal.classList.remove('hidden');
    els.importInput.focus();
  }

  function hideImport() {
    els.importModal.classList.add('hidden');
    els.importInput.value = '';
  }

  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = els.searchInput.value.trim();
    if (!query) return;
    runSearch(query, els.sourceSelect.value);
  });

  els.importButton.addEventListener('click', showImport);
  els.modalClose.addEventListener('click', hideImport);
  els.importModal.addEventListener('click', (event) => {
    if (event.target === els.importModal) hideImport();
  });
  els.importConfirm.addEventListener('click', async () => {
    const raw = els.importInput.value.trim();
    if (!raw) {
      toast('请输入链接');
      return;
    }
    try {
      new URL(raw);
    } catch {
      toast('链接格式不正确');
      return;
    }
    hideImport();
    openBook(raw, '');
  });
  els.importInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') els.importConfirm.click();
  });

  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });

  els.bookBack.addEventListener('click', () => {
    showView(state.returnView || 'home');
  });

  document.addEventListener('click', (event) => {
    const chapterButton = event.target.closest('.chapter-item[data-index]');
    if (chapterButton && state.currentBook) {
      openChapter(state.currentBook, Number(chapterButton.dataset.index));
      return;
    }
    const urlElement = event.target.closest('[data-url]');
    if (urlElement && !urlElement.closest('.chapter-item')) {
      openBook(
        urlElement.dataset.url,
        urlElement.dataset.source || '',
        urlElement.dataset.title || ''
      );
    }
  });

  els.drawerChapters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (!button || !state.currentBook) return;
    openChapter(state.currentBook, Number(button.dataset.index));
    toggleDrawer(false);
  });

  els.readerBack.addEventListener('click', closeReader);
  els.readerList.addEventListener('click', () => toggleDrawer());
  els.drawerClose.addEventListener('click', () => toggleDrawer(false));
  els.prevChapter.addEventListener('click', () => {
    if (state.currentIndex > 0) openChapter(state.currentBook, state.currentIndex - 1);
  });
  els.nextChapter.addEventListener('click', () => {
    if (state.currentIndex < state.chapters.length - 1) {
      openChapter(state.currentBook, state.currentIndex + 1);
    }
  });
  els.fontMinus.addEventListener('click', () => adjustFont(-1));
  els.fontPlus.addEventListener('click', () => adjustFont(1));
  els.themeToggle.addEventListener('click', cycleTheme);

  document.addEventListener('keydown', (event) => {
    if (els.reader.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeReader();
    else if (event.key === 'ArrowLeft') els.prevChapter.click();
    else if (event.key === 'ArrowRight') els.nextChapter.click();
  });

  renderShelf();
  renderDiscover();
  applySettings();
  renderIcons();
})();
