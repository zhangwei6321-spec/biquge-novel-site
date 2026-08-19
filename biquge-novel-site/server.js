'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const cheerio = require('cheerio');
const githubSourceLoader = require('./github-sources');

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, 'cache', 'books');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function fetchText(url, options = {}) {
  const { method = 'GET', body = null, headers = {}, timeout = 15000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: controller.signal,
      headers: { ...DEFAULT_HEADERS, ...headers },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    if (/charset=gb/i.test(contentType)) {
      return new TextDecoder('gbk').decode(buffer);
    }
    return buffer.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(href, base) {
  return new URL(href, base).href;
}

function extractJsonObject(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const brace = html.indexOf('{', start);
  if (brace === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(brace, i + 1);
    }
  }
  return null;
}

function parseInitialState(html) {
  const raw = extractJsonObject(html, 'window.__INITIAL_STATE__');
  if (!raw) throw new Error('页面中未找到数据');
  return JSON.parse(raw.replace(/\bundefined\b/g, 'null'));
}

function textFromHtml(html) {
  const $ = cheerio.load(html, null, false);
  $('script, style, noscript, iframe').remove();
  $('br').replaceWith('\n');
  $('p, div, h1, h2, h3, li, blockquote').after('\n');
  return $.root().text();
}

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanChapterText(text) {
  return normalizeText(text)
    .split('\n')
    .filter(
      (line) =>
        !/一秒记住|请收藏本站|手机用户请|手机站|无弹窗|biquge321\.com|bgg99\.com|更新最快/.test(
          line
        ) &&
        !/piquge\.com|biqugie\.com|龙王小说|看后求收藏/.test(
          line
        )
    )
    .join('\n');
}

function bookSummary(book) {
  return {
    id: book.id || '',
    source: book.source,
    title: book.title,
    author: book.author,
    cover: book.cover,
    description: book.description,
    status: book.status,
    latest: book.latest,
    url: book.url,
  };
}

const KNOWN_BIQUGE_BOOKS = [
  {
    title: '神通者',
    author: '天蚕土豆',
    url: 'https://www.biquge321.com/xiaoshuo/463528/',
  },
  {
    title: '夜无疆',
    author: '辰东',
    url: 'https://www.biquge321.com/xiaoshuo/990215/',
  },
  {
    title: '万古神帝',
    author: '飞天鱼',
    url: 'https://www.biquge321.com/xiaoshuo/25995/',
  },
];

const KNOWN_BOOK_URLS = {
  夜无疆: [
    { sourceId: 'biquge321', url: 'https://www.biquge321.com/xiaoshuo/990215/' },
    { sourceId: 'biqugie', url: 'https://www.biqugie.com/28/28293/' },
    { sourceId: 'sudugu', url: 'https://www.sudugu.org/4/' },
  ],
  万古神帝: [
    { sourceId: 'longwangxs', url: 'https://www.longwangxs.cc/novel/1087408/' },
    { sourceId: 'sudugu', url: 'https://www.sudugu.org/3745/' },
    { sourceId: 'biquge321', url: 'https://www.biquge321.com/xiaoshuo/25995/' },
    { sourceId: 'biqugie', url: 'https://www.biqugie.com/9/9680/' },
  ],
  神通者: [
    { sourceId: 'fanqie', url: 'https://fanqienovel.com/page/7665193065501445145' },
    { sourceId: 'biquge321', url: 'https://www.biquge321.com/xiaoshuo/463528/' },
  ],
};

const UNRELIABLE_BOOK_SOURCES = {
  夜无疆: ['biquge321'],
  万古神帝: ['biquge321'],
  神通者: ['biquge321'],
};

async function bingBookPages(query, hostPattern, pathPattern) {
  const queries = [
    `site:${hostPattern} ${query}`,
    `site:${hostPattern.replace(/\/.*$/, '')} ${query}`,
  ];
  for (const q of queries) {
    const url = new URL('https://www.bing.com/search');
    url.searchParams.set('q', q);
    url.searchParams.set('setlang', 'zh-hans');
    url.searchParams.set('cc', 'CN');
    try {
      const html = await fetchText(url.href, { timeout: 12000 });
      const $ = cheerio.load(html);
      const pages = [];
      $('li.b_algo a').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const match = href.match(pathPattern);
        if (match) pages.push(match[1]);
      });
      if (pages.length) return [...new Set(pages)];
    } catch {
      // try next query
    }
  }
  return [];
}

const cache = new Map();

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { time: Date.now(), value });
  if (cache.size > 300) {
    const oldest = [...cache.keys()].slice(0, 100);
    for (const k of oldest) cache.delete(k);
  }
  return value;
}

function withTimeout(promise, ms, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
  ]);
}

function cacheKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function cacheFilePath(url) {
  return path.join(CACHE_DIR, `${cacheKey(url)}.json`);
}

async function readBookCache(url) {
  try {
    return JSON.parse(await fs.readFile(cacheFilePath(url), 'utf8'));
  } catch {
    return null;
  }
}

async function writeBookCache(url, data) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFilePath(url), JSON.stringify(data), 'utf8');
}

async function updateCachedChapter(bookUrl, chapterUrl, data) {
  const file = await readBookCache(bookUrl);
  if (!file || !file.chapters) return;
  const index = file.chapters.findIndex((chapter) => chapter.url === chapterUrl);
  if (index === -1) return;
  file.chapters[index] = {
    ...file.chapters[index],
    title: data.title || file.chapters[index].title,
    source: data.source || file.chapters[index].source,
    locked: !!data.locked,
    content: data.content || '',
    cachedAt: Date.now(),
  };
  await writeBookCache(bookUrl, file);
}

