// server.js — ESM ("type":"module")
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
app.use(express.urlencoded({ extended: true }));

// 静的配信
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// 保存先
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(process.cwd(), 'points.json');
const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { return []; } };
const writeDB = (arr) => fs.writeFileSync(DB_FILE, JSON.stringify(arr), 'utf-8');

// アップロード設定
const storage = multer.diskStorage({
  destination(_req, _file, cb) { cb(null, UPLOAD_DIR); },
  filename(_req, file, cb) { cb(null, Date.now() + '_' + (file.originalname || 'media')); }
});
const upload = multer({ storage });
// どんなフィールド名でも1ファイル受け取れるように
const uploadAny = upload.any();

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

// ルートと地図
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/map.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));

// メディア配信（画像/動画どちらでも）
app.get('/media/:id', (req, res) => {
  const arr = readDB();
  const item = arr.find(v => v.id === req.params.id);
  if (!item || !item.file_path || !fs.existsSync(item.file_path)) return res.status(404).send('Not found');
  res.sendFile(item.file_path);
});

// ピン一覧（bbox/時間フィルタ対応）
app.get('/map-points', (req, res) => {
  try {
    let result = readDB();

    const hours = req.query.hours ? parseInt(req.query.hours, 10) : null;
    if (hours && Number.isFinite(hours)) {
      const cutoff = Date.now() - hours * 3600 * 1000;
      result = result.filter(p => (p.created_at || p.captured_at || 0) >= cutoff);
    }

    const bbox = req.query.bbox ? req.query.bbox.split(',').map(Number) : null; // west,south,east,north
    if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
      const [w, s, e, n] = bbox;
      result = result.filter(p => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
    }

    res.json({ points: result });
  } catch (e) {
    console.error('map-points error', e);
    res.json({ error: 'map-points 取得でエラー' });
  }
});

// アップロード（画像 or 動画、コメント付き）
app.post('/upload', uploadAny, (req, res) => {
  try {
    const file = (req.files && req.files[0]) || null;
    if (!file) return res.status(400).json({ ok: false, error: 'file がありません' });

    const id = nanoid();
    const lat = parseFloat(req.body.lat ?? '0');
    const lon = parseFloat(req.body.lon ?? '0');
    const accuracy = parseFloat(req.body.accuracy ?? '0');
    const captured_at = req.body.captured_at ? Date.parse(req.body.captured_at) : Date.now();
    const note = (req.body.note || '').toString().slice(0, 500); // コメント

    const ext = path.extname(file.originalname || file.filename) || '';
    const finalPath = path.join(UPLOAD_DIR, `${id}${ext || ''}`);
    fs.renameSync(file.path, finalPath);

    const mime = file.mimetype || '';
    const kind = mime.startsWith('image/') ? 'image' : 'video';

    const arr = readDB();
    arr.push({
      id, lat, lon, accuracy, note,
      captured_at, created_at: Date.now(),
      kind, mime, size: file.size,
      file_path: finalPath
    });
    writeDB(arr);

    res.json({ ok: true, id });
  } catch (e) {
    console.error('upload error', e);
    res.status(500).json({ ok: false, error: 'upload 失敗' });
  }
});

app.listen(PORT, () => console.log('Server running on', PORT));

