const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Все маршруты требуют авторизации
router.use(authenticateToken);

// Получить все вызовы с фильтрами и пагинацией
router.get('/', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      type,
      search,
      sort = 'created_at',
      order = 'DESC',
      date_from,
      date_to
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      conditions.push(`i.status = $${paramIndex++}`);
      params.push(status);
    }

    if (priority && priority !== 'all') {
      conditions.push(`i.priority = $${paramIndex++}`);
      params.push(priority);
    }

    if (type && type !== 'all') {
      conditions.push(`i.incident_type = $${paramIndex++}`);
      params.push(type);
    }

    if (search) {
      conditions.push(`(
        i.incident_number ILIKE $${paramIndex} OR
        i.description ILIKE $${paramIndex} OR
        i.address ILIKE $${paramIndex} OR
        i.caller_name ILIKE $${paramIndex} OR
        i.city ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (date_from) {
      conditions.push(`i.created_at >= $${paramIndex++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`i.created_at <= $${paramIndex++}`);
      params.push(date_to + ' 23:59:59');
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Безопасная сортировка
    const allowedSorts = ['created_at', 'priority', 'status', 'incident_type', 'incident_number'];
    const sortField = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Получаем вызовы
    const query = `
      SELECT i.*, u.full_name as created_by_name
      FROM incidents i
      LEFT JOIN users u ON i.created_by = u.id
      ${whereClause}
      ORDER BY
        CASE i.priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END ASC,
        i.${sortField} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    // Получаем общее количество
    const countParams = params.slice(0, -2);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM incidents i
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, countParams);

    // Статистика
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'dispatched') as dispatched_count,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_count,
        COUNT(*) FILTER (WHERE priority = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE priority = 'high') as high_count,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today_count
      FROM incidents
    `;
    const statsResult = await pool.query(statsQuery);

    res.json({
      incidents: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit))
      },
      stats: statsResult.rows[0]
    });
  } catch (error) {
    console.error('Get incidents error:', error);
    res.status(500).json({ error: 'Ошибка при получении вызовов' });
  }
});

// Получить один вызов
router.get('/:id', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const result = await pool.query(
      `SELECT i.*, u.full_name as created_by_name, u2.full_name as updated_by_name
       FROM incidents i
       LEFT JOIN users u ON i.created_by = u.id
       LEFT JOIN users u2 ON i.updated_by = u2.id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Вызов не найден' });
    }

    // Получить логи по этому вызову
    const logs = await pool.query(
      `SELECT al.*, u.full_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.entity_type = 'incident' AND al.entity_id = $1
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    res.json({
      incident: result.rows[0],
      logs: logs.rows
    });
  } catch (error) {
    console.error('Get incident error:', error);
    res.status(500).json({ error: 'Ошибка при получении вызова' });
  }
});

