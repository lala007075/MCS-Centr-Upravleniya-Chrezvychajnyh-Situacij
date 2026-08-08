require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cuchs_mchs_cao_secret_2024';

// ===== БАЗА ДАННЫХ =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) console.error('❌ Ошибка БД:', err.message);
  else console.log('✅ Подключение к Neon PostgreSQL успешно');
});

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      rank VARCHAR(100) DEFAULT 'Оператор',
      position VARCHAR(255) DEFAULT 'Оперативный дежурный',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      incident_number VARCHAR(30) UNIQUE NOT NULL,
      incident_type VARCHAR(100) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      description TEXT NOT NULL,
      district VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      caller_name VARCHAR(255),
      caller_phone VARCHAR(20),
      assigned_unit VARCHAR(255),
      personnel_count INTEGER DEFAULT 0,
      vehicles_count INTEGER DEFAULT 0,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Таблицы готовы');
}

// ===== АВТОРИЗАЦИЯ =====
function auth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Недействительный токен' });
  }
}

// ===== РЕГИСТРАЦИЯ =====
app.post('/api/register', async (req, res) => {
  try {
    const { full_name, email, password, rank, position } = req.body;
    if (!full_name || !email || !password)
      return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже занят' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, rank, position)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, email, rank, position`,
      [full_name, email, hash, rank || 'Оператор', position || 'Оперативный дежурный']
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, full_name: user.full_name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// ===== ВХОД =====
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Неверный email или пароль' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = jwt.sign({ id: user.id, full_name: user.full_name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, rank: user.rank, position: user.position }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// ===== ПОЛУЧИТЬ ВЫЗОВЫ =====
app.get('/api/incidents', auth, async (req, res) => {
  try {
    const { search, status, priority } = req.query;
    let conditions = [], params = [], i = 1;

    if (status && status !== 'all') { conditions.push(`status=$${i++}`); params.push(status); }
    if (priority && priority !== 'all') { conditions.push(`priority=$${i++}`); params.push(priority); }
    if (search) {
      conditions.push(`(incident_number ILIKE $${i} OR description ILIKE $${i} OR address ILIKE $${i} OR district ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(`
      SELECT i.*, u.full_name AS created_by_name
      FROM incidents i LEFT JOIN users u ON i.created_by = u.id
      ${where}
      ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      created_at DESC`, params);

    const stats = await pool.query(`
      SELECT COUNT(*) total,
        COUNT(*) FILTER (WHERE status IN ('new','dispatched','in_progress')) active,
        COUNT(*) FILTER (WHERE priority='critical') critical,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed')) resolved
      FROM incidents`);

    res.json({ incidents: result.rows, stats: stats.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// ===== СОЗДАТЬ ВЫЗОВ =====
app.post('/api/incidents', auth, async (req, res) => {
  try {
    const d = req.body;
    if (!d.incident_type || !d.description || !d.district || !d.address)
      return res.status(400).json({ error: 'Заполните обязательные поля' });

    const cnt = await pool.query('SELECT COUNT(*)+1 n FROM incidents');
    const num = `ЦУЧС-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(cnt.rows[0].n).padStart(4,'0')}`;

    const result = await pool.query(`
      INSERT INTO incidents (incident_number, incident_type, priority, status, description,
        district, address, caller_name, caller_phone, assigned_unit, personnel_count, vehicles_count, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [num, d.incident_type, d.priority||'medium', 'new', d.description, d.district, d.address,
       d.caller_name||null, d.caller_phone||null, d.assigned_unit||null,
       d.personnel_count||0, d.vehicles_count||0, d.notes||null, req.user.id]);

    res.json({ message: 'Вызов зарегистрирован', incident: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

// ===== РЕДАКТИРОВАТЬ ВЫЗОВ =====
app.put('/api/incidents/:id', auth, async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(`
      UPDATE incidents SET incident_type=$1, priority=$2, status=$3, description=$4,
        district=$5, address=$6, caller_name=$7, caller_phone=$8, assigned_unit=$9,
        personnel_count=$10, vehicles_count=$11, notes=$12, updated_at=CURRENT_TIMESTAMP
      WHERE id=$13 RETURNING *`,
      [d.incident_type, d.priority, d.status, d.description, d.district, d.address,
       d.caller_name||null, d.caller_phone||null, d.assigned_unit||null,
       d.personnel_count||0, d.vehicles_count||0, d.notes||null, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Вызов не найден' });
    res.json({ message: 'Вызов обновлён', incident: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// ===== УДАЛИТЬ ВЫЗОВ =====
app.delete('/api/incidents/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM incidents WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Вызов не найден' });
    res.json({ message: 'Вызов удалён' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ===== ТАБЛИЦА ЛИЧНОГО СОСТАВА (добавить в initDB) =====
// Найдите функцию initDB() и ДОБАВЬТЕ этот CREATE TABLE внутрь неё:
/*
    CREATE TABLE IF NOT EXISTS personnel (
      id SERIAL PRIMARY KEY,
      personal_file VARCHAR(50) UNIQUE NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      position VARCHAR(255) NOT NULL,
      rank VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'duty',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
*/

// ===== ПОЛУЧИТЬ СОСТАВ =====
app.get('/api/personnel', auth, async (req, res) => {
  try {
    const { search, status } = req.query;
    let conditions = [], params = [], i = 1;
    if (status && status !== 'all') { conditions.push(`status=$${i++}`); params.push(status); }
    if (search) {
      conditions.push(`(personal_file ILIKE $${i} OR full_name ILIKE $${i} OR position ILIKE $${i} OR rank ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`SELECT * FROM personnel ${where} ORDER BY id DESC`, params);
    const stats = await pool.query(`
      SELECT COUNT(*) total,
        COUNT(*) FILTER (WHERE status='duty') duty,
        COUNT(*) FILTER (WHERE status='vacation') vacation,
        COUNT(*) FILTER (WHERE status='sick') sick
      FROM personnel`);
    res.json({ personnel: result.rows, stats: stats.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка загрузки' }); }
});

// ===== ДОБАВИТЬ СОТРУДНИКА =====
app.post('/api/personnel', auth, async (req, res) => {
  try {
    const d = req.body;
    if (!d.personal_file || !d.full_name || !d.position || !d.rank)
      return res.status(400).json({ error: 'Заполните все поля' });
    const exists = await pool.query('SELECT id FROM personnel WHERE personal_file=$1', [d.personal_file]);
    if (exists.rows.length) return res.status(409).json({ error: 'Личное дело с таким № уже существует' });
    const result = await pool.query(
      `INSERT INTO personnel (personal_file, full_name, position, rank, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.personal_file, d.full_name, d.position, d.rank, d.status || 'duty']);
    res.json({ message: 'Сотрудник добавлен', person: result.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка добавления' }); }
});

// ===== РЕДАКТИРОВАТЬ СОТРУДНИКА =====
app.put('/api/personnel/:id', auth, async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `UPDATE personnel SET personal_file=$1, full_name=$2, position=$3, rank=$4, status=$5
       WHERE id=$6 RETURNING *`,
      [d.personal_file, d.full_name, d.position, d.rank, d.status, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ message: 'Данные обновлены', person: result.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка обновления' }); }
});

// ===== УДАЛИТЬ СОТРУДНИКА =====
app.delete('/api/personnel/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM personnel WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ message: 'Сотрудник удалён' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка удаления' }); }
});

// ===== SPA =====
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`🚒 ЦУЧС ГУ МЧС по ЦАО — сервер на порту ${PORT}`);
  await initDB();
});
