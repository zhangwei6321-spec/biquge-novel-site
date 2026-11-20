'use strict';

const cheerio = require('cheerio');

const GITHUB_SOURCE_FILES = [
  'https://cdn.jsdelivr.net/gh/entr0pia/MyLegadoSource@master/bookSource.json',
  'https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan',
];

const PAID_SOURCE_PATTERN =
  /会员|付费|收费|vip|VIP|订阅|购买|充值|正版|需登录|起点|晋江|番茄|掌阅|咪咕|qq阅读|红袖|潇湘|纵横|飞卢|17k|书旗/i;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function textFromHtml(html) {
  const $ = cheerio.load(html, null, false);
  $('script, style, noscript, iframe').remove();
  $('br').replaceWith('\n');
  $('p, div, h1, h2, h3, li, blockquote').after('\n');
  return $.root().text();
}

function cleanChapterText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/一秒记住|请收藏本站|手机用户请|手机站|无弹窗|biquge321\.com|bgg99\.com|piquge\.com|biqugie\.com|看后求收藏/.test(
          line
        )
    )
    .join('\n');
}

function parseSelector(selector) {
  const match = selector.match(/^(.+?)\.(\d+)$/);
  if (match && !match[1].match(/[.#\s]$/)) {
    return { selector: match[1], index: Number(match[2]) };
  }
  return { selector, index: 0 };
}

function queryNodes(context, selector) {
  if (typeof context === 'function') return context(selector);
  return context.find(selector);
}

function applyLegadoRule(context, rule) {
  const parts = String(rule || '').split('&&');
  const values = [];
  for (const partRaw of parts) {
    let part = partRaw.trim();
    if (!part) continue;

    let regex = null;
    const hashIndex = part.indexOf('##');
    if (hashIndex !== -1) {
      const regexSpec = part.slice(hashIndex + 2);
      part = part.slice(0, hashIndex).trim();
      const sep = regexSpec.indexOf('|');
      const pattern = sep === -1 ? regexSpec : regexSpec.slice(0, sep);
      const replacement = sep === -1 ? '' : regexSpec.slice(sep + 1);
      if (pattern) regex = { pattern, replacement };
    }

    if (part.startsWith('@css:')) part = part.slice(5);
    const at = part.lastIndexOf('@');
    let selector = part;
    let action = 'text';
    if (at !== -1) {
      selector = part.slice(0, at).trim();
      action = part.slice(at + 1).trim();
    }
    if (!selector) continue;

    const parsed = parseSelector(selector);
    let nodes;
    try {
      nodes = queryNodes(context, parsed.selector);
    } catch {
      continue;
    }
    const node = nodes.eq(parsed.index);
    if (!node.length) continue;

    let value = '';
    if (action === 'text' || action === 'textNodes') {
      value = node.text();
    } else if (action === 'html') {
      value = node.html() || '';
    } else if (action === 'all') {
      value = node.parent().html() || node.html() || '';
    } else if (action === 'href' || action === 'src') {
      value = node.attr(action) || '';
    } else if (action.startsWith('data-')) {
      value = node.attr(action) || '';
    } else {
      value = node.attr(action) || node.text();
    }

    if (regex) {
      try {
        value = value.replace(new RegExp(regex.pattern, 'g'), regex.replacement);
      } catch {
        // keep original value
      }
    }
    const trimmed = value.trim();
    if (trimmed) values.push(trimmed);
  }
  return values.join(' ');
}

function selectLegadoNodes(context, rule) {
  let selector = String(rule || '').trim();
  if (selector.startsWith('@css:')) selector = selector.slice(5);
  const at = selector.indexOf('@');
  if (at !== -1) selector = selector.slice(0, at).trim();
  if (!selector) return [];
  try {
    return queryNodes(context, selector).toArray();
  } catch {
    return [];
  }
}

function legadoUsesJs(source) {
  const blob = JSON.stringify(source);
  return blob.includes('@js:') || blob.includes('@json:');
}

function isPaidSource(source) {
  const blob = [
    source.bookSourceName || '',
    source.bookSourceGroup || '',
    source.bookSourceComment || '',
  ].join(' ');
  return PAID_SOURCE_PATTERN.test(blob);
}

function buildLegadoRequest(source, template, vars) {
  const rendered = String(template || '')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key === 'key' || key === 'searchKey') return encodeURIComponent(vars.key || '');
      if (key === 'page') return String(vars.page || 1);
      return String(vars[key] ?? '');
    })
    .trim();

  let url = rendered;
  let config = {};
  const configIndex = rendered.lastIndexOf(',{');
  if (configIndex !== -1) {
    try {
      config = JSON.parse(rendered.slice(configIndex + 1));
      url = rendered.slice(0, configIndex).trim();
    } catch {
      // treat the whole string as URL
    }
  }
  return { url: resolveUrl(url, source.base), config };
}

async function legadoFetch(url, config) {
  const method = String(config.method || 'GET').toUpperCase();
  const headers = {};
  if (config.header && typeof config.header === 'object') {
    Object.assign(headers, config.header);
  }
  try {
    if (!headers.Referer) headers.Referer = new URL(url).origin;
  } catch {
    // keep headers as-is
  }
  return fetchText(url, {
    method,
    headers,
    body: method === 'POST' ? config.body : undefined,
    timeout: 6000,
  });
}

