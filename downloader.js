import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://api.changes.tg';
const DATA_DIR = './data';
const ASSETS_DIR = './assets';
const CONCURRENCY = 4; // Снижаем нагрузку, чтобы API не банил

console.log('====================================================');
console.log('Powered by @GiftChanges (api.changes.tg)');
console.log('Thanks to @GiftChanges for this API!');
console.log('====================================================\n');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

// Запрос JSON с жестким таймаутом 10 секунд
async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// Скачивание файла с таймаутом 15 секунд
async function downloadFile(url, destPath) {
  try {
    try {
      await fs.access(destPath);
      return; // Уже скачан ранее
    } catch {}

    await ensureDir(path.dirname(destPath));
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return;

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destPath, buffer);
    console.log(`[+] Сохранен: ${destPath}`);
  } catch (err) {
    // Если упал по таймауту — просто идем дальше, не зависаем
  }
}

async function runQueue(tasks, limit) {
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    executing.push(p);
    if (limit <= tasks.length) {
      await Promise.race(executing);
      const index = executing.indexOf(p);
      if (index !== -1) executing.splice(index, 1);
    }
  }
  return Promise.all(executing);
}

function sanitize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

async function main() {
  await ensureDir(DATA_DIR);
  await ensureDir(ASSETS_DIR);

  console.log('[1/4] Загрузка общих баз...');
  const [idsMap, totalStats, dates, crafts, allBackdrops, allAuctions] = await Promise.all([
    fetchJson(`${BASE_URL}/ids`),
    fetchJson(`${BASE_URL}/total`),
    fetchJson(`${BASE_URL}/dates`),
    fetchJson(`${BASE_URL}/crafts`),
    fetchJson(`${BASE_URL}/backdrops`),
    fetchJson(`${BASE_URL}/auctions`)
  ]);

  if (!idsMap) {
    console.error('Ошибка доступа к API.');
    return;
  }

  await fs.writeFile(path.join(DATA_DIR, 'gifts_map.json'), JSON.stringify(idsMap, null, 2));
  if (totalStats) await fs.writeFile(path.join(DATA_DIR, 'stats.json'), JSON.stringify(totalStats, null, 2));
  if (dates) await fs.writeFile(path.join(DATA_DIR, 'dates.json'), JSON.stringify(dates, null, 2));
  if (crafts) await fs.writeFile(path.join(DATA_DIR, 'crafts.json'), JSON.stringify(crafts, null, 2));
  if (allBackdrops) await fs.writeFile(path.join(DATA_DIR, 'backdrops_all.json'), JSON.stringify(allBackdrops, null, 2));
  if (allAuctions) await fs.writeFile(path.join(DATA_DIR, 'auctions_all.json'), JSON.stringify(allAuctions, null, 2));

  const giftEntries = Object.entries(idsMap);
  console.log(`[2/4] Обработка данных подарков (${giftEntries.length} шт.)...`);

  const fileTasks = [];
  const fullCatalog = [];

  for (const [giftId, giftName] of giftEntries) {
    const slug = sanitize(giftName);

    // Оригиналы
    fileTasks.push(() => downloadFile(`${BASE_URL}/original/${giftId}.png?size=512`, path.join(ASSETS_DIR, 'originals/png', `${slug}_${giftId}.png`)));
    fileTasks.push(() => downloadFile(`${BASE_URL}/original/${giftId}.json`, path.join(ASSETS_DIR, 'originals/lottie', `${slug}_${giftId}.json`)));
    fileTasks.push(() => downloadFile(`${BASE_URL}/original/${giftId}.tgs`, path.join(ASSETS_DIR, 'originals/tgs', `${slug}_${giftId}.tgs`)));
    fileTasks.push(() => downloadFile(`${BASE_URL}/original/${giftId}.svg`, path.join(ASSETS_DIR, 'originals/svg', `${slug}_${giftId}.svg`)));

    // Получаем инфу о моделях и паттернах
    const [info, models, patterns, backdrops] = await Promise.all([
      fetchJson(`${BASE_URL}/gift/${giftId}`),
      fetchJson(`${BASE_URL}/models/${giftId}`),
      fetchJson(`${BASE_URL}/patterns/${giftId}`),
      fetchJson(`${BASE_URL}/backdrops/${giftId}`)
    ]);

    fullCatalog.push({ id: giftId, name: giftName, slug, info, models, patterns, backdrops });

    if (Array.isArray(models)) {
      for (const model of models) {
        const modelSlug = sanitize(model);
        const encoded = encodeURIComponent(model);
        fileTasks.push(() => downloadFile(`${BASE_URL}/model/${giftId}/${encoded}.png?size=512`, path.join(ASSETS_DIR, 'models/png', slug, `${modelSlug}.png`)));
        fileTasks.push(() => downloadFile(`${BASE_URL}/model/${giftId}/${encoded}.json`, path.join(ASSETS_DIR, 'models/lottie', slug, `${modelSlug}.json`)));
      }
    }

    if (Array.isArray(patterns)) {
      for (const pattern of patterns) {
        const patternSlug = sanitize(pattern);
        const encoded = encodeURIComponent(pattern);
        fileTasks.push(() => downloadFile(`${BASE_URL}/pattern/${giftId}/${encoded}.png?size=256`, path.join(ASSETS_DIR, 'patterns/png', slug, `${patternSlug}.png`)));
      }
    }
  }

  console.log(`[3/4] Всего файлов к скачиванию: ${fileTasks.length}. Запуск пула...`);
  await runQueue(fileTasks, CONCURRENCY);

  console.log('[4/4] Запись итогового каталога...');
  await fs.writeFile(path.join(DATA_DIR, 'full_catalog.json'), JSON.stringify(fullCatalog, null, 2));

  console.log('Выгрузка успешно завершена!');
}

main().catch(console.error);
