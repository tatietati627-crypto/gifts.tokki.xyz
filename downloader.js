import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://api.changes.tg';
const DATA_DIR = './data';
const ASSETS_DIR = './assets';
const CONCURRENCY = 6;

console.log('====================================================');
console.log('Powered by @GiftChanges (api.changes.tg)');
console.log('Thanks to @GiftChanges for this API!');
console.log('====================================================\n');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Ошибка запроса ${url}:`, err.message);
    return null;
  }
}

async function downloadFile(url, destPath) {
  try {
    try {
      await fs.access(destPath);
      return;
    } catch {}

    await ensureDir(path.dirname(destPath));
    const res = await fetch(url);
    if (!res.ok) return;

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destPath, buffer);
    console.log(`[+] Сохранено: ${destPath}`);
  } catch (err) {
    console.error(`[-] Ошибка ${url}:`, err.message);
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

  console.log('Получаем базовые таблицы...');
  const [idsMap, totalStats, dates, crafts] = await Promise.all([
    fetchJson(`${BASE_URL}/ids`),
    fetchJson(`${BASE_URL}/total`),
    fetchJson(`${BASE_URL}/dates`),
    fetchJson(`${BASE_URL}/crafts`)
  ]);

  if (!idsMap) {
    console.error('Не удалось загрузить /ids');
    return;
  }

  await fs.writeFile(path.join(DATA_DIR, 'gifts_map.json'), JSON.stringify(idsMap, null, 2));
  if (totalStats) await fs.writeFile(path.join(DATA_DIR, 'stats.json'), JSON.stringify(totalStats, null, 2));
  if (dates) await fs.writeFile(path.join(DATA_DIR, 'dates.json'), JSON.stringify(dates, null, 2));
  if (crafts) await fs.writeFile(path.join(DATA_DIR, 'crafts.json'), JSON.stringify(crafts, null, 2));

  const giftEntries = Object.entries(idsMap);
  console.log(`Всего подарков: ${giftEntries.length}. Формируем очередь...`);

  const tasks = [];
  const fullCatalog = [];

  for (const [giftId, giftName] of giftEntries) {
    const slug = sanitize(giftName);

    // Оригиналы PNG и JSON-анимации
    tasks.push(() => downloadFile(
      `${BASE_URL}/original/${giftId}.png?size=512`,
      path.join(ASSETS_DIR, 'originals/png', `${slug}_${giftId}.png`)
    ));
    tasks.push(() => downloadFile(
      `${BASE_URL}/original/${giftId}.json`,
      path.join(ASSETS_DIR, 'originals/lottie', `${slug}_${giftId}.json`)
    ));

    // Метаданные и модели подарка
    tasks.push(async () => {
      const [info, models, patterns] = await Promise.all([
        fetchJson(`${BASE_URL}/gift/${giftId}`),
        fetchJson(`${BASE_URL}/models/${giftId}`),
        fetchJson(`${BASE_URL}/patterns/${giftId}`)
      ]);

      fullCatalog.push({ id: giftId, name: giftName, slug, info });

      if (Array.isArray(models)) {
        for (const model of models) {
          const modelSlug = sanitize(model);
          tasks.push(() => downloadFile(
            `${BASE_URL}/model/${giftId}/${encodeURIComponent(model)}.png?size=512`,
            path.join(ASSETS_DIR, 'models/png', slug, `${modelSlug}.png`)
          ));
          tasks.push(() => downloadFile(
            `${BASE_URL}/model/${giftId}/${encodeURIComponent(model)}.json`,
            path.join(ASSETS_DIR, 'models/lottie', slug, `${modelSlug}.json`)
          ));
        }
      }

      if (Array.isArray(patterns)) {
        for (const pattern of patterns) {
          const patternSlug = sanitize(pattern);
          tasks.push(() => downloadFile(
            `${BASE_URL}/pattern/${giftId}/${encodeURIComponent(pattern)}.png?size=256`,
            path.join(ASSETS_DIR, 'patterns/png', slug, `${patternSlug}.png`)
          ));
        }
      }
    });
  }

  console.log('Начинаем выкачивание файлов...');
  await runQueue(tasks, CONCURRENCY);

  await fs.writeFile(path.join(DATA_DIR, 'full_catalog.json'), JSON.stringify(fullCatalog, null, 2));
  console.log('Все файлы успешно скачаны!');
}

main().catch(console.error);
