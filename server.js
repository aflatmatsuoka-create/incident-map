import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';
import ngeo from 'ngeohash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12);
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(process.cwd(), 'points.json');
function readDB(){ try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { return []; } }
function writeDB(arr){ fs.writeFileSync(DB_FILE, JSON.stringify(arr), 'utf-8'); }

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = req._fileId || nanoid();
    req._fileId = id;
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, id + (ext || '.mov'));
  }
});
const upload = multer({ storage });

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/upload', upload.single('video'), (req, res) => {
  try {
    const file = req.file;
    const { lat, lon, captured_at, accuracy } = req.body;
    if (!file) return res.status(400).json({ error: 'video file required' });
    const latNum = parseFloat(lat), lonNum = parseFloat(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return res.status(400).json({ error: 'invalid lat/lon' });

    const when = captured_at && !Number.isNaN(Date.parse(captured_at)) ? new Date(captured_at) : new Date();
    const acc = accuracy ? parseInt(accuracy, 10) : null;
    const geohash = ngeo.encode(latNum, lonNum, 7);
    const id = req._fileId;

    const arr = readDB();
    arr.push({ id, filepath: file.path, lat: latNum, lon: lonNum, captured_at: when.toISOString(), accuracy: acc, geohash, created_at: new Date().toISOString() });
    writeDB(arr);

    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'upload failed' });
  }
});

app.get('/video/:id', (req, res) => {
  const id = req.params.id;
  const arr = readDB();
  const row = arr.find(r => r.id === id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const fp = row.filepath;
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'file missing' });

  const stat = fs.statSync(fp);
  const ext = path.extname(fp).toLowerCase();
  const mime = ext === '.mp4' ? 'video/mp4' : (ext === '.webm' ? 'video/webm' : 'video/quicktime');

  const range = req.headers.range;
  if (range) {
    const [s,e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s,10);
    const end = e ? parseInt(e,10) : stat.size-1;
    const chunk = (end-start)+1;
    const file = fs.createReadStream(fp, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk,
      'Content-Type': mime,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime });
    fs.createReadStream(fp).pipe(res);
  }
});

app.get('/map-points', (req, res) => {
  try {
    const bbox = (req.query.bbox || '').toString().split(',').map(Number);
    const hours = parseInt((req.query.hours || '24').toString(), 10);
    if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n))) return res.status(400).json({ error: 'bbox must be left,bottom,right,top' });

    const [left, bottom, right, top] = bbox;
    const since = Date.now() - hours*3600*1000;
    const arr = readDB();
    const rows = arr
      .filter(r => Date.parse(r.captured_at) >= since && r.lat >= bottom && r.lat <= top && r.lon >= left && r.lon <= right)
      .sort((a,b)=> Date.parse(b.captured_at)-Date.parse(a.captured_at))
      .slice(0,5000);
    res.json({ points: rows.map(({id,lat,lon,captured_at}) => ({ id, lat, lon, captured_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed' });
  }
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
