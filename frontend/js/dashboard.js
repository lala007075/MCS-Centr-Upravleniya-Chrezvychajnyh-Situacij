// ===== Dashboard Logic =====

let currentPage = 1;
let currentLimit = 20;
let currentIncidents = [];
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  // Auth check
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // Set user info
  const user = getUser();
  if (user) {
    document.getElementById('userName').textContent = user.full_name || 'Оператор';
    document.getElementById('userRole').textContent = user.role === 'admin' ? 'Администратор' : 'Оператор';
    const initials = user.full_name
      ? user.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
      : 'ОП';
    document.getElementById('userAvatar').textContent = initials;
  }

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Load data
  loadIncidents();

  // Auto-refresh every 30 seconds
  setInterval(loadIncidents, 30000);

  // Event listeners
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentPage = 1;
      loadIncidents();
    }, 500);
  });

  document.getElementById('filterStatus').addEventListener('change', () => {
    currentPage = 1;
    loadIncidents();
  });

  document.getElementById('filterPriority').addEventListener('change', () => {
    currentPage = 1;
    loadIncidents();
  });

  document.getElementById('filterType').addEventListener('change', () => {
    currentPage = 1;
    loadIncidents();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // ESC to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });

  // Mobile menu toggle
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  // Show menu toggle on mobile
  if (window.innerWidth <= 768) {
    menuToggle.style.display = 'block';
  }
});

