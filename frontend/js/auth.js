// ===== Auth Page Logic =====

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  if (isAuthenticated()) {
    window.location.href = '/dashboard.html';
    return;
  }

  // Login Form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Register Form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }
});

async function handleLogin(e) {
  e.preventDefault();

  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showToast('warning', 'Внимание', 'Заполните все поля');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (data) {
      localStorage.setItem('mchs_token', data.token);
      localStorage.setItem('mchs_user', JSON.stringify(data.user));

      showToast('success', 'Успешный вход', `Добро пожаловать, ${data.user.full_name}`);

      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);
    }
  } catch (error) {
    showToast('error', 'Ошибка входа', error.message);
    btn.disabled = false;
    btn.innerHTML = '🔐 Войти в систему';
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const btn = document.getElementById('registerBtn');
  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const department = document.getElementById('department').value;
  const password = document.getElementById('password').value;
  const passwordConfirm = document.getElementById('passwordConfirm').value;

  if (!fullName || !email || !password) {
    showToast('warning', 'Внимание', 'Заполните все обязательные поля');
    return;
  }

  if (password !== passwordConfirm) {
    showToast('error', 'Ошибка', 'Пароли не совпадают');
    return;
  }

  if (password.length < 6) {
    showToast('error', 'Ошибка', 'Пароль должен содержать минимум 6 символов');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';

  try {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ full_name: fullName, email, password, phone, department })
    });

    if (data) {
      localStorage.setItem('mchs_token', data.token);
      localStorage.setItem('mchs_user', JSON.stringify(data.user));

      showToast('success', 'Регистрация успешна', 'Учётная запись создана');

      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);
    }
  } catch (error) {
    showToast('error', 'Ошибка регистрации', error.message);
    btn.disabled = false;
    btn.innerHTML = '📋 Зарегистрироваться';
  }
}