function publicCacheJob(job) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    locked: job.locked,
    current: job.current,
    startedAt: job.startedAt,
    errors: job.errors.slice(-10),
  };
}

const cacheJobs = new Map();

function findCacheJobByKey(key) {
  return cacheJobs.get(key) || null;
}

async function startCacheJob(bookUrl) {
  const key = cacheKey(bookUrl);
  const existing = findCacheJobByKey(key);
  if (existing) return existing.id;
  const source = detectSource(bookUrl);
  if (!source) throw new Error('暂不支持该来源链接');
  const book = await cached(`book:${source.id}:${bookUrl}`, 10 * 60 * 1000, () =>
    source.book(bookUrl)
  );
  if (!book.chapters || !book.chapters.length) {
    throw new Error('这本书没有可缓存的章节');
  }
  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    bookUrl,
    sourceId: source.id,
    status: 'running',
    total: book.chapters.length,
    done: 0,
    failed: 0,
    locked: 0,
    current: '',
    startedAt: Date.now(),
    errors: [],
  };
  cacheJobs.set(key, job);
  runCacheJob(job, book, source).catch(() => {});
  return job.id;
}

async function runCacheJob(job, book, source) {
  const chapters = book.chapters;
  const results = new Array(chapters.length);
  let cursor = 0;

  async function worker() {
    while (cursor < chapters.length) {
      const index = cursor;
      cursor += 1;
      const chapter = chapters[index];
      job.current = chapter.title || '';
      try {
        const data = await tryChapterWithFallback({
          chapterUrl: chapter.url,
          bookTitle: book.title || '',
          chapterTitle: chapter.title || '',
          index,
          sourceId: source.id,
        });
        results[index] = {
          title: data.title || chapter.title,
          url: chapter.url,
          source: data.source || source.id,
          needPay: Number(chapter.needPay) || 0,
          locked: !!data.locked,
          content: data.content || '',
          cachedAt: Date.now(),
        };
        if (data.locked) job.locked += 1;
      } catch (err) {
        results[index] = {
          title: chapter.title,
          url: chapter.url,
          needPay: Number(chapter.needPay) || 0,
          locked: true,
          content: '',
          cachedAt: Date.now(),
        };
        job.failed += 1;
        job.errors.push(`${chapter.title || ''}: ${err.message}`);
        if (job.errors.length > 100) job.errors.splice(0, job.errors.length - 100);
      }
      job.done += 1;
      if (job.done % 50 === 0) {
        await writeBookCache(job.bookUrl, {
          book: bookSummary(book),
          chapters: results.filter(Boolean),
          completed: false,
          failed: job.failed,
          locked: job.locked,
          cachedAt: Date.now(),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  await Promise.all(Array.from({ length: 3 }, () => worker()));
  await writeBookCache(job.bookUrl, {
    book: bookSummary(book),
    chapters: results.filter(Boolean),
    completed: true,
    failed: job.failed,
    locked: job.locked,
    cachedAt: Date.now(),
  });
  job.status = 'done';
  cacheJobs.delete(job.key);
}

const BIQUGE_321 = {
  id: 'biquge321',
  name: '笔趣阁321',
  match(url) {
    return /(^|\.)biquge321\.com$/i.test(url.hostname);
  },

  async search(query) {
    const form = new URLSearchParams();
    form.set('s', query);
    form.set('searchkey', query);
    form.set('submit', '搜 索');
    const html = await fetchText(`${this.base}/s.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: `${this.base}/`,
      },
      body: form.toString(),
    });
    const $ = cheerio.load(html);
    let books = [];
    $('.lastupdate ul li').each((_, el) => {
      const $li = $(el);
      const $name = $li.find('.name a').first();
      const href = $name.attr('href');
      if (!href) return;
      books.push({
        id: (href.match(/\/(\d+)\/?$/) || [])[1] || href,
        source: this.id,
        title: $name.text().trim(),
        author: $li.find('.zuo a').first().text().trim(),
        category: $li.find('.lei a').first().text().trim().replace(/[\[\]]/g, ''),
        latest: $li.find('.jie a').first().text().trim(),
        updateTime: $li.find('.time').text().trim(),
        cover: '',
        description: '',
        url: resolveUrl(href, `${this.base}/`),
      });
    });
    if (!books.length) {
      const pages = await bingBookPages(
        query,
        'biquge321.com/xiaoshuo',
        /biquge321\.com\/xiaoshuo\/(\d+)\/?/i
      );
      const unique = [...new Set(pages)].slice(0, 6);
      const results = await Promise.allSettled(
        unique.map((id) =>
          cached(
            `biquge321:book:${id}`,
            10 * 60 * 1000,
            () => this.book(`${this.base}/xiaoshuo/${id}/`)
          )
        )
      );
      books = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => bookSummary(r.value));
    }
    if (!books.length) {
      for (const known of KNOWN_BIQUGE_BOOKS) {
        const matched =
          known.title.includes(query) ||
          known.author.includes(query) ||
          query.includes(known.title) ||
          query.includes(known.author);
        if (!matched) continue;
        try {
          const book = await this.book(known.url);
          books.push(bookSummary(book));
        } catch {
          // ignore known book failures
        }
        break;
      }
    }
    if (!books.length && /搜索次数已耗尽|一分钟只提供10次搜索/.test(html)) {
      throw new Error('笔趣阁搜索频率受限，请稍后再试');
    }
    return books;
  },

  async book(url) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const meta = (prop) => $(`meta[property="${prop}"]`).attr('content') || '';
    const title =
      meta('og:novel:book_name') ||
      $('.border_left h1').text().replace(/\s+/g, ' ').trim() ||
      $('title').text().split('_')[0].trim();
    const author = meta('og:novel:author') || $('meta[name="author"]').attr('content') || '';
    const cover = meta('og:image') || $('.border_left img').first().attr('src') || '';
    const description = meta('og:description') || $('.hang_3').text().trim() || '';
    const chapters = [];
    const seen = new Set();
    const selectors = [
      '.border_chapter .fen_4 li a',
      '.border_left_list .fen_3 li a',
      '.listmain dl dd a',
      'a[href*="/zhangjie/"]',
    ];
    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href');
        if (!href) return;
        const abs = resolveUrl(href, url);
        if (seen.has(abs)) return;
        seen.add(abs);
        chapters.push({ title: $a.text().trim(), url: abs });
      });
      if (chapters.length) break;
    }
    return {
      source: this.id,
      title,
      author,
      cover,
      description: normalizeText(description),
      status: meta('og:novel:status'),
      latest: chapters.length ? chapters[chapters.length - 1].title : meta('og:novel:latest_chapter_name'),
      url,
      chapters,
    };
  },

  async chapter(url) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const title = $('h1').text().trim();
    const $txt = $('#txt');
    $txt.find('a, script, style, iframe').remove();
    $txt.find('br').replaceWith('\n');
    const content = cleanChapterText($txt.text());
    const prevHref = $('#pb_prev').attr('href');
    const nextHref = $('#pb_next').attr('href');
    return {
      source: this.id,
      title,
      content,
      prevUrl: prevHref && !prevHref.startsWith('#') ? resolveUrl(prevHref, url) : null,
      nextUrl: nextHref && !nextHref.startsWith('#') ? resolveUrl(nextHref, url) : null,
      locked: false,
    };
  },
};

BIQUGE_321.base = 'https://www.biquge321.com';

async function bingFanqiePages(query) {
  const pages = await bingBookPages(
    query,
    'fanqienovel.com/page',
    /fanqienovel\.com\/page\/(\d+)/i
  );
  return pages.map((id) => `https://fanqienovel.com/page/${id}`);
}

async function fanqieBookPage(url) {
  const html = await fetchText(url);
  const state = parseInitialState(html);
  const p = state.page || {};
  const chapters = [];
  for (const volume of p.chapterListWithVolume || []) {
    for (const ch of volume || []) {
      chapters.push({
        title: ch.title || '',
        url: `https://fanqienovel.com/reader/${ch.itemId}`,
        itemId: ch.itemId,
        needPay: Number(ch.needPay) || 0,
      });
    }
  }
  return {
    id: p.bookId,
    source: FANQIE.id,
    title: p.bookName || '',
    author: p.author || '',
    authorId: p.authorId || '',
    cover: p.thumbUri || '',
    description: normalizeText(p.abstract || ''),
    status: p.status === 1 ? '连载中' : p.status === 0 ? '完结' : '',
    latest: p.lastChapterTitle || '',
    url,
    chapters,
  };
}

const FANQIE = {
  id: 'fanqie',
  name: '番茄小说',
  match(url) {
    return /(^|\.)fanqienovel\.com$/i.test(url.hostname);
  },

  async search(query) {
    const pages = await bingFanqiePages(query);
    const unique = [...new Set(pages)].slice(0, 6);
    const results = await Promise.allSettled(
      unique.map((url) =>
        cached(`fanqie:book:${url}`, 10 * 60 * 1000, () => fanqieBookPage(url))
      )
    );
    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
  },

  async book(url) {
    const parsed = new URL(url);
    let pageUrl = url;
    if (/^\/reader\//.test(parsed.pathname)) {
      const html = await fetchText(url);
      const state = parseInitialState(html);
      const ch = state.reader && state.reader.chapterData;
      if (!ch || !ch.bookId) throw new Error('无法从番茄章节页识别书籍');
      pageUrl = `https://fanqienovel.com/page/${ch.bookId}`;
    }
    return cached(`fanqie:book:${pageUrl}`, 10 * 60 * 1000, () =>
      fanqieBookPage(pageUrl)
    );
  },

  async chapter(url) {
    const html = await fetchText(url);
    const state = parseInitialState(html);
    const ch = (state.reader && state.reader.chapterData) || {};
    const content = ch.content ? normalizeText(textFromHtml(ch.content)) : '';
    const puaCount = [...content].filter(
      (char) => char.codePointAt(0) >= 0xe000 && char.codePointAt(0) <= 0xf8ff
    ).length;
    const puaRatio = content.length ? puaCount / content.length : 1;
    const locked =
      !content ||
      Number(ch.needPay) !== 0 ||
      content.length < 300 ||
      puaRatio > 0.05;
    return {
      source: this.id,
      title: ch.title || '',
      bookTitle: ch.bookName || '',
      bookUrl: ch.bookId ? `https://fanqienovel.com/page/${ch.bookId}` : '',
      content,
      prevUrl: ch.preItemId ? `https://fanqienovel.com/reader/${ch.preItemId}` : null,
      nextUrl: ch.nextItemId ? `https://fanqienovel.com/reader/${ch.nextItemId}` : null,
      locked,
    };
  },
};

const SUDUGU = {
  id: 'sudugu',
  name: '速读谷',
  match(url) {
    return /(^|\.)sudugu\.org$/i.test(url.hostname);
  },

  async search(query) {
    const url = new URL(`${this.base}/i/sor.aspx`);
    url.searchParams.set('key', query);
    const html = await fetchText(url.href, { timeout: 3500 });
    const $ = cheerio.load(html);
    const books = [];
    $('.item').each((_, el) => {
      const $el = $(el);
      const $link = $el.find('.itemtxt h3 a, .itemtxt h1 a').first();
      const href = $link.attr('href');
      if (!href) return;
      const $img = $el.find('img').first();
      books.push({
        id: href.replace(/\/+$/, '').split('/').pop() || href,
        source: this.id,
        title: $link.text().trim(),
        author: $el.find('a[href*="/zuozhe/"]').first().text().replace(/作者：/, '').trim(),
        cover: $img.attr('src') || $img.attr('data-src') || '',
        description: $el.find('.itemtxt dd').first().text().trim(),
        status: $el.find('.itemtxt p span').first().text().trim(),
        latest: $el.find('.itemtxt ul li a').first().text().trim(),
        url: resolveUrl(href, `${this.base}/`),
      });
    });
    return books;
  },

  async book(url) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const title =
      $('.itemtxt h1 a').first().text().trim() || $('title').text().split('-')[0].trim();
    const author = $('a[href*="/zuozhe/"]').first().text().replace(/作者：/, '').trim();
    const cover = $('.item img').first().attr('src') || '';
    const status = $('.itemtxt p span').first().text().trim();
    const description = $('.des p').first().text().trim() || $('.des').text().trim();
    const chapters = [];
    const seen = new Set();
    $('#list li a').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href) return;
      const abs = resolveUrl(href, url);
      if (seen.has(abs)) return;
      seen.add(abs);
      chapters.push({ title: $a.text().trim(), url: abs });
    });
    return {
      source: this.id,
      title,
      author,
      cover,
      description,
      status,
      latest: chapters.length ? chapters[chapters.length - 1].title : '',
      url,
      chapters,
    };
  },

  async chapter(url) {
    const parts = [];
    let current = url;
    let title = '';
    const visited = new Set();
    for (let i = 0; i < 20; i += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      const html = await fetchText(current);
      const $ = cheerio.load(html);
      if (!title) {
        title =
          $('h1').text().split('>').pop().trim() ||
          ($('title').text().split('-')[1] || '').trim();
      }
      const text = textFromHtml($('.con').html() || '');
      if (text) parts.push(text);
      let nextHref = null;
      $('.prenext a').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        if (href.startsWith('javascript')) return;
        if (($a.text() || '').includes('下一页') && nextHref === null) {
          nextHref = href;
        }
      });
      if (!nextHref) break;
      const next = resolveUrl(nextHref, current);
      const subPage = /\/\d+-\d+\.html$/.test(new URL(next).pathname);
      if (!subPage || next === current || visited.has(next)) break;
      current = next;
    }
    const content = cleanChapterText(parts.join('\n'));
    return {
      source: this.id,
      title,
      content,
      prevUrl: null,
      nextUrl: null,
      locked: !content,
    };
  },
};

SUDUGU.base = 'https://www.sudugu.org';

async function fetchBiqugie(url) {
  const attempts = [
    { Referer: 'https://www.biqugie.com/' },
    {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://www.biqugie.com/',
    },
  ];
  let lastError = null;
  for (const headers of attempts) {
    try {
      return await fetchText(url, { headers, timeout: 12000 });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('笔趣阁网请求失败');
}

const BIQUGIE = {
  id: 'biqugie',
  name: '笔趣阁网',
  match(url) {
    return /(^|\.)biqugie\.com$/i.test(url.hostname);
  },

  async search(query) {
    const url = new URL(`${this.base}/search/`);
    url.searchParams.set('searchkey', query);
    const html = await fetchBiqugie(url.href);
    const $ = cheerio.load(html);
    const books = [];
    $('.panel').each((_, panelEl) => {
      const $panel = $(panelEl);
      const heading = $panel.find('.panel-heading').text() || '';
      if (!heading.includes('有关的小说')) return;
      $panel.find('.book-coverlist').each((_, el) => {
        const $el = $(el);
        const $link = $el.find('.caption .name a').first();
        const href = $link.attr('href');
        if (!href) return;
        const $img = $el.find('.cover img').first();
        books.push({
          id: href.replace(/\/+$/, '').split('/').pop() || href,
          source: this.id,
          title: $link.text().trim(),
          author: $el.find('.caption .author').first().text().trim(),
          cover: $img.attr('data-src') || $img.attr('src') || '',
          description: $el.find('.caption .intro').first().text().trim(),
          status: $el
            .find('.caption .status span')
            .map((_, span) => $(span).text().trim())
            .get()
            .join(' '),
          latest: '',
          url: resolveUrl(href, `${this.base}/`),
        });
      });
    });
    return books;
  },

  async book(url) {
    const html = await fetchBiqugie(url);
    const $ = cheerio.load(html);
    const meta = (name) => $(`meta[property="${name}"]`).attr('content') || '';
    const title =
      meta('og:novel:book_name') ||
      $('h1').first().text().trim() ||
      $('title').text().split('_')[0].trim();
    const author = meta('og:novel:author') || '';
    const description = meta('og:description') || $('#bookIntro').text().trim() || '';
    const status = meta('og:novel:status') || '';
    const cover =
      $('.cover img').first().attr('data-src') ||
      $('.cover img').first().attr('src') ||
      '';
    const match = url.match(/https?:\/\/[^/]+\/(\d+)\/(\d+)\/?/i);
    const readUrl = match
      ? `${this.base}/read/${match[2]}/`
      : url;
    const firstHtml = await fetchBiqugie(readUrl);
    const $first = cheerio.load(firstHtml);
    const pageUrls = [];
    $first('#indexselect option').each((_, el) => {
      const value = $(el).attr('value');
      if (value && !pageUrls.includes(value)) pageUrls.push(value);
    });
    if (!pageUrls.length) pageUrls.push(readUrl);

    const chapters = [];
    const seen = new Set();
    const pageResults = await Promise.allSettled(
      pageUrls.map((pageUrl) =>
        pageUrl === readUrl
          ? Promise.resolve(firstHtml)
          : fetchBiqugie(resolveUrl(pageUrl, readUrl))
      )
    );
    for (const result of pageResults) {
      if (result.status !== 'fulfilled') continue;
      const $page = cheerio.load(result.value);
      $page('.panel-chapterlist dd a').each((_, el) => {
        const $a = $page(el);
        const href = $a.attr('href');
        if (!href) return;
        const abs = resolveUrl(href, readUrl);
        if (seen.has(abs)) return;
        seen.add(abs);
        chapters.push({
          title: $a
            .text()
            .replace(/[\ue000-\uf8ff]/g, '')
            .trim()
            .replace(/^(\d+)章/, '第$1章'),
          url: abs,
        });
      });
    }
    return {
      source: this.id,
      title,
      author,
      cover,
      description,
      status,
      latest:
        meta('og:novel:lastest_chapter_name') ||
        (chapters.length ? chapters[chapters.length - 1].title : ''),
      url,
      chapters,
    };
  },

  async chapter(url) {
    const parts = [];
    let current = url;
    let title = '';
    const visited = new Set();
    for (let i = 0; i < 30; i += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      const html = await fetchBiqugie(current);
      const $ = cheerio.load(html);
      if (!title) {
        title = $('h1').first().text().replace(/\s*\(.*\)\s*$/, '').trim();
      }
      const $content = $('#chaptercontent');
      $content.find('script, style').remove();
      const text = textFromHtml($content.html() || '');
      if (text) parts.push(text);
      let nextHref = null;
      $('.readpage a').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const label = $a.text() || '';
        if (href.startsWith('javascript')) return;
        if (label.includes('下一页')) {
          nextHref = href;
          return false;
        }
      });
      if (!nextHref) {
        $('.readpage a').each((_, el) => {
          const $a = $(el);
          const href = $a.attr('href') || '';
          if (href.startsWith('javascript')) return;
          if (/_\d+\.html$/.test(href)) {
            nextHref = href;
            return false;
          }
        }
        );
      }
      if (!nextHref) break;
      const next = resolveUrl(nextHref, current);
      if (
        !/_\d+\.html$/.test(new URL(next).pathname) ||
        next === current ||
        visited.has(next)
      ) {
        break;
      }
      current = next;
    }
    const content = cleanChapterText(parts.join('\n'));
    return {
      source: this.id,
      title,
      content,
      prevUrl: null,
      nextUrl: null,
      locked: !content,
    };
  },
};

BIQUGIE.base = 'https://www.biqugie.com';

const LONGWANGXS = {
  id: 'longwangxs',
  name: '龙王小说',
  match(url) {
    return /(^|\.)longwangxs\.cc$/i.test(url.hostname);
  },

  async search(query) {
    const books = [];
    for (const [bookTitle, entries] of Object.entries(KNOWN_BOOK_URLS)) {
      const entry = entries.find((item) => item.sourceId === this.id);
      if (!entry) continue;
      if (!bookTitle.includes(query) && !query.includes(bookTitle)) continue;
      try {
        const book = await this.book(entry.url);
        books.push({ ...bookSummary(book), id: entry.url, source: this.id });
      } catch {
        // skip unavailable known book
      }
    }
    return books;
  },

  async book(url) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const meta = (name) => $(`meta[property="${name}"]`).attr('content') || '';
    const title =
      meta('og:novel:book_name') ||
      $('h1.title').first().text().trim() ||
      $('title').text().split('_')[0].trim();
    let author = meta('og:novel:author') || '';
    if (title.includes('万古神帝')) author = '飞天鱼';
    const cover = meta('og:image') || '';
    const description = meta('og:description') || '';
    const status = meta('og:novel:status') || '';
    const chapters = [];
    $('#readerlists ul.chapterlist li a').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href) return;
      chapters.push({ title: $a.text().trim(), url: resolveUrl(href, url) });
    });
    return {
      source: this.id,
      title,
      author,
      cover,
      description,
      status,
      latest: chapters.length ? chapters[chapters.length - 1].title : '',
      url,
      chapters,
    };
  },

  async chapter(url) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim() || $('title').text().split('_')[0].trim();
    const $content = $('#content');
    $content.find('script, style').remove();
    const content = cleanChapterText(textFromHtml($content.html() || ''));
    return {
      source: this.id,
      title,
      content,
      prevUrl: null,
      nextUrl: null,
      locked: !content,
    };
  },
};