function updateClock() {
  const now = new Date();
  const dateEl = document.getElementById('headerDate');
  const timeEl = document.getElementById('headerTime');

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

// ===== LOAD INCIDENTS =====
async function loadIncidents() {
  try {
    const search = document.getElementById('searchInput').value.trim();
    const status = document.getElementById('filterStatus').value;
    const priority = document.getElementById('filterPriority').value;
    const type = document.getElementById('filterType').value;

    const params = new URLSearchParams({
      page: currentPage,
      limit: currentLimit,
      ...(status !== 'all' && { status }),
      ...(priority !== 'all' && { priority }),
      ...(type !== 'all' && { type }),
      ...(search && { search })
    });

    const data = await apiRequest(`/incidents?${params}`);

    if (data) {
      currentIncidents = data.incidents;
      renderIncidents(data.incidents);
      renderPagination(data.pagination);
      updateStats(data.stats);
    }
  } catch (error) {
    console.error('Load incidents error:', error);
    document.getElementById('incidentsTableBody').innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <h3>Ошибка загрузки</h3>
          <p>${error.message}</p>
          <button class="btn btn-outline" onclick="loadIncidents()">Повторить</button>
        </div>
      </td></tr>
    `;
  }
}

function updateStats(stats) {
  if (!stats) return;
  document.getElementById('statTotal').textContent = stats.total || 0;
  const active = (parseInt(stats.new_count) || 0) +
    (parseInt(stats.dispatched_count) || 0) +
    (parseInt(stats.in_progress_count) || 0);
  document.getElementById('statActive').textContent = active;
  document.getElementById('statCritical').textContent = stats.critical_count || 0;
  document.getElementById('statResolved').textContent = (parseInt(stats.resolved_count) || 0) + (parseInt(stats.closed_count) || 0);

  // Update sidebar badge
  document.getElementById('activeIncidentsBadge').textContent = active;
}

function renderIncidents(incidents) {
  const tbody = document.getElementById('incidentsTableBody');

  if (!incidents || incidents.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3>Нет зарегистрированных вызовов</h3>
          <p>Создайте новый вызов, нажав кнопку «Новый вызов»</p>
          <button class="btn btn-orange" onclick="openCreateModal()">➕ Новый вызов</button>
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = incidents.map(incident => {
    const typeIconClass = incident.incident_type || 'other';

    return `
      <tr class="priority-${incident.priority}" style="animation: fadeIn 0.3s ease;">
        <td>
          <span class="incident-number">${incident.incident_number || `#${incident.id}`}</span>
        </td>
        <td>
          <div class="incident-type-cell">
            <div class="incident-type-icon ${typeIconClass}">
              ${getTypeIcon(incident.incident_type)}
            </div>
            <div class="incident-type-info">
              <span class="incident-type-name">${getTypeText(incident.incident_type)}</span>
              <span class="incident-type-category">${incident.category || ''}</span>
            </div>
          </div>
        </td>
        <td>
          <span class="badge badge-priority-${incident.priority}">
            ${getPriorityText(incident.priority)}
          </span>
        </td>
        <td>
          <span class="badge badge-status-${incident.status}">
            ${getStatusText(incident.status)}
          </span>
        </td>
        <td>
          <div class="address-cell">
            <div class="address-text" title="${incident.address}">${incident.address}</div>
            <div class="address-city">${incident.city}${incident.region ? ', ' + incident.region : ''}</div>
          </div>
        </td>
        <td>
          <div style="font-size: 14px; color: var(--text-primary);">${incident.caller_name || '—'}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${incident.caller_phone || ''}</div>
        </td>
        <td>
          <div class="time-cell">
            <div class="time-date">${formatDate(incident.created_at)}</div>
            <div class="time-ago">${timeAgo(incident.created_at)}</div>
          </div>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-icon" onclick="viewIncident(${incident.id})" title="Просмотр">👁️</button>
            <button class="btn-icon edit" onclick="editIncident(${incident.id})" title="Редактировать">✏️</button>
            <button class="btn-icon delete" onclick="deleteIncident(${incident.id}, '${incident.incident_number}')" title="Удалить">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPagination(pagination) {
  const info = document.getElementById('tableInfo');
  const paginationEl = document.getElementById('pagination');

  if (!pagination) return;

  const start = (pagination.page - 1) * pagination.limit + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);
  info.textContent = `Показано ${pagination.total > 0 ? start : 0}–${end} из ${pagination.total} вызовов`;

  let html = '';

  if (pagination.pages > 1) {
    // Prev button
    html += `<button ${pagination.page === 1 ? 'disabled' : ''} onclick="goToPage(${pagination.page - 1})">‹</button>`;

    // Page buttons
    for (let i = 1; i <= pagination.pages; i++) {
      if (
        i === 1 || i === pagination.pages ||
        (i >= pagination.page - 2 && i <= pagination.page + 2)
      ) {
        html += `<button class="${i === pagination.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
      } else if (i === pagination.page - 3 || i === pagination.page + 3) {
        html += `<button disabled>...</button>`;
      }
    }

    // Next button
    html += `<button ${pagination.page === pagination.pages ? 'disabled' : ''} onclick="goToPage(${pagination.page + 1})">›</button>`;
  }

  paginationEl.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadIncidents();
}

// ===== MODAL FUNCTIONS =====
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function openCreateModal() {
  document.getElementById('modalTitle').innerHTML = '🚨 Регистрация нового вызова';
  document.getElementById('incidentId').value = '';
  document.getElementById('incidentForm').reset();
  document.getElementById('statusGroup').style.display = 'none';
  document.getElementById('incidentPriority').value = 'medium';
  document.getElementById('saveIncidentBtn').innerHTML = '💾 Зарегистрировать вызов';
  openModal('incidentModal');
}

// ===== VIEW INCIDENT =====
async function viewIncident(id) {
  try {
    const data = await apiRequest(`/incidents/${id}`);
    if (!data) return;

    const incident = data.incident;

    document.getElementById('viewModalTitle').innerHTML = `📋 Вызов ${incident.incident_number || '#' + incident.id}`;

    document.getElementById('viewModalBody').innerHTML = `
      <div class="form-section">
        <div class="form-section-title">📋 Основная информация</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">Номер вызова</div>
            <div class="detail-item-value" style="font-family: monospace; color: var(--mchs-blue-light);">${incident.incident_number || '#' + incident.id}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Тип</div>
            <div class="detail-item-value">${getTypeIcon(incident.incident_type)} ${getTypeText(incident.incident_type)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Категория</div>
            <div class="detail-item-value">${incident.category || '—'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Приоритет</div>
            <div class="detail-item-value"><span class="badge badge-priority-${incident.priority}">${getPriorityText(incident.priority)}</span></div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Статус</div>
            <div class="detail-item-value"><span class="badge badge-status-${incident.status}">${getStatusText(incident.status)}</span></div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Оператор</div>
            <div class="detail-item-value">${incident.created_by_name || '—'}</div>
          </div>
          <div class="detail-item full-width">
            <div class="detail-item-label">Описание</div>
            <div class="detail-item-value">${incident.description}</div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">📍 Местоположение</div>
        <div class="detail-grid">
          <div class="detail-item full-width">
            <div class="detail-item-label">Адрес</div>
            <div class="detail-item-value">${incident.address}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Город</div>
            <div class="detail-item-value">${incident.city}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Регион</div>
            <div class="detail-item-value">${incident.region || '—'}</div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">👤 Заявитель</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">ФИО</div>
            <div class="detail-item-value">${incident.caller_name || '—'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Телефон</div>
            <div class="detail-item-value">${incident.caller_phone || '—'}</div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">🚒 Ресурсы</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">Подразделение</div>
            <div class="detail-item-value">${incident.assigned_unit || 'Не назначено'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Личный состав</div>
            <div class="detail-item-value">${incident.personnel_count || 0} чел.</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Техника</div>
            <div class="detail-item-value">${incident.vehicles_count || 0} ед.</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">Зарегистрирован</div>
            <div class="detail-item-value">${formatDateTime(incident.reported_at || incident.created_at)}</div>
          </div>
          ${incident.dispatched_at ? `
          <div class="detail-item">
            <div class="detail-item-label">Бригада направлена</div>
            <div class="detail-item-value">${formatDateTime(incident.dispatched_at)}</div>
          </div>` : ''}
          ${incident.arrived_at ? `
          <div class="detail-item">
            <div class="detail-item-label">Прибытие на место</div>
            <div class="detail-item-value">${formatDateTime(incident.arrived_at)}</div>
          </div>` : ''}
          ${incident.resolved_at ? `
          <div class="detail-item">
            <div class="detail-item-label">Завершён</div>
            <div class="detail-item-value">${formatDateTime(incident.resolved_at)}</div>
          </div>` : ''}
          ${incident.notes ? `
          <div class="detail-item full-width">
            <div class="detail-item-label">Примечания</div>
            <div class="detail-item-value">${incident.notes}</div>
          </div>` : ''}
        </div>
      </div>

      ${data.logs && data.logs.length > 0 ? `
      <div class="form-section">
        <div class="form-section-title">📜 История действий</div>
        <div style="max-height: 200px; overflow-y: auto;">
          ${data.logs.map(log => `
            <div style="padding: 8px 12px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
              <span style="color: var(--text-muted);">${formatDateTime(log.created_at)}</span>
              <span style="color: var(--text-secondary); margin-left: 8px;">${log.full_name || 'Система'}</span>
              <div style="color: var(--text-primary); margin-top: 2px;">${log.details}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;

    document.getElementById('viewEditBtn').onclick = () => {
      closeModal('viewModal');
      editIncident(id);
    };

    openModal('viewModal');
  } catch (error) {
    showToast('error', 'Ошибка', error.message);
  }
}

// ===== EDIT INCIDENT =====
async function editIncident(id) {
  try {
    const data = await apiRequest(`/incidents/${id}`);
    if (!data) return;

    const incident = data.incident;

    document.getElementById('modalTitle').innerHTML = `✏️ Редактирование вызова ${incident.incident_number || ''}`;
    document.getElementById('incidentId').value = incident.id;
    document.getElementById('incidentType').value = incident.incident_type || '';
    document.getElementById('incidentCategory').value = incident.category || '';
    document.getElementById('incidentPriority').value = incident.priority || 'medium';
    document.getElementById('incidentStatus').value = incident.status || 'new';
    document.getElementById('incidentDescription').value = incident.description || '';
    document.getElementById('incidentAddress').value = incident.address || '';
    document.getElementById('incidentCity').value = incident.city || '';
    document.getElementById('incidentRegion').value = incident.region || '';
    document.getElementById('callerName').value = incident.caller_name || '';
    document.getElementById('callerPhone').value = incident.caller_phone || '';
    document.getElementById('assignedUnit').value = incident.assigned_unit || '';
    document.getElementById('personnelCount').value = incident.personnel_count || 0;
    document.getElementById('vehiclesCount').value = incident.vehicles_count || 0;
    document.getElementById('incidentNotes').value = incident.notes || '';

    document.getElementById('statusGroup').style.display = 'block';
    document.getElementById('saveIncidentBtn').innerHTML = '💾 Сохранить изменения';

    openModal('incidentModal');
  } catch (error) {
    showToast('error', 'Ошибка', error.message);
  }
}

// ===== SAVE INCIDENT =====
async function saveIncident() {
  const id = document.getElementById('incidentId').value;
  const isEdit = !!id;

  const incidentData = {
    incident_type: document.getElementById('incidentType').value,
    category: document.getElementById('incidentCategory').value,
    priority: document.getElementById('incidentPriority').value,
    description: document.getElementById('incidentDescription').value,
    address: document.getElementById('incidentAddress').value,
    city: document.getElementById('incidentCity').value,
    region: document.getElementById('incidentRegion').value || null,
    caller_name: document.getElementById('callerName').value || null,
    caller_phone: document.getElementById('callerPhone').value || null,
    assigned_unit: document.getElementById('assignedUnit').value || null,
    personnel_count: parseInt(document.getElementById('personnelCount').value) || 0,
    vehicles_count: parseInt(document.getElementById('vehiclesCount').value) || 0,
    notes: document.getElementById('incidentNotes').value || null
  };

  if (isEdit) {
    incidentData.status = document.getElementById('incidentStatus').value;
  }

  // Validation
  if (!incidentData.incident_type || !incidentData.category || !incidentData.description ||
    !incidentData.address || !incidentData.city) {
    showToast('warning', 'Внимание', 'Заполните все обязательные поля');
    return;
  }

  const btn = document.getElementById('saveIncidentBtn');
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

  try {
    const endpoint = isEdit ? `/incidents/${id}` : '/incidents';
    const method = isEdit ? 'PUT' : 'POST';

    const data = await apiRequest(endpoint, {
      method,
      body: JSON.stringify(incidentData)
    });

    if (data) {
      showToast('success',
        isEdit ? 'Вызов обновлён' : 'Вызов зарегистрирован',
        data.message
      );
      closeModal('incidentModal');
      loadIncidents();
    }
  } catch (error) {
    showToast('error', 'Ошибка', error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ===== DELETE INCIDENT =====
function deleteIncident(id, number) {
  document.getElementById('deleteConfirmText').textContent =
    `Вызов ${number || '#' + id} будет безвозвратно удалён из системы. Продолжить?`;

  document.getElementById('confirmDeleteBtn').onclick = async () => {
    const btn = document.getElementById('confirmDeleteBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

    try {
      const data = await apiRequest(`/incidents/${id}`, { method: 'DELETE' });

      if (data) {
        showToast('success', 'Удалено', data.message);
        closeModal('deleteModal');
        loadIncidents();
      }
    } catch (error) {
      showToast('error', 'Ошибка удаления', error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🗑️ Удалить';
    }
  };

  openModal('deleteModal');
}

// ===== ABOUT =====
function showAbout() {
  const viewModal = document.getElementById('viewModal');
  document.getElementById('viewModalTitle').innerHTML = 'ℹ️ О системе';
  document.getElementById('viewModalBody').innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 64px; margin-bottom: 16px;">🛡️</div>
      <h2 style="font-size: 24px; font-weight: 800; margin-bottom: 8px;">МЧС РОССИИ</h2>
      <p style="color: var(--mchs-orange); font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 24px;">
        Единая система мониторинга вызовов
      </p>
      <div class="detail-grid" style="text-align: left;">
        <div class="detail-item">
          <div class="detail-item-label">Версия</div>
          <div class="detail-item-value">1.0.0</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Платформа</div>
          <div class="detail-item-value">Web Application</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Backend</div>
          <div class="detail-item-value">Node.js + Express</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">База данных</div>
          <div class="detail-item-value">PostgreSQL (Neon)</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Хостинг</div>
          <div class="detail-item-value">Render</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Единый номер</div>
          <div class="detail-item-value" style="color: var(--mchs-orange); font-weight: 800; font-size: 24px;">112</div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('viewEditBtn').style.display = 'none';
  openModal('viewModal');

  // Restore edit button visibility when closed
  const observer = new MutationObserver(() => {
    if (!viewModal.classList.contains('active')) {
      document.getElementById('viewEditBtn').style.display = '';
      observer.disconnect();
    }
  });
  observer.observe(viewModal, { attributes: true, attributeFilter: ['class'] });
}
