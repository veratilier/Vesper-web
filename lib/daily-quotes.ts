import { ensureSchema, getDb } from './db';
import { env } from 'cloudflare:workers';
import { sendPushBatch, type PushSubscriptionData } from '@mmmike/web-push/send';
import { publicImageURL } from './bookmarks';

type Row = { id: string; day: string; value: string; kept: number; created_at: string };
type CommentRow = { id: string; card_id: string; author: string; body: string; created_at: string };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const quoteCategories = ['哲学', '轻文学', '诗歌', '散文', '小说'] as const;
function isQuoteCategory(value: unknown): value is typeof quoteCategories[number] {
  return typeof value === 'string' && (quoteCategories as readonly string[]).includes(value);
}
function localDay(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function cleanCategories(value: unknown) {
  if (!Array.isArray(value) || value.length > quoteCategories.length || value.some(v => typeof v !== 'string' || !quoteCategories.includes(v as typeof quoteCategories[number]))) throw new Error('Choose known quote categories');
  return [...new Set(value as string[])];
}
async function preferences(owner: string) {
  const row = await getDb().prepare('SELECT categories,notify,daily_count FROM vesper_quote_preferences WHERE user_id=?').bind(owner).first<{categories:string;notify:number;daily_count:number}>();
  const saved = row ? JSON.parse(row.categories) as unknown : [];
  // Older settings were mood labels. Ignore those labels so an obsolete filter
  // never leaves the new genre catalogue empty.
  const categories = Array.isArray(saved) ? saved.filter(isQuoteCategory) : [];
  return { categories, notify: row ? Boolean(row.notify) : true, dailyCount: row ? row.daily_count : 3 };
}
async function quoteProof(owner: string, kind: string, value: string) {
  const secret = (env as { VESPER_APP_TOKEN?: string }).VESPER_APP_TOKEN;
  if (!secret) throw new Error('Quote verification is unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${owner}\n${localDay()}\n${kind}\n${value}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}
function plainText(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ').trim();
}
async function wikisource(params: URLSearchParams) {
  params.set('format', 'json');
  const response = await fetch('https://zh.wikisource.org/w/api.php?' + params, {
    headers: { 'User-Agent': 'VesperQuote/1.0 (personal literary cards; contact admin@r-vera.com)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Quote source search is unavailable');
  return await response.json() as { query?: { search?: Array<{title:string;snippet:string}> }; parse?: {title:string;text:string}; error?: {info:string} };
}
export async function searchQuoteSources(owner: string, query: unknown) {
  if (typeof query !== 'string' || !query.trim() || query.length > 80) throw new Error('Use a short source search phrase');
  const data = await wikisource(new URLSearchParams({ action:'query', list:'search', srsearch:query.trim(), srnamespace:'0', srlimit:'8', srprop:'snippet' }));
  return { results: await Promise.all((data.query?.search || []).map(async hit => ({
    title: hit.title, snippet: plainText(hit.snippet).slice(0, 240),
    titleProof: await quoteProof(owner, 'source-title', hit.title),
  }))), preferences: await preferences(owner), today: localDay() };
}
export async function readQuoteSource(owner: string, title: unknown, titleProof: unknown) {
  if (typeof title !== 'string' || !title || title.length > 180 || titleProof !== await quoteProof(owner, 'source-title', title)) throw new Error('Search for this source first');
  const data = await wikisource(new URLSearchParams({ action:'parse', page:title, prop:'text', formatversion:'2', redirects:'1' }));
  if (!data.parse?.text || data.error) throw new Error('Source page could not be read');
  const paragraphs = [...data.parse.text.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => plainText(match[1]).slice(0, 600)).filter(value => value.length >= 20).slice(0, 12);
  if (!paragraphs.length) throw new Error('Source has no readable excerpt; search another work');
  return { title: data.parse.title, sourceURL: `https://zh.wikisource.org/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, '_'))}`,
    paragraphs: await Promise.all(paragraphs.map(async text => ({ text, paragraphProof: await quoteProof(owner, 'source-paragraph', `${data.parse!.title}\n${text}`) }))) };
}

type CommonsPage = { title?: string; imageinfo?: Array<{ mime?: string; thumburl?: string; descriptionurl?: string; extmetadata?: Record<string,{value?:string}> }> };
function commonsImage(page: CommonsPage) {
  const info = page.imageinfo?.[0], licence = info?.extmetadata?.LicenseShortName?.value || '';
  if (!page.title?.startsWith('File:') || !info?.thumburl?.startsWith('https://') ||
      !info?.descriptionurl?.startsWith('https://commons.wikimedia.org/') ||
      !['image/jpeg','image/png','image/webp'].includes(info.mime || '') ||
      !/^(Public domain|CC0)( |$)/i.test(licence)) return null;
  return { fileTitle: page.title, imageUrl: info.thumburl, imageSource: `${page.title.slice(5)} · ${licence} · Wikimedia Commons`,
    imagePageURL: info.descriptionurl, licence };
}
async function commons(params: URLSearchParams) {
  params.set('action','query'); params.set('format','json'); params.set('prop','imageinfo');
  params.set('iiprop','url|mime|extmetadata'); params.set('iiurlwidth','960');
  params.set('iiextmetadatafilter','LicenseShortName');
  const response = await fetch('https://commons.wikimedia.org/w/api.php?' + params, {
    headers: { 'User-Agent': 'VesperQuote/1.0 (personal daily literary cards; contact admin@r-vera.com)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Image search is unavailable');
  return await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
}
async function searchProof(owner: string, fileTitle: string, day = localDay()) {
  const secret = (env as { VESPER_APP_TOKEN?: string }).VESPER_APP_TOKEN;
  if (!secret) throw new Error('Image search verification is unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`${owner}\n${day}\n${fileTitle}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function searchQuoteImages(owner: string, query: unknown) {
  if (typeof query !== 'string' || !query.trim() || query.length > 100) throw new Error('Use a short image search phrase');
  const params = new URLSearchParams({ generator:'search', gsrnamespace:'6', gsrsearch: query.trim() + ' public domain', gsrlimit:'30' });
  const response = await commons(params);
  const images = Object.values(response.query?.pages || {}).map(commonsImage).filter(v => v !== null).slice(0, 8);
  return { images: await Promise.all(images.map(async image => ({ ...image,
    searchProof: await searchProof(owner, image.fileTitle) }))) };
}
async function resolveQuoteImage(fileTitle: unknown) {
  if (typeof fileTitle !== 'string' || !fileTitle.startsWith('File:') || fileTitle.length > 250) throw new Error('Choose a real image from search');
  const response = await commons(new URLSearchParams({ titles: fileTitle }));
  const image = Object.values(response.query?.pages || {}).map(commonsImage).find(v => v?.fileTitle === fileTitle);
  if (!image) throw new Error('Image or its public-domain licence could not be verified');
  return image;
}
async function comments(owner: string, ids: string[]) {
  if (!ids.length) return {} as Record<string, CommentRow[]>;
  const rows = await getDb().prepare(`SELECT id,card_id,author,body,created_at FROM vesper_quote_comments WHERE user_id=? AND card_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`)
    .bind(owner, ...ids).all<CommentRow>();
  const result: Record<string, CommentRow[]> = {};
  for (const row of rows.results) (result[row.card_id] ??= []).push(row);
  return result;
}
export async function listDailyQuotes(owner: string) {
  await ensureSchema();
  const config = await preferences(owner), today = localDay();
  const rows = await getDb().prepare('SELECT id,day,value,kept,created_at FROM vesper_daily_quotes WHERE user_id=? ORDER BY day DESC,id DESC LIMIT 90').bind(owner).all<Row>();
  const notes = await comments(owner, rows.results.map(row => row.id));
  return { cards: rows.results.map(row => {
    const card = JSON.parse(row.value);
    return { ...card, category: isQuoteCategory(card.category) ? card.category : '诗歌',
      kept: Boolean(row.kept), comments: notes[row.id] || [] };
  }),
    occupiedIds: [...rows.results.map(row => row.id), ...(await getDb().prepare('SELECT id FROM vesper_quote_deletions WHERE user_id=? AND day=?').bind(owner,today).all<{id:string}>()).results.map(row => row.id)],
    preferences: config, today };
}
export async function deleteDailyQuote(owner: string, cardId: unknown) {
  await ensureSchema();
  if (typeof cardId !== 'string' || !idPattern.test(cardId)) throw new Error('Invalid daily quote');
  const row = await getDb().prepare('SELECT id,day FROM vesper_daily_quotes WHERE user_id=? AND id=?').bind(owner,cardId).first<{id:string;day:string}>();
  if (!row) {
    const deleted = await getDb().prepare('SELECT id FROM vesper_quote_deletions WHERE user_id=? AND id=?').bind(owner,cardId).first();
    if (!deleted) throw new Error('Daily quote not found');
    return { cardId, deleted: true };
  }
  await getDb().batch([
    getDb().prepare('INSERT OR IGNORE INTO vesper_quote_deletions(user_id,id,day,deleted_at) VALUES(?,?,?,?)').bind(owner,cardId,row.day,new Date().toISOString()),
    getDb().prepare('DELETE FROM vesper_quote_comments WHERE user_id=? AND card_id=?').bind(owner,cardId),
    getDb().prepare('DELETE FROM vesper_daily_quotes WHERE user_id=? AND id=?').bind(owner,cardId),
  ]);
  return { cardId, deleted: true };
}
export async function editDailyQuote(owner: string, input: Record<string, unknown>) {
  await ensureSchema();
  const id = input.id;
  if (typeof id !== 'string' || !idPattern.test(id) || !['create','update'].includes(String(input.action))) throw new Error('Invalid Hitokoto action or id');
  const existing = await getDb().prepare('SELECT value FROM vesper_daily_quotes WHERE user_id=? AND id=?').bind(owner,id).first<{value:string}>();
  if (input.action === 'update' && !existing) throw new Error('Hitokoto card not found');
  if (await getDb().prepare('SELECT id FROM vesper_quote_deletions WHERE user_id=? AND id=?').bind(owner,id).first()) throw new Error('This card was deleted');
  const previous: Record<string, unknown> = existing ? JSON.parse(existing.value) : {};
  const field = (name: string, max: number, fallback = '') => {
    const value = input[name] === undefined ? (previous[name] ?? fallback) : input[name];
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid ' + name);
    return value.trim();
  };
  const text = field('text', 2000), source = field('source', 240, 'Ash');
  if (!text) throw new Error('A card needs text');
  const category = input.category === undefined ? (previous.category ?? '轻文学') : input.category;
  if (!isQuoteCategory(category)) throw new Error('Choose a valid category');
  const imageUrl = publicImageURL(field('imageUrl', 2048));
  const sourceURL = publicImageURL(field('sourceURL', 2048));
  const imageSource = field('imageSource', 2048);
  const day = typeof previous.day === 'string' ? previous.day : localDay();
  const createdAt = typeof previous.createdAt === 'string' ? previous.createdAt : new Date().toISOString();
  const card: Record<string, unknown> = { ...previous, id, day, text, source, sourceURL, category, imageUrl, imageSource, createdAt, author: previous.author || 'Ash' };
  if (input.imageUrl !== undefined && imageUrl !== previous.imageUrl) {
    delete card.imagePageURL; delete card.licence; delete card.fileTitle;
  }
  if (input.action === 'create') {
    if (existing) {
      if (['text','source','sourceURL','category','imageUrl','imageSource'].some(key => previous[key] !== card[key as keyof typeof card])) throw new Error('This id belongs to another card');
      return { card: previous };
    }
    await getDb().prepare('INSERT INTO vesper_daily_quotes(user_id,id,day,value,created_at) VALUES(?,?,?,?,?)').bind(owner,id,day,JSON.stringify(card),createdAt).run();
  } else {
    await getDb().prepare('UPDATE vesper_daily_quotes SET value=? WHERE user_id=? AND id=?').bind(JSON.stringify(card),owner,id).run();
  }
  return { card };
}
export async function publishDailyQuote(owner: string, input: Record<string,unknown>) {
  await ensureSchema();
  const config = await preferences(owner), day = input.day, slot = input.slot;
  if (typeof day !== 'string' || day !== localDay() || !Number.isInteger(slot) || Number(slot) < 0 || Number(slot) >= config.dailyCount ||
      !isQuoteCategory(input.category)) throw new Error('Choose a current quote slot and category');
  if (config.categories.length && !config.categories.includes(input.category)) throw new Error('Quote does not match the saved categories');
  const title = input.sourceTitle, paragraph = input.paragraph, excerpt = input.text;
  if (typeof title !== 'string' || !title || title.length > 180 || typeof paragraph !== 'string' || paragraph.length > 1500 ||
      typeof excerpt !== 'string' || excerpt.length < 8 || excerpt.length > 120 || !paragraph.includes(excerpt) ||
      input.paragraphProof !== await quoteProof(owner, 'source-paragraph', `${title}\n${paragraph}`)) throw new Error('Choose an exact short excerpt from a source read today');
  const quote = { text: excerpt, source: title, category: input.category,
    sourceURL: `https://zh.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
  const previous = await getDb().prepare('SELECT value FROM vesper_daily_quotes WHERE user_id=? ORDER BY day DESC,id DESC LIMIT 90').bind(owner).all<{value:string}>();
  if (previous.results.some(row => { const card = JSON.parse(row.value); return card.text === excerpt && card.id !== `${day}-${slot}`; })) throw new Error('This quote was already shared; choose another source');
  const expectedProof = await searchProof(owner, String(input.fileTitle || ''), day);
  if (typeof input.searchProof !== 'string' || input.searchProof !== expectedProof) {
    throw new Error('Search for this real image before publishing');
  }
  const image = await resolveQuoteImage(input.fileTitle);
  const id = day + '-' + slot, createdAt = new Date().toISOString();
  if (await getDb().prepare('SELECT id FROM vesper_quote_deletions WHERE user_id=? AND id=?').bind(owner,id).first()) throw new Error('This deleted slot cannot be republished');
  const value = { id, day, slot, ...quote, ...image, createdAt, author: 'Ash' };
  const inserted = await getDb().prepare('INSERT OR IGNORE INTO vesper_daily_quotes(user_id,id,day,value,created_at) VALUES(?,?,?,?,?)')
    .bind(owner, id, day, JSON.stringify(value), createdAt).run();
  const saved = await getDb().prepare('SELECT value FROM vesper_daily_quotes WHERE user_id=? AND id=?').bind(owner,id).first<{value:string}>();
  if (!saved) throw new Error('Daily quote was not saved');
  const card = JSON.parse(saved.value);
  if (card.text !== value.text || card.fileTitle !== value.fileTitle) throw new Error('This slot already contains another card');
  let pushDelivered = 0;
  if (inserted.meta.changes && config.notify) {
    try {
      const settings = env as { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
      if (settings.VAPID_PUBLIC_KEY && settings.VAPID_PRIVATE_KEY) {
        const rows = await getDb().prepare('SELECT subscription FROM vesper_push_subscriptions').all<{subscription:string}>();
        if (rows.results.length) {
          const result = await sendPushBatch(rows.results.map(row => JSON.parse(row.subscription) as PushSubscriptionData),
            { title: 'Ash 的 Hitokoto', body: card.text, tag: 'vesper-daily-quote-' + id,
              url: '/?section=bookmarks' },
            { publicKey: settings.VAPID_PUBLIC_KEY, privateKey: settings.VAPID_PRIVATE_KEY,
              subject: settings.VAPID_SUBJECT || 'mailto:admin@r-vera.com' });
          pushDelivered = result.delivered;
          for (const endpoint of result.gone) await getDb().prepare('DELETE FROM vesper_push_subscriptions WHERE endpoint=?').bind(endpoint).run();
        }
      }
    } catch { /* A saved card must stay published if notification delivery fails. */ }
  }
  return { card, notify: config.notify, pushDelivered };
}
export async function setQuotePreferences(owner: string, input: Record<string, unknown>) {
  await ensureSchema();
  const current = await preferences(owner);
  const categories = input.categories === undefined ? current.categories : cleanCategories(input.categories);
  const notify = input.notify === undefined ? current.notify : input.notify;
  const dailyCount = input.dailyCount === undefined ? current.dailyCount : input.dailyCount;
  if (typeof notify !== 'boolean') throw new Error('notify must be a boolean');
  if (!Number.isInteger(dailyCount) || Number(dailyCount) < 1 || Number(dailyCount) > 5) throw new Error('Choose 1–5 daily quotes');
  await getDb().prepare(`INSERT INTO vesper_quote_preferences(user_id,categories,notify,daily_count,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET categories=excluded.categories,notify=excluded.notify,daily_count=excluded.daily_count,updated_at=excluded.updated_at`)
    .bind(owner, JSON.stringify(categories), notify ? 1 : 0, dailyCount, new Date().toISOString()).run();
  return { categories, notify, dailyCount };
}
export async function keepDailyQuote(owner: string, cardId: string, kept: unknown) {
  await ensureSchema();
  if (!idPattern.test(cardId) || typeof kept !== 'boolean') throw new Error('Invalid daily quote');
  const changed = await getDb().prepare('UPDATE vesper_daily_quotes SET kept=? WHERE user_id=? AND id=?').bind(kept ? 1 : 0, owner, cardId).run();
  if (!changed.meta.changes) throw new Error('Daily quote not found');
  return { cardId, kept };
}
export async function commentDailyQuote(owner: string, input: Record<string, unknown>, author: 'Vera' | 'Ash') {
  await ensureSchema();
  const cardId = input.cardId, id = input.id, body = input.body;
  if (typeof cardId !== 'string' || !idPattern.test(cardId) || typeof id !== 'string' || !idPattern.test(id) || typeof body !== 'string' || !body.trim() || body.length > 2000) throw new Error('Invalid daily quote comment');
  const exists = await getDb().prepare('SELECT id FROM vesper_daily_quotes WHERE user_id=? AND id=?').bind(owner, cardId).first();
  if (!exists) throw new Error('Daily quote not found');
  const created = new Date().toISOString();
  await getDb().prepare('INSERT OR IGNORE INTO vesper_quote_comments(id,user_id,card_id,author,body,created_at) VALUES(?,?,?,?,?,?)')
    .bind(id, owner, cardId, author, body.trim(), created).run();
  const saved = await getDb().prepare('SELECT id,card_id,author,body,created_at FROM vesper_quote_comments WHERE user_id=? AND id=?').bind(owner,id).first<CommentRow>();
  if (!saved || saved.card_id !== cardId || saved.body !== body.trim() || saved.author !== author) throw new Error('Comment ID already belongs to another comment');
  return { comment: saved };
}
