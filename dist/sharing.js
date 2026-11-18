(() => {
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  const title = '같이놀자 아일랜드';
  let settings;
  let sdkLoad;

  function configuration() {
    settings ??= fetch('/api/status', { signal: AbortSignal.timeout(3500) })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
    return settings;
  }

  async function inviteOrigin() {
    const info = await configuration();
    return loopback.includes(location.hostname) ? info.lanOrigin || location.origin : location.origin;
  }

  function prepareKakao(key) {
    if (!key || sdkLoad) return;
    sdkLoad = new Promise((resolve, reject) => {
      const sdk = document.createElement('script');
      sdk.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js';
      sdk.integrity = 'sha384-v6JKY3z4FUkWq21oZDHZe74YvuPk/WUrVLrDHTBojHXClOSa3iXy7sCXPY1jkFbj';
      sdk.crossOrigin = 'anonymous';
      sdk.onload = resolve;
      sdk.onerror = reject;
      document.head.append(sdk);
    }).then(() => {
      if (!window.Kakao.isInitialized()) window.Kakao.init(key);
    }).catch(() => {});
  }

  function prepare(link) {
    if (new URL(link).origin === location.origin) configuration().then(({ kakaoJsKey }) => prepareKakao(kakaoJsKey));
  }

  async function copy(input) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(input.value);
        return true;
      }
    } catch { /* Fall back to selecting the link. */ }
    input.focus();
    input.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
  }

  function phoneNumber(value) {
    const candidate = value.trim().replace(/[\s().-]/g, '');
    if (/^01\d{8,9}$/.test(candidate)) return `+82${candidate.slice(1)}`;
    return /^\+[1-9]\d{6,14}$/.test(candidate) ? candidate : null;
  }

  function mount(container, link, status, text) {
    container.append($('invite-sharing').content.cloneNode(true));
    const form = container.querySelector('form');
    const field = form.querySelector('input');
    const details = container.querySelector('details');
    const share = container.querySelector('.kakao-share');
    const dialog = container.closest('dialog');

    async function copyForKakao() {
      status.textContent = await copy(link)
        ? '링크를 복사했어요. 카카오톡 대화창에 붙여넣어 보내면 돼요.'
        : '선택된 링크를 복사해 카카오톡 대화창에 붙여넣어 주세요.';
    }

    share.addEventListener('click', async () => {
      const url = link.value;
      if (!url) return;
      if (window.Kakao?.isInitialized() && new URL(url).origin === location.origin) {
        try {
          window.Kakao.Share.sendDefault({ objectType: 'text', text, link: { webUrl: url, mobileWebUrl: url } });
          return;
        } catch { /* This browser can still use its share sheet. */ }
      }
      const payload = { title, text, url };
      if (navigator.share && (!navigator.canShare || navigator.canShare(payload))) {
        try {
          status.textContent = '공유 메뉴에서 카카오톡과 친구를 선택해 주세요.';
          await navigator.share(payload);
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      await copyForKakao();
    });

    field.addEventListener('input', () => field.setCustomValidity(''));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!link.value) return;
      const recipient = phoneNumber(field.value);
      if (!recipient) {
        field.setCustomValidity('010으로 시작하는 휴대전화 번호나 +로 시작하는 국제 전화번호를 입력해 주세요.');
        field.reportValidity();
        return;
      }
      const body = encodeURIComponent(`${text}\n${link.value}`);
      status.textContent = '문자 앱에서 받는 사람과 링크를 확인하고 보내 주세요.';
      field.value = '';
      location.href = `sms:${recipient}?body=${body}`;
    });
    dialog.addEventListener('close', () => {
      form.reset();
      field.setCustomValidity('');
      details.open = false;
    });
  }

  window.islandSharing = { inviteOrigin, prepare, copy, mount };
})();
