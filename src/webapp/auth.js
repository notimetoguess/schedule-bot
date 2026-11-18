(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const syncTheme = () => {
    const scheme = tg?.colorScheme;
    if ((scheme === 'dark' || scheme === 'light') && document.documentElement?.dataset) {
      document.documentElement.dataset.theme = scheme;
    }
  };
  syncTheme();
  tg?.onEvent?.('themeChanged', syncTheme);

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
  const submitIdleLabel = 'Увійти';
  let state = new URLSearchParams(location.search).get('state') || '';
  const fragmentData = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || '';
  const initData = tg?.initData || fragmentData;
  const messages = {
    INVALID_CREDENTIALS: 'Неправильна пошта або пароль. Перевірте дані й спробуйте ще раз.',
    AUTH_UNAVAILABLE: 'Сервіс входу тимчасово недоступний. Спробуйте пізніше.',
    REMEMBER_ME_UNAVAILABLE: 'Збереження входу недоступне. Введіть пароль і натисніть «Увійти» для звичайного входу.',
    INVALID_SESSION: 'Сесія застаріла. Поверніться до Telegram і відкрийте форму ще раз.',
    RATE_LIMITED: 'Забагато спроб входу. Спробуйте трохи пізніше.',
    UPSTREAM_UNAVAILABLE: 'Сервіс ЛНТУ тимчасово не відповідає. Спробуйте пізніше.'
  };

  // Deferred validation ARIA synchronization (mirrors :user-invalid without premature errors)
  const canUseDomValidation = typeof document.addEventListener === 'function'
    && typeof document.querySelectorAll === 'function';
  const supportsUserInvalid = typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('selector(:user-invalid)');
  const dirtyState = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();
  let announcer = null;
  let announceTimer;
  let announcedField;

  if (canUseDomValidation && typeof document.createElement === 'function' && document.body) {
    announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.classList.add('visually-hidden');
    document.body.append(announcer);
  }

  const linkError = (el, shown) => {
    const errorId = el?.dataset?.error;
    if (!errorId || typeof el.getAttribute !== 'function') return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute?.('aria-describedby');
  };

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => n.replaceWith(`${n.getAttribute('aria-label')}: `));
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };

  const announceError = (el) => {
    if (!announcer || !el?.dataset?.error) return;
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const isFieldUserInvalid = (el) => {
    if (el?.dataset?.programmaticClear) return false;
    if (supportsUserInvalid && typeof el.matches === 'function') {
      return el.matches(':user-invalid');
    }
    return Boolean(el.classList?.contains('user-invalid-fallback'));
  };

  const clearPasswordProgrammatically = () => {
    password.value = '';
    if (password.dataset) password.dataset.programmaticClear = 'true';
    syncAria(password);
  };

  const syncAria = (el, announce = false) => {
    if (!el || (typeof el.matches === 'function' && !el.matches('input, select, textarea'))) return;
    const invalid = isFieldUserInvalid(el);
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute?.('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        if (announcer) announcer.textContent = '';
      }
    }
  };

  const updateFallbackValidity = (input) => {
    if (supportsUserInvalid || !input?.validity) return;
    const isValid = input.validity.valid;
    input.classList?.toggle('user-invalid-fallback', !isValid);
    input.classList?.toggle('user-valid-fallback', isValid);
  };

  for (const field of [email, password]) {
    if (field) syncAria(field);
  }

  if (canUseDomValidation) {
    document.addEventListener('blur', (event) => {
      const target = event.target;
      if (!supportsUserInvalid && target?.validity) {
        const entry = dirtyState.get(target) || { hasInteracted: false, hasBlurred: false };
        entry.hasBlurred = true;
        dirtyState.set(target, entry);
        if (entry.hasInteracted) updateFallbackValidity(target);
      }
      syncAria(target, true);
    }, true);

    document.addEventListener('input', (event) => {
      const target = event.target;
      if (!supportsUserInvalid && target?.validity) {
        const entry = dirtyState.get(target) || { hasInteracted: false, hasBlurred: false };
        entry.hasInteracted = true;
        dirtyState.set(target, entry);
        if (entry.hasBlurred) updateFallbackValidity(target);
      }
      if (typeof target?.getAttribute === 'function' && target.getAttribute('aria-invalid') !== null) {
        syncAria(target);
      }
    });

    document.addEventListener('invalid', (event) => {
      const target = event.target;
      if (!supportsUserInvalid && target?.validity) {
        dirtyState.set(target, { hasInteracted: true, hasBlurred: true });
        updateFallbackValidity(target);
      }
      announced.add(target);
      syncAria(target);
    }, true);
  }

  const challengeReady = (async () => {
    if (state) return true;
    if (!initData) return false;
    submit.disabled = true;
    submit.textContent = 'Підготовка…';
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
      submit.textContent = submitIdleLabel;
    }
  })();

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
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
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
    email.setCustomValidity(valid ? '' : 'Введіть логін або пошту від кабінету студента.');
    return address;
  };

  email.addEventListener('input', normalizeEmail);
  normalizeEmail();

  password?.addEventListener('input', () => {
    if (password.dataset) delete password.dataset.programmaticClear;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'status';
    status.textContent = '';
    if (password?.dataset) delete password.dataset.programmaticClear;
    if (!(await challengeReady) || !state) {
      status.textContent = 'Telegram не передав дані сесії. Відкрийте форму через кнопку в боті.';
      return;
    }
    const address = normalizeEmail();
    const isFormValid = typeof form.checkValidity === 'function' ? form.checkValidity() : form.reportValidity();
    if (!isFormValid) {
      const firstInvalid = typeof form.querySelector === 'function' ? form.querySelector(':invalid') : null;
      if (firstInvalid) {
        syncAria(firstInvalid);
        firstInvalid.focus?.();
      } else {
        for (const field of [email, password]) {
          if (field?.validationMessage) {
            field.setAttribute('aria-invalid', 'true');
            linkError(field, true);
            field.focus?.();
            break;
          }
        }
      }
      return;
    }

    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Вхід…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          initData,
          email: address,
          password: password.value,
          rememberMe: !rememberMe.disabled && rememberMe.checked
        }),
        signal: controller.signal,
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => ({}));
      clearPasswordProgrammatically();
      if (!response.ok) {
        if (data.code === 'REMEMBER_ME_UNAVAILABLE') {
          rememberMe.checked = false;
          rememberMe.disabled = true;
        }
        const retry = data.retryAfterSeconds ? ` Через ${data.retryAfterSeconds} с.` : '';
        status.textContent = (messages[data.code] || 'Не вдалося виконати вхід.') + retry;
        return;
      }
      form.hidden = true;
      authIntro.hidden = true;
      privacy.hidden = true;
      successPanel.hidden = false;
    } catch (error) {
      clearPasswordProgrammatically();
      status.textContent = error?.name === 'AbortError'
        ? 'Сервер не відповідає. Спробуйте ще раз.'
        : 'Помилка з’єднання. Перевірте інтернет і повторіть спробу.';
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.removeAttribute?.('aria-busy');
      submit.textContent = submitIdleLabel;
    }
  });
})();
