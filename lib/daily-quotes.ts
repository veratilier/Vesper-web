import { ensureSchema, getDb } from './db';
import { env } from 'cloudflare:workers';
import { sendPushBatch, type PushSubscriptionData } from '@mmmike/web-push/send';

type Quote = { text: string; source: string; category: typeof quoteCategories[number]; sourceURL: string };
type Row = { id: string; day: string; value: string; kept: number; created_at: string };
type CommentRow = { id: string; card_id: string; author: string; body: string; created_at: string };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const quoteCategories = ['哲学', '轻文学', '诗歌', '散文', '小说'] as const;
function isQuoteCategory(value: unknown): value is typeof quoteCategories[number] {
  return typeof value === 'string' && (quoteCategories as readonly string[]).includes(value);
}
// Short excerpts from public-domain originals, with a direct source for each one.
const quotes: Quote[] = [
  { text: '行到水穷处，坐看云起时。', source: '王维《终南别业》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/終南別業' },
  { text: '海内存知己，天涯若比邻。', source: '王勃《送杜少府之任蜀州》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/送杜少府之任蜀州' },
  { text: '莫听穿林打叶声，何妨吟啸且徐行。', source: '苏轼《定风波》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/zh/定風波_(莫聽穿林打葉聲)' },
  { text: '明月松间照，清泉石上流。', source: '王维《山居秋暝》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/山居秋暝' },
  { text: '采菊东篱下，悠然见南山。', source: '陶渊明《饮酒·其五》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/飲酒二十首' },
  { text: '山重水复疑无路，柳暗花明又一村。', source: '陆游《游山西村》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/遊山西村' },
  { text: '长风破浪会有时，直挂云帆济沧海。', source: '李白《行路难·其一》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/行路難三首' },
  { text: '但愿人长久，千里共婵娟。', source: '苏轼《水调歌头》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/水調歌頭_(明月幾時有)' },
  { text: '人闲桂花落，夜静春山空。', source: '王维《鸟鸣涧》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/鳥鳴澗' },
  { text: '此情可待成追忆，只是当时已惘然。', source: '李商隐《锦瑟》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/錦瑟' },
  { text: '野旷天低树，江清月近人。', source: '孟浩然《宿建德江》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/宿建德江' },
  { text: '会当凌绝顶，一览众山小。', source: '杜甫《望岳》', category: '诗歌', sourceURL: 'https://zh.wikisource.org/wiki/望嶽' },
  { text: '知者不惑，仁者不忧，勇者不惧。', source: '《论语·子罕》', category: '哲学', sourceURL: 'https://zh.wikisource.org/wiki/論語/子罕第九' },
  { text: '逝者如斯夫！不舍昼夜。', source: '《论语·子罕》', category: '哲学', sourceURL: 'https://zh.wikisource.org/wiki/論語/子罕第九' },
  { text: '上善若水。水善利万物而不争。', source: '《道德经》第八章', category: '哲学', sourceURL: 'https://zh.wikisource.org/wiki/老子道德經註/上篇' },
  { text: '天地有大美而不言，四时有明法而不议。', source: '《庄子·知北游》', category: '哲学', sourceURL: 'https://zh.wikisource.org/wiki/莊子/知北遊' },
  { text: '燕子去了，有再来的时候；杨柳枯了，有再青的时候；桃花谢了，有再开的时候。', source: '朱自清《匆匆》', category: '轻文学', sourceURL: 'https://zh.wikisource.org/wiki/匆匆' },
  { text: '过去的日子如轻烟，被微风吹散了，如薄雾，被初阳蒸融了。', source: '朱自清《匆匆》', category: '轻文学', sourceURL: 'https://zh.wikisource.org/wiki/匆匆' },
  { text: '单是周围的短短的泥墙根一带，就有无限趣味。', source: '鲁迅《从百草园到三味书屋》', category: '轻文学', sourceURL: 'https://zh.wikisource.org/wiki/從百草園到三味書屋' },
  { text: '我爱热闹，也爱冷静；爱群居，也爱独处。', source: '朱自清《荷塘月色》', category: '轻文学', sourceURL: 'https://zh.wikisource.org/wiki/荷塘月色' },
  { text: '忽逢桃花林，夹岸数百步，中无杂树，芳草鲜美，落英缤纷。', source: '陶渊明《桃花源记》', category: '散文', sourceURL: 'https://zh.wikisource.org/wiki/桃花源記' },
  { text: '天朗气清，惠风和畅。仰观宇宙之大，俯察品类之盛。', source: '王羲之《兰亭集序》', category: '散文', sourceURL: 'https://zh.wikisource.org/wiki/蘭亭集序' },
  { text: '不以物喜，不以己悲。', source: '范仲淹《岳阳楼记》', category: '散文', sourceURL: 'https://zh.wikisource.org/wiki/岳陽樓記' },
  { text: '希望是本无所谓有，无所谓无的。这正如地上的路，其实地上本没有路；走的人多了，也便成了路。', source: '鲁迅《故乡》', category: '小说', sourceURL: 'https://zh.wikisource.org/wiki/故鄉' },
  { text: '从来如此，便对么？', source: '鲁迅《狂人日记》', category: '小说', sourceURL: 'https://zh.wikisource.org/wiki/狂人日記' },
  { text: '虽我不学无文，又何妨用假语村言，敷演出来，亦可使闺阁昭传。', source: '曹雪芹《红楼梦》第一回', category: '小说', sourceURL: 'https://zh.wikisource.org/wiki/紅樓夢（程甲本）/一' },
];

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
export async function quoteCandidates(owner: string) {
  await ensureSchema();
  const config = await preferences(owner);
  const pool = config.categories.length ? quotes.filter(q => config.categories.includes(q.category)) : quotes;
  return { candidates: pool.map((quote, index) => ({ ...quote, candidateId: quotes.indexOf(quote), index })), preferences: config, today: localDay() };
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
    preferences: config, today };
}
export async function publishDailyQuote(owner: string, input: Record<string,unknown>) {
  await ensureSchema();
  const config = await preferences(owner), day = input.day, slot = input.slot, candidateId = input.candidateId;
  if (typeof day !== 'string' || day !== localDay() || !Number.isInteger(slot) || Number(slot) < 0 || Number(slot) >= config.dailyCount ||
      !Number.isInteger(candidateId) || Number(candidateId) < 0 || Number(candidateId) >= quotes.length) throw new Error('Choose a current quote slot and candidate');
  const quote = quotes[Number(candidateId)];
  if (config.categories.length && !config.categories.includes(quote.category)) throw new Error('Quote does not match the saved categories');
  const expectedProof = await searchProof(owner, String(input.fileTitle || ''), day);
  if (typeof input.searchProof !== 'string' || input.searchProof !== expectedProof) {
    throw new Error('Search for this real image before publishing');
  }
  const image = await resolveQuoteImage(input.fileTitle);
  const id = day + '-' + slot, createdAt = new Date().toISOString();
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
            { title: 'Ash 的一言', body: card.text, tag: 'vesper-daily-quote-' + id,
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
