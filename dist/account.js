(() => {
  const dialog = $('account-dialog');
  const form = $('account-form');
  const login = $('account-login');
  const password = $('account-password');
  const saveStatus = $('island-save');
  const messages = {
    credentials: '아이디는 3~24자의 글자, 숫자, 밑줄 또는 하이픈을 쓰고, 비밀번호는 10자 이상으로 정해 주세요.',
    used: '이미 쓰고 있는 아이디예요. 다른 아이디로 가입하거나 로그인해 주세요.',
    invalid: '아이디나 비밀번호가 맞지 않아요.',
    rate: '로그인 시도가 많아요. 잠시 뒤 다시 시도해 주세요.',
    secure: '계정은 이 컴퓨터의 localhost 또는 HTTPS 주소에서 열 수 있어요.',
    session: '로그인 세션이 만료됐어요. 새로고침한 뒤 다시 로그인해 주세요.',
  };
  let account = null;
  let available = false;
  let signup = false;
  let pending = null;
  let writer = null;
  let busy = false;
  let saveTimer;

  async function call(path = '', method = 'GET', input) {
    const response = await fetch(`/api/account${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(6000),
      ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'request'), { status: response.status, data });
    return data;
  }

  function showError(message = '') {
    $('account-error').hidden = !message;
    $('account-error').textContent = message;
  }

  function showSave(message, fade = false) {
    clearTimeout(saveTimer);
    saveStatus.textContent = message;
    saveStatus.hidden = !message;
    if (fade) saveTimer = setTimeout(() => { saveStatus.hidden = true; }, 2800);
  }

  function refreshDialog() {
    $('account').textContent = account?.user?.name || '계정';
    $('account').setAttribute('aria-label', account?.user ? `${account.user.name} 계정` : '내 섬 계정');
    $('account-title').textContent = account?.user ? '내 섬 계정' : signup ? '내 섬 계정 만들기' : '내 섬 로그인';
    $('account-active').hidden = !account?.user;
    $('account-unavailable').hidden = available;
    form.hidden = !available || !!account?.user;
    $('account-name').textContent = account?.user?.name || '';
    $('account-island').textContent = account?.island ? `저장된 섬 · ${account.island.name || '나의 섬'}` : '섬을 만들면 이 계정에 저장돼요.';
    $('account-import').hidden = !signup || !readDeviceIsland();
    password.autocomplete = signup ? 'new-password' : 'current-password';
    $('account-submit').textContent = signup ? '계정 만들기' : '로그인';
    $('account-switch').textContent = signup ? '로그인으로' : '가입하기';
    $('account-retry').hidden = !pending || !!writer;
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['account-close', 'account-submit', 'account-switch', 'account-return', 'sign-out']) {
      $(id).disabled = value;
    }
  }

  async function savePending() {
    while (pending) {
      const snapshot = pending;
      pending = null;
      try {
        account = await call('/island', 'PUT', { island: snapshot, revision: account.revision });
        showSave('계정에 섬을 저장했어요.', true);
      } catch (error) {
        if (error.status === 409) {
          account = error.data;
          pending = null;
          loadIsland(account.island);
          showSave('다른 기기에서 먼저 저장한 섬을 불러왔어요.');
        } else {
          pending ??= snapshot;
          showSave(messages[error.message] || '섬 저장이 보류됐어요. 계정에서 다시 저장할 수 있어요.');
        }
        break;
      }
    }
  }

  function flush() {
    if (!writer && pending) {
      showSave('계정에 섬을 저장하는 중이에요.');
      writer = savePending().finally(() => {
        writer = null;
        refreshDialog();
      });
    }
    return writer;
  }

  window.islandAccount = {
    visitCode: () => account?.visitCode || null,
    save(snapshot) {
      if (!account?.user) return false;
      pending = { ...snapshot };
      flush();
      return true;
    },
  };

  $('account').addEventListener('click', () => {
    signup = false;
    refreshDialog();
    showError();
    dialog.showModal();
    (available && !account?.user ? login : $('account-close')).focus();
  });
  $('account-close').addEventListener('click', () => dialog.close());
  $('account-return').addEventListener('click', () => dialog.close());
  $('account-switch').addEventListener('click', () => {
    signup = !signup;
    password.value = '';
    showError();
    refreshDialog();
    login.focus();
  });
  $('account-retry').addEventListener('click', () => { flush(); refreshDialog(); });
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { password.value = ''; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError();
    setBusy(true);
    try {
      const input = { name: login.value, password: password.value };
      if (signup) input.island = readDeviceIsland();
      account = await call(signup ? '/signup' : '/login', 'POST', input);
      loadIsland(account.island);
      refreshDialog();
      dialog.close();
      if (account.island) showSave('계정에 저장된 섬을 불러왔어요.', true);
    } catch (error) {
      showError(messages[error.message] || '계정 서버에 연결하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  });

  $('sign-out').addEventListener('click', async () => {
    showError();
    setBusy(true);
    try {
      await flush();
      if (pending) {
        showError('아직 저장하지 못한 변경이 있어요. 섬을 다시 저장한 뒤 로그아웃해 주세요.');
        return;
      }
      account = await call('/logout', 'POST');
      loadIsland(readDeviceIsland());
      showSave('');
      refreshDialog();
      dialog.close();
    } catch {
      showError('로그아웃을 완료하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  });

  async function initialize() {
    $('account').disabled = true;
    try {
      if (location.protocol === 'file:') throw new Error('file');
      account = await call();
      available = account.enabled === true;
      if (account.user) loadIsland(account.island);
      if (!available) $('account-unavailable').textContent = messages.secure;
    } catch {
      $('account-unavailable').textContent = '계정을 쓰려면 로컬 서버를 실행하고 http://localhost:4173에서 열어 주세요.';
    } finally {
      refreshDialog();
      $('account').disabled = false;
    }
  }
  initialize();
})();