function createLegadoSource(src, index) {
  if (!src || src.bookSourceType !== 0 || src.enabled === false) return null;
  if (isPaidSource(src)) return null;
  const base = String(src.bookSourceUrl || '').split('#')[0].replace(/\/+$/, '');
  if (!/^https?:/.test(base)) return null;
  if (!src.searchUrl || !src.ruleSearch || !src.ruleSearch.bookList || !src.ruleSearch.bookUrl) {
    return null;
  }
  if (!src.ruleToc || !src.ruleToc.chapterList || !src.ruleToc.chapterUrl) return null;
  if (!src.ruleContent || !src.ruleContent.content) return null;
  if (legadoUsesJs(src)) return null;

  const id = `gh-${index}-${base.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;

  return {
    id,
    name: src.bookSourceName || base,
    base,
    match(url) {
      try {
        return new URL(url).hostname === new URL(base).hostname;
      } catch {
        return false;
      }
    },

    async search(query) {
      const { url, config } = buildLegadoRequest(this, src.searchUrl, { key: query });
      const html = await legadoFetch(url, config);
      const $ = cheerio.load(html);
      const rule = src.ruleSearch || {};
      const books = [];
      for (const node of selectLegadoNodes($, rule.bookList)) {
        const $el = $(node);
        const bookUrl = applyLegadoRule($el, rule.bookUrl);
        if (!bookUrl) continue;
        const title = applyLegadoRule($el, rule.name) || '';
        if (!title) continue;
        books.push({
          id: bookUrl,
          source: this.id,
          title,
          author: applyLegadoRule($el, rule.author),
          cover: applyLegadoRule($el, rule.coverUrl),
          description: applyLegadoRule($el, rule.intro),
          status: applyLegadoRule($el, rule.kind),
          latest: applyLegadoRule($el, rule.lastChapter),
          url: resolveUrl(bookUrl, this.base),
        });
      }
      return books;
    },

    async book(url) {
      const html = await fetchText(url);
      const $ = cheerio.load(html);
      const infoRule = src.ruleBookInfo || {};
      const tocRule = src.ruleToc || {};
      const title =
        applyLegadoRule($, infoRule.name) ||
        $('h1').first().text().trim() ||
        $('title').text().split('_')[0].trim();
      const author = applyLegadoRule($, infoRule.author);
      const cover = applyLegadoRule($, infoRule.coverUrl);
      const description = applyLegadoRule($, infoRule.intro);
      const status = applyLegadoRule($, infoRule.kind);
      const latest = applyLegadoRule($, infoRule.lastChapter);

      let chapters = [];
      const listRule = tocRule.chapterList;
      if (listRule) {
        for (const node of selectLegadoNodes($, listRule)) {
          const $el = $(node);
          const chapterUrl = applyLegadoRule($el, tocRule.chapterUrl);
          if (!chapterUrl) continue;
          chapters.push({
            title: applyLegadoRule($el, tocRule.chapterName) || '',
            url: resolveUrl(chapterUrl, url),
          });
        }
      }

      if (!chapters.length && infoRule.tocUrl) {
        const tocValue = applyLegadoRule($, infoRule.tocUrl);
        if (tocValue && !tocValue.includes('{{')) {
          try {
            const tocUrl = resolveUrl(tocValue, url);
            const tocHtml = await fetchText(tocUrl);
            const $toc = cheerio.load(tocHtml);
            for (const node of selectLegadoNodes($toc, listRule)) {
              const $el = $(node);
              const chapterUrl = applyLegadoRule($el, tocRule.chapterUrl);
              if (!chapterUrl) continue;
              chapters.push({
                title: applyLegadoRule($el, tocRule.chapterName) || '',
                url: resolveUrl(chapterUrl, tocUrl),
              });
            }
          } catch {
            // toc page failed
          }
        }
      }

      return {
        source: this.id,
        title,
        author,
        cover,
        description,
        status,
        latest: latest || (chapters.length ? chapters[chapters.length - 1].title : ''),
        url,
        chapters,
      };
    },

    async chapter(url) {
      const html = await fetchText(url);
      const $ = cheerio.load(html);
      const contentRule = src.ruleContent || {};
      const rawContent = applyLegadoRule($, contentRule.content);
      const content = cleanChapterText(textFromHtml(`<div>${rawContent}</div>`));
      const title = applyLegadoRule($, 'h1@text') || $('title').text().split('_')[0].trim();
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
}

let loaded = { time: 0, sources: [] };

async function loadGitHubSources(force = false) {
  if (!force && loaded.sources.length && Date.now() - loaded.time < 30 * 60 * 1000) {
    return loaded.sources;
  }
  const results = await Promise.allSettled(
    GITHUB_SOURCE_FILES.map((file) =>
      fetchText(file, { timeout: 25000 }).then((text) => JSON.parse(text))
    )
  );
  const rawSources = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      rawSources.push(...result.value);
    }
  }

  const seen = new Set();
  const sources = [];
  rawSources.forEach((src, index) => {
    const created = createLegadoSource(src, index);
    if (!created) return;
    if (seen.has(created.base)) return;
    seen.add(created.base);
    sources.push(created);
  });

  loaded = { time: Date.now(), sources };
  return sources;
}

module.exports = { loadGitHubSources };
