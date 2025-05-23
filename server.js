// server.js
const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_FILE = './video_cache.json';
const CACHE_EXPIRY = 3600000; // 1 soat
const CONFIG_FILE = './config.json';

app.use(express.json());

// Config o‘qish/yozish
function readConfig() {
  return fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : { defaultVideoUrl: '' };
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Cache o‘qish/yozish
function readCache() {
  return fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE))
    : {};
}
function writeCacheEntry(videoUrl, iframeUrl) {
  const cache = readCache();
  cache[videoUrl] = { url: iframeUrl, timestamp: Date.now() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Puppeteer bilan iframe olish
async function parseVideoUrl(videoPageUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', req =>
    ['document','iframe'].includes(req.resourceType())
      ? req.continue()
      : req.abort()
  );

  try {
    await page.goto(videoPageUrl, { waitUntil: 'domcontentloaded' });
    const iframeUrl = await page.$eval('iframe[src*="rutube"]', el => el.src);
    await browser.close();
    return iframeUrl;
  } catch (e) {
    await browser.close();
    throw e;
  }
}

// --- POST /update-url: defaultVideoUrl ni o'zgartirish ---
app.post('/update-url', (req, res) => {
  const { newUrl } = req.body;
  if (!newUrl?.startsWith('https://yandex.ru/video/preview/')) {
    return res.status(400).json({ error: 'Yaroqsiz URL format' });
  }
  const cfg = readConfig();
  cfg.defaultVideoUrl = newUrl;
  writeConfig(cfg);
  res.json({ message: 'defaultVideoUrl yangilandi', url: newUrl });
});

// --- GET /current-url: iframeUrl qaytaradi ---
app.get('/current-url', async (req, res) => {
  const { defaultVideoUrl } = readConfig();
  if (!defaultVideoUrl) {
    return res.status(404).json({ error: 'defaultVideoUrl topilmadi' });
  }

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp) < CACHE_EXPIRY) {
      iframeUrl = entry.url;
    } else {
      iframeUrl = await parseVideoUrl(defaultVideoUrl);
      writeCacheEntry(defaultVideoUrl, iframeUrl);
    }

    res.json({ iframeUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- (ixtiyoriy) bosh sahifa: iframe bilan render ---
app.get('/', async (req, res) => {
  try {
    const { iframeUrl } = (await (await fetch(`http://localhost:${PORT}/current-url`)).json());
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Video</title></head>
      <body>
        <iframe src="${iframeUrl}" width="800" height="450" allowfullscreen></iframe>
      </body>
      </html>
    `);
  } catch {
    res.redirect('/current-url');
  }
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} da ishlayapti`);
});