LONGWANGXS.base = 'https://www.longwangxs.cc';

const SOURCES = [BIQUGE_321, SUDUGU, BIQUGIE, LONGWANGXS];
const FALLBACK_ONLY_SOURCES = [FANQIE];

let dynamicGitHubSources = [];

function getAllSources() {
  return [...SOURCES, ...FALLBACK_ONLY_SOURCES, ...dynamicGitHubSources];
}

async function refreshGitHubSources() {
  try {
    dynamicGitHubSources = await githubSourceLoader.loadGitHubSources();
    console.log(`已加载 ${dynamicGitHubSources.length} 个 GitHub 书源`);
  } catch (err) {
    console.error('GitHub 书源加载失败:', err.message);
  }
}

refreshGitHubSources();

function detectSource(url) {
  try {
    const parsed = new URL(url);
    return getAllSources().find((source) => source.match(parsed)) || null;
  } catch {
    return null;
  }
}

function normalizeChapterTitle(title) {
  return String(title || '')
    .replace(/第/g, '')
    .replace(/章/g, '')
    .replace(/[\s卷上下中篇的地得之]/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

function chapterNumberFromTitle(title) {
  const match = String(title || '').match(/第?\s*(\d+)\s*章/);
  return match ? Number(match[1]) : null;
}

const fallbackBookMap = new Map();
const failedSources = new Map();

function getFallbackCache(key) {
  const hit = fallbackBookMap.get(key);
  if (!hit) return undefined;
  const ttl = hit.value ? 10 * 60 * 1000 : 30 * 1000;
  if (Date.now() - hit.time < ttl) return hit.value;
  fallbackBookMap.delete(key);
  return undefined;
}

function setFallbackCache(key, value) {
  fallbackBookMap.set(key, { time: Date.now(), value });
}

function sourceIsDead(sourceId) {
  const time = failedSources.get(sourceId);
  return Boolean(time && Date.now() - time < 5 * 60 * 1000);
}

async function findFallbackBook(bookTitle, primarySourceId) {
  const key = `${bookTitle}::${primarySourceId}`;
  const cachedFallback = getFallbackCache(key);
  if (cachedFallback !== undefined) return cachedFallback;
  const unreliable = UNRELIABLE_BOOK_SOURCES[bookTitle] || [];
  for (const known of KNOWN_BOOK_URLS[bookTitle] || []) {
    if (known.sourceId === primarySourceId || sourceIsDead(known.sourceId)) continue;
    if (unreliable.includes(known.sourceId)) continue;
    const source = getAllSources().find((item) => item.id === known.sourceId);
    if (!source) continue;
    try {
      const detail = await withTimeout(source.book(known.url), 20000, null);
      if (detail && detail.chapters && detail.chapters.length) {
        const entry = { source, book: detail };
        setFallbackCache(key, entry);
        return entry;
      }
      failedSources.set(source.id, Date.now());
    } catch (err) {
      failedSources.set(source.id, Date.now());
    }
  }
  const candidates = getAllSources()
    .filter(
      (source) =>
        source.id !== primarySourceId &&
        !sourceIsDead(source.id) &&
        !unreliable.includes(source.id)
    )
    .slice(0, 5);
  const results = await Promise.allSettled(
    candidates.map(async (source) => {
      try {
        const books = await withTimeout(source.search(bookTitle), 6000, []);
        const book = books.find((item) => item.title === bookTitle) || books[0];
        if (!book) return null;
        const detail = await withTimeout(source.book(book.url), 15000, null);
        if (detail && detail.chapters && detail.chapters.length) {
          return { source, book: detail };
        }
        return null;
      } catch (err) {
        failedSources.set(source.id, Date.now());
        return null;
      }
    })
  );
  const found = results.find((result) => result.status === 'fulfilled' && result.value);
      if (found) {
        setFallbackCache(key, found.value);
        return found.value;
      }
  setFallbackCache(key, null);
  return null;
}

async function tryChapterWithFallback({
  chapterUrl,
  bookTitle,
  chapterTitle,
  index,
  sourceId,
}) {
  const primary =
    detectSource(chapterUrl) || getAllSources().find((source) => source.id === sourceId) || null;
  let primaryData = null;
  let primaryError = null;
  const unreliable = UNRELIABLE_BOOK_SOURCES[bookTitle] || [];
  const skipPrimary = primary && unreliable.includes(primary.id);

  if (primary && !skipPrimary) {
    try {
      const data = await withTimeout(primary.chapter(chapterUrl), 12000, null);
      if (data) {
        primaryData = { ...data, source: primary.id };
      } else {
        primaryError = new Error('章节加载超时');
      }
    } catch (err) {
      primaryError = err;
    }
  } else if (primary && skipPrimary) {
    primaryError = new Error('该源内容错乱，已切换免费源');
  } else {
    primaryError = new Error('未找到对应书源');
  }

  if (
    primaryData &&
    !primaryData.locked &&
    primaryData.content &&
    primaryData.content.length > 200
  ) {
    return primaryData;
  }

  const fallback = await findFallbackBook(bookTitle, primary ? primary.id : sourceId || '');
  if (fallback && !unreliable.includes(fallback.source.id)) {
    const chapters = fallback.book.chapters || [];
    let chapter = chapters.find(
      (item) => normalizeChapterTitle(item.title) === normalizeChapterTitle(chapterTitle)
    );
    if (!chapter) {
      const chapterNumber = chapterNumberFromTitle(chapterTitle);
      if (chapterNumber) {
        chapter = chapters.find(
          (item) => chapterNumberFromTitle(item.title) === chapterNumber
        );
      }
    }
    if (!chapter && Number.isFinite(index) && chapters[index]) chapter = chapters[index];
    if (chapter) {
      try {
        const data = await withTimeout(fallback.source.chapter(chapter.url), 30000, null);
        if (data) {
          if (!data.locked && data.content && data.content.length > 200) {
            return {
              ...data,
              source: fallback.source.id,
              bookUrl: fallback.book.url,
              fallback: true,
              requestedSource: primary ? primary.id : sourceId || '',
            };
          }
          if (!primaryData) {
            return {
              ...data,
              source: fallback.source.id,
              bookUrl: fallback.book.url,
              fallback: true,
              requestedSource: primary ? primary.id : sourceId || '',
            };
          }
        }
      } catch (err) {
        failedSources.set(fallback.source.id, Date.now());
      }
    }
  }

  if (primaryData) return primaryData;
  throw primaryError || new Error('章节加载失败');
}

async function getBookWithFallback(rawUrl) {
  const source = detectSource(rawUrl);
  if (!source) throw new Error('暂不支持该来源链接');
  try {
    return await cached(`book:${source.id}:${rawUrl}`, 10 * 60 * 1000, () =>
      source.book(rawUrl)
    );
  } catch (err) {
    for (const [bookTitle, entries] of Object.entries(KNOWN_BOOK_URLS)) {
      if (!entries.some((entry) => entry.url === rawUrl)) continue;
      const fallback = await findFallbackBook(bookTitle, source.id);
      if (fallback) return fallback.book;
    }
    throw err;
  }
}

async function cacheChapterRange(bookUrl, bookTitle, chapters) {
  if (findCacheJobByKey(cacheKey(bookUrl))) return { skipped: true };
  const existingFile = await readBookCache(bookUrl);
  const wasCompleted = existingFile ? existingFile.completed : false;
  const chapterMap = new Map(
    (existingFile && existingFile.chapters ? existingFile.chapters : []).map((chapter) => [
      chapter.url,
      chapter,
    ])
  );
  const sourceId = detectSource(bookUrl) ? detectSource(bookUrl).id : '';
  const unreliable = UNRELIABLE_BOOK_SOURCES[bookTitle] || [];

  for (const chapter of chapters) {
    if (!chapter || !chapter.url) continue;
    const existing = chapterMap.get(chapter.url);
    if (
      existing &&
      !existing.locked &&
      existing.content &&
      !unreliable.includes(existing.source)
    ) {
      continue;
    }
    try {
      const data = await tryChapterWithFallback({
        chapterUrl: chapter.url,
        bookTitle: bookTitle || '',
        chapterTitle: chapter.title || '',
        index: null,
        sourceId,
      });
      chapterMap.set(chapter.url, {
        title: data.title || chapter.title || '',
        url: chapter.url,
        source: data.source || sourceId,
        needPay: 0,
        locked: !!data.locked,
        content: data.content || '',
        cachedAt: Date.now(),
      });
    } catch (err) {
      chapterMap.set(chapter.url, {
        title: chapter.title || '',
        url: chapter.url,
        source: sourceId,
        needPay: 0,
        locked: true,
        content: '',
        cachedAt: Date.now(),
      });
    }
  }

  const file = existingFile || {
    book: { url: bookUrl, title: bookTitle || '', source: sourceId },
    chapters: [],
    completed: false,
    cachedAt: Date.now(),
  };
  file.book = {
    ...(file.book || {}),
    url: bookUrl,
    title: bookTitle || (file.book && file.book.title) || '',
    source: sourceId || (file.book && file.book.source) || '',
  };
  file.chapters = Array.from(chapterMap.values());
  file.completed = wasCompleted;
  file.cachedAt = Date.now();
  await writeBookCache(bookUrl, file);
  return { cached: chapters.length };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleApi(parsed, res, method) {
  const route = parsed.pathname.slice('/api'.length) || '/';

  if (route === '/sources') {
    sendJson(
      res,
      200,
      SOURCES.map((s) => ({ id: s.id, name: s.name }))
    );
    return;
  }

  if (route === '/sources/github') {
    sendJson(res, 200, {
      count: dynamicGitHubSources.length,
      sources: dynamicGitHubSources.map((s) => ({ id: s.id, name: s.name, url: s.base })),
    });
    return;
  }

  if (route === '/search') {
    const query = (parsed.searchParams.get('q') || '').trim();
    const sourceId = parsed.searchParams.get('source') || '';
    if (!query) throw new Error('请输入搜索关键词');
    const sources = sourceId
      ? SOURCES.filter((s) => s.id === sourceId)
      : SOURCES;
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          const books = await source.search(query);
          return { source: source.id, books, error: '' };
        } catch (err) {
          return { source: source.id, books: [], error: err.message };
        }
      })
    );
    const seen = new Set();
    const books = [];
    for (const result of results) {
      for (const book of result.books) {
        const key = `${book.source}:${book.title}:${book.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        books.push(book);
      }
    }
    sendJson(res, 200, {
      query,
      books,
      errors: results.filter((r) => r.error).map((r) => ({ source: r.source, message: r.error })),
    });
    return;
  }

  if (route === '/book') {
    const rawUrl = parsed.searchParams.get('url');
    if (!rawUrl) throw new Error('缺少书籍链接');
    const book = await getBookWithFallback(rawUrl);
    sendJson(res, 200, book);
    return;
  }

  if (route === '/chapter') {
    const rawUrl = parsed.searchParams.get('url');
    if (!rawUrl) throw new Error('缺少章节链接');
    const bookUrl = parsed.searchParams.get('bookUrl') || '';
    const bookTitle = parsed.searchParams.get('bookTitle') || '';
    const chapterTitle = parsed.searchParams.get('chapterTitle') || '';
    const chapterIndex = Number(parsed.searchParams.get('index')) || 0;
    let cachedChapter = null;
    let cachedBookSource = '';
    if (bookUrl) {
      const cachedData = await readBookCache(bookUrl);
      if (cachedData && cachedData.chapters) {
        const index = cachedData.chapters.findIndex((chapter) => chapter.url === rawUrl);
        if (index >= 0) {
          const chapter = cachedData.chapters[index];
          cachedBookSource = cachedData.book ? cachedData.book.source : '';
          const unreliable = UNRELIABLE_BOOK_SOURCES[bookTitle] || [];
          const cachedSource = chapter.source || cachedBookSource;
          if (unreliable.includes(cachedSource)) {
            cachedChapter = null;
          } else if (!chapter.locked && chapter.content) {
            sendJson(res, 200, {
              source: cachedSource,
              title: chapter.title,
              content: chapter.content || '',
              prevUrl: index > 0 ? cachedData.chapters[index - 1].url : null,
              nextUrl:
                index < cachedData.chapters.length - 1
                  ? cachedData.chapters[index + 1].url
                  : null,
              locked: false,
              cached: true,
              bookUrl,
            });
            return;
          } else {
            cachedChapter = chapter;
          }
        }
      }
    }
    const source = detectSource(rawUrl);
    if (!source && !cachedChapter) throw new Error('暂不支持该来源链接');
    let chapter;
    try {
      chapter = await tryChapterWithFallback({
        chapterUrl: rawUrl,
        bookTitle,
        chapterTitle,
        index: chapterIndex,
        sourceId: source ? source.id : '',
      });
    } catch (err) {
      if (cachedChapter) {
        sendJson(res, 200, {
          source: cachedChapter.source || cachedBookSource,
          title: cachedChapter.title,
          content: cachedChapter.content || '',
          prevUrl: null,
          nextUrl: null,
          locked: true,
          cached: true,
          bookUrl,
        });
        return;
      }
      throw err;
    }
    if (bookUrl) chapter.bookUrl = bookUrl;
    if (chapter.fallback && bookUrl) {
      await updateCachedChapter(bookUrl, rawUrl, chapter);
    }
    sendJson(res, 200, chapter);
    return;
  }

  if (route === '/cache/status') {
    const urlParam = parsed.searchParams.get('url') || '';
    const jobId = parsed.searchParams.get('jobId') || '';
    if (jobId) {
      const job = [...cacheJobs.values()].find((item) => item.id === jobId) || null;
      sendJson(res, 200, { job: job ? publicCacheJob(job) : null });
      return;
    }
    if (!urlParam) throw new Error('缺少书籍链接');
    const job = findCacheJobByKey(cacheKey(urlParam));
    const file = await readBookCache(urlParam);
    sendJson(res, 200, {
      job: job ? publicCacheJob(job) : null,
      cached: file
        ? {
            completed: !!file.completed,
            total: (file.chapters || []).length,
            locked: file.locked || (file.chapters || []).filter((chapter) => chapter.locked).length,
            failed: file.failed || 0,
            cachedAt: file.cachedAt,
          }
        : null,
    });
    return;
  }

  if (route === '/cache/start') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: '请使用 POST' });
      return;
    }
    const urlParam = parsed.searchParams.get('url');
    if (!urlParam) throw new Error('缺少书籍链接');
    const jobId = await startCacheJob(urlParam);
    sendJson(res, 200, { jobId });
    return;
  }

  if (route === '/cache/range') {
    if (method !== 'POST') {
      sendJson(res, 405, { error: '请使用 POST' });
      return;
    }
    const urlParam = parsed.searchParams.get('url');
    if (!urlParam) throw new Error('缺少书籍链接');
    const title = parsed.searchParams.get('title') || '';
    let chapters = [];
    try {
      chapters = JSON.parse(parsed.searchParams.get('chapters') || '[]');
    } catch {
      chapters = [];
    }
    if (!Array.isArray(chapters) || !chapters.length) {
      throw new Error('缺少章节列表');
    }
    cacheChapterRange(urlParam, title, chapters).catch((err) => {
      console.error('自动缓存章节失败:', err.message);
    });
    sendJson(res, 200, { started: true, count: chapters.length });
    return;
  }

  if (route === '/cache/remove') {
    if (method !== 'DELETE' && method !== 'POST') {
      sendJson(res, 405, { error: '请使用 DELETE' });
      return;
    }
    const urlParam = parsed.searchParams.get('url');
    if (!urlParam) throw new Error('缺少书籍链接');
    const job = findCacheJobByKey(cacheKey(urlParam));
    if (job) {
      sendJson(res, 409, { error: '缓存任务进行中，无法清除' });
      return;
    }
    try {
      await fs.unlink(cacheFilePath(urlParam));
    } catch {
      // no cache file to remove
    }
    sendJson(res, 200, { removed: true });
    return;
  }

  sendJson(res, 404, { error: '接口不存在' });
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, rel);
  const root = path.resolve(PUBLIC_DIR);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (parsed.pathname.startsWith('/api/')) {
      await handleApi(parsed, res, req.method);
    } else {
      await serveStatic(req, res, parsed.pathname);
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message || '服务器错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`笔趣阁小说网站已启动: http://${HOST}:${PORT}`);
});
