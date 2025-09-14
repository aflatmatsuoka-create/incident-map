// server.js  — ESM（"type":"module"）想定
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 静的ファイル（/public）を配信
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// 保存先（Render でも書き込み可）
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(process.cwd(), 'points.json');
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}
function writeDB(arr) {
  fs.writeFileSync(DB_FILE, JSON.stringify(arr), 'utf-8');
}

// アップロード設定（ファイル名は一時でOK。保存時にリネーム）
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    // 一旦オリジナル名のまま
    cb(null, Date.now() + '_' + (file.originalname || 'video.mov'));
  }
});
const upload = multer({ storage });
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

// ルート（録画・アップロード画面）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 地図ページ
app.get('/map.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

// 動画取得（/video/:id で配信）
app.get('/video/:id', (req, res) => {
  const id = req.params.id;
  const arr = readDB();
  const p = arr.find(v => v.id === id);
  if (!p || !p.file_path || !fs.existsSync(p.file_path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(p.file_path);
});

// ピン一覧（bbox 省略OK、hours 省略OK）
app.get('/map-points', (req, res) => {
  try {
    const arr = readDB();

    // bbox = west,south,east,north
    const bbox = req.query.bbox ? req.query.bbox.split(',').map(Number) : null;
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : null;

    let result = arr;

    if (hours && Number.isFinite(hours)) {
      const cutoff = Date.now() - hours * 3600 * 1000;
      result = result.filter(p => (p.created_at || p.captured_at || 0) >= cutoff);
    }

    if (bbox && bbox.length === 4 && bbox.every(v => Number.isFinite(v))) {
      const [west, south, east, north] = bbox;
      result = result.filter(p =>
        p.lon >= west && p.lon <= east &&
        p.lat >= south && p.lat <= north
      );
    }

    res.json({ points: result });
  } catch (e) {
    console.error('map-points error', e);
    res.json({ error: 'map-points 取得でエラー' });
  }
});

// アップロード
// 受け取る form フィールド: lat, lon, captured_at, accuracy, video(file)
app.post('/upload', upload.single('video'), (req, res) => {
  try {
    const id = nanoid();
    const lat = parseFloat(req.body.lat ?? '0');
    const lon = parseFloat(req.body.lon ?? '0');
    const accuracy = parseFloat(req.body.accuracy ?? '0');
    const captured_at = req.body.captured_at ? Date.parse(req.body.captured_at) : Date.now();

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'video がありません' });
    }

    // 拡張子を付け直して保存ファイル名を確定
    const ext = path.extname(req.file.originalname || '') || path.extname(req.file.filename) || '.mov';
    const finalPath = path.join(UPLOAD_DIR, `${id}${ext}`);
    fs.renameSync(req.file.path, finalPath);

    // DB 追記
    const arr = readDB();
    arr.push({
      id,
      lat,
      lon,
      accuracy,
      captured_at,
      created_at: Date.now(),
      file_path: finalPath
    });
    writeDB(arr);

    res.json({ ok: true, id });
  } catch (e) {
    console.error('upload error', e);
    res.status(500).json({ ok: false, error: 'upload 失敗' });
  }
});

// 起動
app.listen(PORT, () => {
  console.log('Server running on', PORT);
});
