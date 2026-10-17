(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  const form = document.getElementById('auth-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const rememberMe = document.getElementById('remember-me');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');
  const toggle = document.getElementById('toggle-password');
  const authIntro = document.getElementById('auth-intro');
  const privacy = document.getElementById('privacy');
  const successPanel = document.getElementById('success-panel');
  const returnCurrent = document.getElementById('return-current');
  const returnGroup = document.getElementById('return-group');
  const emailDomain = document.getElementById('email-domain');
  const lntuDomain = '@lntu.edu.ua';
  let state = new URLSearchParams(location.search).get('state') || '';
  const fragmentData = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || '';
  const initData = tg?.initData || fragmentData;
  const messages = {
    INVALID_CREDENTIALS: 'Неправильна електронна адреса або пароль.',
    AUTH_UNAVAILABLE: 'Сервіс авторизації тимчасово недоступний. Спробуйте пізніше.',
    INVALID_SESSION: 'Посилання застаріло. Поверніться до Telegram і відкрийте авторизацію ще раз.',
    RATE_LIMITED: 'Забагато спроб. Спробуйте трохи пізніше.',
    UPSTREAM_UNAVAILABLE: 'Сервіс ЛНТУ тимчасово недоступний. Спробуйте пізніше.'
  };

  const challengeReady = (async () => {
    if (state) return true;
    if (!initData) return false;
    submit.disabled = true;
    submit.textContent = 'Готуємо форму…';
    try {
      const response = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.state) return false;
      state = data.state;
      return true;
    } catch {
      return false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Авторизуватися';
    }
  })();

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Сховати' : 'Показати';
    toggle.setAttribute('aria-label', show ? 'Сховати пароль' : 'Показати пароль');
  });

  returnCurrent.addEventListener('click', () => {
    tg.switchInlineQuery('show');
  });

  returnGroup.addEventListener('click', () => {
    tg.close();
  });

  const normalizeEmail = () => {
    const entered = email.value.trim();
    emailDomain.hidden = entered.includes('@');
    const address = entered.includes('@') ? entered : entered + lntuDomain;
    email.setCustomValidity(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? '' : 'Введіть повну адресу електронної пошти WebDk.');
    return address;
  };

  email.addEventListener('input', normalizeEmail);
  normalizeEmail();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'status';
    status.textContent = '';
    if (!(await challengeReady) || !state) {
      status.textContent = 'Telegram не передав дані авторизації. Відкрийте Mini App через кнопку в боті.';
      return;
    }
    const address = normalizeEmail();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = 'Перевіряємо…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, initData, email: address, password: password.value, rememberMe: rememberMe.checked }),
        signal: controller.signal,
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      password.value = '';
      if (!response.ok) {
        const retry = data.retryAfterSeconds ? ' Через ' + data.retryAfterSeconds + ' с.' : '';
        status.textContent = (messages[data.code] || 'Не вдалося авторизуватися.') + retry;
        return;
      }
      form.hidden = true;
      authIntro.hidden = true;
      privacy.hidden = true;
      successPanel.hidden = false;
    } catch (error) {
      password.value = '';
      status.textContent = error?.name === 'AbortError' ? 'Сервер не відповідає. Спробуйте ще раз.' : 'Помилка з’єднання. Перевірте мережу.';
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.textContent = 'Авторизуватися';
    }
  });
})();
