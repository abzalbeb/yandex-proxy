const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

const CACHE_FILE = './video_cache.json';
const CACHE_EXPIRY = 3600000; // 1 soat
const CONFIG_FILE = './config.json';

app.use(cors()); // Barcha domenlarga ruxsat berish
app.use(express.json());

// JSON fayldan config o‘qish
function readConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return { defaultVideoUrl: '' };
}

// JSON faylga config yozish
function writeConfig(newConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

// Cache o‘qish
function readCache() {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE));
  }
  return {};
}

// Cache yozish
function writeCacheEntry(videoUrl, iframeUrl) {
  const cache = readCache();
  cache[videoUrl] = {
    url: iframeUrl,
    timestamp: Date.now()
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Puppeteer orqali iframe olish
async function parseVideoUrl(videoPageUrl) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 30000
  });

  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', req => {
    ['document', 'iframe'].includes(req.resourceType()) ? req.continue() : req.abort();
  });

  try {
    await page.goto(videoPageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    const iframeUrl = await page.$eval('iframe[src*="rutube"]', el => el.src);
    await browser.close();
    return iframeUrl;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// GET - Rutube iframe URL ni qaytaradi
app.get('/current-url', async (req, res) => {
  const { defaultVideoUrl } = readConfig();
  if (!defaultVideoUrl) {
    return res.status(404).json({ error: 'defaultVideoUrl topilmadi' });
  }

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp < CACHE_EXPIRY)) {
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


// POST - URL yangilash
app.post('/update-url', (req, res) => {
  const { newUrl } = req.body;
  if (!newUrl || !newUrl.startsWith('https://yandex.ru/video/preview/')) {
    return res.status(400).json({ error: 'Yaroqsiz URL format' });
  }

  const config = readConfig();
  config.defaultVideoUrl = newUrl;
  writeConfig(config);

  res.json({ message: 'URL yangilandi', url: newUrl });
});

// HTML sahifa
app.get('/', async (req, res) => {
  const { defaultVideoUrl } = readConfig();

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp < CACHE_EXPIRY)) {
      iframeUrl = entry.url;
    } else {
      iframeUrl = await parseVideoUrl(defaultVideoUrl);
      writeCacheEntry(defaultVideoUrl, iframeUrl);
    }

    res.set('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Rutube iframe</title>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          iframe { border: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h3>Rutube iframe:</h3>
        <iframe src="${iframeUrl}" width="800" height="450" allowfullscreen></iframe>
        <p>Video manzili: <a href="${defaultVideoUrl}" target="_blank">${defaultVideoUrl}</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Xato: ${err.message}</h1>`);
  }
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} da ishlayapti`);
});