// Создать вызов
router.post('/', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const {
      incident_type,
      category,
      priority,
      description,
      address,
      city,
      region,
      latitude,
      longitude,
      caller_name,
      caller_phone,
      assigned_unit,
      personnel_count,
      vehicles_count,
      notes
    } = req.body;

    // Валидация
    if (!incident_type || !description || !address || !city || !category) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    // Генерируем номер вручную
    const countResult = await pool.query('SELECT COUNT(*) + 1 as next_id FROM incidents');
    const nextId = countResult.rows[0].next_id;
    const incidentNumber = `МЧС-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(nextId).padStart(4, '0')}`;

    const result = await pool.query(
      `INSERT INTO incidents (
        incident_number, incident_type, category, priority, status, description,
        address, city, region, latitude, longitude,
        caller_name, caller_phone, assigned_unit,
        personnel_count, vehicles_count, notes,
        created_by, reported_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        incidentNumber,
        incident_type,
        category,
        priority || 'medium',
        'new',
        description,
        address,
        city,
        region || null,
        latitude || null,
        longitude || null,
        caller_name || null,
        caller_phone || null,
        assigned_unit || null,
        personnel_count || 0,
        vehicles_count || 0,
        notes || null,
        req.user.id
      ]
    );

    const incident = result.rows[0];

    // Лог создания
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'CREATE', 'incident', incident.id, `Создан вызов ${incident.incident_number}: ${incident_type}`]
    );

    res.status(201).json({
      message: 'Вызов зарегистрирован',
      incident
    });
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({ error: 'Ошибка при создании вызова' });
  }
});

// Обновить вызов
router.put('/:id', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const {
      incident_type,
      category,
      priority,
      status,
      description,
      address,
      city,
      region,
      latitude,
      longitude,
      caller_name,
      caller_phone,
      assigned_unit,
      personnel_count,
      vehicles_count,
      notes
    } = req.body;

    // Проверяем существование
    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Вызов не найден' });
    }

    const oldIncident = existing.rows[0];

    // Определяем временные метки на основе статуса
    let dispatched_at = oldIncident.dispatched_at;
    let arrived_at = oldIncident.arrived_at;
    let resolved_at = oldIncident.resolved_at;

    if (status === 'dispatched' && !oldIncident.dispatched_at) {
      dispatched_at = new Date();
    }
    if (status === 'in_progress' && !oldIncident.arrived_at) {
      arrived_at = new Date();
    }
    if ((status === 'resolved' || status === 'closed') && !oldIncident.resolved_at) {
      resolved_at = new Date();
    }

    const result = await pool.query(
      `UPDATE incidents SET
        incident_type = COALESCE($1, incident_type),
        category = COALESCE($2, category),
        priority = COALESCE($3, priority),
        status = COALESCE($4, status),
        description = COALESCE($5, description),
        address = COALESCE($6, address),
        city = COALESCE($7, city),
        region = COALESCE($8, region),
        latitude = $9,
        longitude = $10,
        caller_name = $11,
        caller_phone = $12,
        assigned_unit = $13,
        personnel_count = COALESCE($14, personnel_count),
        vehicles_count = COALESCE($15, vehicles_count),
        notes = $16,
        dispatched_at = $17,
        arrived_at = $18,
        resolved_at = $19,
        updated_by = $20,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $21
      RETURNING *`,
      [
        incident_type, category, priority, status, description,
        address, city, region, latitude || null, longitude || null,
        caller_name || null, caller_phone || null, assigned_unit || null,
        personnel_count, vehicles_count, notes || null,
        dispatched_at, arrived_at, resolved_at,
        req.user.id, req.params.id
      ]
    );

    const incident = result.rows[0];

    // Лог изменений
    let changes = [];
    if (status !== oldIncident.status) changes.push(`статус: ${oldIncident.status} → ${status}`);
    if (priority !== oldIncident.priority) changes.push(`приоритет: ${oldIncident.priority} → ${priority}`);

    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'UPDATE', 'incident', incident.id,
        `Обновлён вызов ${incident.incident_number}. ${changes.length > 0 ? changes.join(', ') : 'Изменены данные'}`]
    );

    res.json({
      message: 'Вызов обновлён',
      incident
    });
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении вызова' });
  }
});

// Удалить вызов
router.delete('/:id', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Вызов не найден' });
    }

    const incident = existing.rows[0];

    // Удаляем логи
    await pool.query('DELETE FROM activity_logs WHERE entity_type = $1 AND entity_id = $2', ['incident', req.params.id]);

    // Удаляем вызов
    await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);

    // Лог удаления
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'DELETE', 'incident', parseInt(req.params.id),
        `Удалён вызов ${incident.incident_number}: ${incident.incident_type}`]
    );

    res.json({ message: 'Вызов удалён' });
  } catch (error) {
    console.error('Delete incident error:', error);
    res.status(500).json({ error: 'Ошибка при удалении вызова' });
  }
});

// Быстрое обновление статуса
router.patch('/:id/status', async (req, res) => {
  const pool = req.app.get('db');

  try {
    const { status } = req.body;
    const validStatuses = ['new', 'dispatched', 'in_progress', 'resolved', 'closed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Вызов не найден' });
    }

    const oldStatus = existing.rows[0].status;
    let updateFields = 'status = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP';
    let params = [status, req.user.id];
    let paramIdx = 3;

    if (status === 'dispatched' && !existing.rows[0].dispatched_at) {
      updateFields += `, dispatched_at = CURRENT_TIMESTAMP`;
    }
    if (status === 'in_progress' && !existing.rows[0].arrived_at) {
      updateFields += `, arrived_at = CURRENT_TIMESTAMP`;
    }
    if ((status === 'resolved' || status === 'closed') && !existing.rows[0].resolved_at) {
      updateFields += `, resolved_at = CURRENT_TIMESTAMP`;
    }

    const result = await pool.query(
      `UPDATE incidents SET ${updateFields} WHERE id = $${paramIdx} RETURNING *`,
      [...params, req.params.id]
    );

    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'STATUS_CHANGE', 'incident', parseInt(req.params.id),
        `Статус изменён: ${oldStatus} → ${status}`]
    );

    res.json({ message: 'Статус обновлён', incident: result.rows[0] });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении статуса' });
  }
});

module.exports = router;
