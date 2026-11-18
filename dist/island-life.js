(() => {
  const model = IslandModel;
  const workshop = $('workshop-dialog');
  const shop = $('shop-dialog');
  const look = $('look-dialog');
  const profile = $('profile-dialog');
  const book = $('guestbook-dialog');
  const sharing = window.islandSharing;
  sharing.mount($('island-sharing'), $('visit-link'), $('guestbook-status'), '같이놀자 아일랜드에서 내 섬에 놀러 와!');
  const room = () => window.islandMultiplayer?.details();
  let visit = null;
  let visitCode = null;
  let lookDraft;
  let bookCode;
  let decorSlot = 'plant';

  function canEdit() {
    return !!island.fire && !placing && !visit && (!room() || room().owner);
  }

  function sync() {
    const shared = room();
    const editable = canEdit();
    const scene = shared?.island || visit || island;
    $('island-life').hidden = placing || (!editable && !shared && !visit);
    for (const id of ['decor-header', 'profile', 'look', 'shell-count']) $(id).hidden = !editable;
    const balance = `조개 ${model.earned(island)}개 · ${model.balance(island)} 포인트`;
    if ($('shell-count').textContent !== balance) $('shell-count').textContent = balance;
    const bio = [scene.mood && `지금 ${scene.mood}`, scene.hobby && `요즘 취미 · ${scene.hobby}`].filter(Boolean).join('  /  ');
    const bioStatus = $('island-bio');
    if (bioStatus.textContent !== bio) bioStatus.textContent = bio;
    bioStatus.hidden = !bio || placing;
    if (visit) {
      for (const id of ['welcome', 'setup', 'host-room', 'move', 'account']) $(id).hidden = true;
      for (const id of ['island-info', 'tools', 'leave-visit']) $(id).hidden = false;
      $('island-title').textContent = visit.name || '친구의 섬';
      $('hint').textContent = '친구의 섬을 둘러보고 방명록을 남겨보세요.';
    }
  }

  function pick(id) {
    if (!canEdit()) return false;
    const now = Date.now();
    if (model.shellsReturned(island, now)) {
      island.shellCycles++;
      island.collected = [];
      island.refreshAt = 0;
    }
    if (island.collected.includes(id)) return false;
    island.collected.push(id);
    if (island.collected.length === shells.length) island.refreshAt = now + model.shellInterval;
    persistIsland();
    $('hint').textContent = island.refreshAt ? '조개 +1 포인트. 잠시 뒤 파도가 조개를 다시 가져와요.' : '조개를 주웠어요. +1 포인트';
    return true;
  }

  function pickAt(screenX, screenY) {
    if (!canEdit() || !scenery) return false;
    let nearest = 24;
    let selected;
    const fresh = model.shellsReturned(island, Date.now());
    shells.forEach((_, id) => {
      if (!fresh && island.collected.includes(id)) return;
      const [x, y] = project(scenery, ...shellAt(island.shape, id));
      const distance = Math.hypot(x - screenX, y - screenY);
      if (distance < nearest) { nearest = distance; selected = id; }
    });
    return selected !== undefined && pick(selected);
  }

  function renderCatalog(mode) {
    const shopping = mode === 'shop';
    const points = model.balance(island);
    if (shopping) $('shop-points').textContent = `보유 포인트 · ${points}`;
    const tabs = Object.entries(model.categories).map(([slot, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = label;
      button.setAttribute('aria-pressed', String(slot === decorSlot));
      button.addEventListener('click', () => { decorSlot = slot; renderCatalog(mode); $(`${mode}-tabs`).querySelector('[aria-pressed="true"]').focus(); });
      return button;
    });
    $(`${mode}-tabs`).replaceChildren(...tabs);
    const entries = Object.entries(model.catalog).filter(([key, item]) => item.slot === decorSlot &&
      (shopping ? item.cost > 0 : model.hasItem(island, key)));
    if (!shopping && island.decor[decorSlot] && !model.defaults[decorSlot]) {
      entries.push([null, { name: '배치 해제', shade: '#948c9e' }]);
    }
    const rows = entries.map(([key, item]) => {
      const row = document.createElement('article');
      row.dataset.item = key || 'none';
      const label = document.createElement('div');
      const swatch = document.createElement('span');
      swatch.className = 'catalog-swatch';
      swatch.style.backgroundColor = item.shade;
      swatch.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      const name = document.createElement('strong');
      const caption = document.createElement('small');
      const action = document.createElement('button');
      const owned = key && model.hasItem(island, key);
      const equipped = key === island.decor[decorSlot];
      name.textContent = item.name;
      caption.textContent = shopping ? `${item.cost} 포인트` : item.cost === 0 ? '기본' : key ? '내 소유' : '';
      caption.hidden = !caption.textContent;
      action.type = 'button';
      action.className = 'secondary';
      action.textContent = shopping ? owned ? '해금 완료' : '구매' : equipped ? '사용 중' : key ? '적용' : '빼기';
      action.disabled = shopping ? owned || points < item.cost : equipped;
      action.addEventListener('click', () => {
        if (!canEdit()) return;
        if (shopping) {
          if (model.hasItem(island, key) || model.balance(island) < item.cost) return;
          island.owned.push(key);
          $('shop-status').textContent = `${item.name} 해금 완료! 섬 꾸미기에서 사용할 수 있어요.`;
        } else {
          if (key && !model.hasItem(island, key)) return;
          island.decor[decorSlot] = key;
          if (decorSlot === 'terrain') {
            island.shape = item.shape;
            if (!onIsland(island.shape, island.fire.x, island.fire.y)) island.fire = model.point(1);
          }
          $('hint').textContent = key ? `${item.name} 적용 완료!` : '배치를 해제했어요.';
        }
        persistIsland();
        renderCatalog(mode);
        $(`${mode}-tabs`).querySelector('[aria-pressed="true"]').focus();
      });
      title.append(name, caption);
      label.append(swatch, title);
      row.append(label, action);
      return row;
    });
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'account-note';
      empty.textContent = '포인트 상점에서 이 종류의 물건을 해금해 보세요.';
      rows.push(empty);
    }
    $(`${mode}-list`).replaceChildren(...rows);
  }

  function openCatalog(mode) {
    if (!canEdit()) return;
    if (mode === 'shop') {
      if (workshop.open) workshop.close();
      $('shop-status').textContent = '';
    } else if (shop.open) shop.close();
    renderCatalog(mode);
    (mode === 'shop' ? shop : workshop).showModal();
  }

  const bookPath = (code) => `/api/islands/${code}/guestbook`;
  const date = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });

  function renderNotes(notes) {
    const entries = notes.map((note) => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      const time = document.createElement('time');
      const text = document.createElement('p');
      name.textContent = note.visitor;
      time.textContent = date.format(note.createdAt);
      time.dateTime = new Date(note.createdAt).toISOString();
      text.textContent = note.message;
      item.append(name, time, text);
      return item;
    });
    $('guestbook-status').textContent = notes.length ? '' : '첫 방명록을 기다리고 있어요.';
    $('guestbook-list').replaceChildren(...entries);
  }

  async function api(path, input) {
    const response = await fetch(path, {
      signal: AbortSignal.timeout(6000),
      ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  async function openBook() {
    const ownerCode = canEdit() ? window.islandAccount?.visitCode() : null;
    const code = visitCode || room()?.visitCode || ownerCode;
    bookCode = code;
    $('guestbook-title').textContent = '섬 방명록';
    $('guestbook-list').replaceChildren();
    $('guestbook-form').hidden = !code || !!ownerCode;
    $('visit-share').hidden = true;
    $('guestbook-status').textContent = code ? '방명록을 불러오는 중이에요.' : '섬 주인이 계정에 섬을 저장하면 방명록을 열 수 있어요.';
    if (!book.open) book.showModal();
    if (!code) return;
    try {
      const [data, origin] = await Promise.all([api(bookPath(code)), ownerCode ? sharing.inviteOrigin() : null]);
      if (code !== bookCode || !book.open) return;
      renderNotes(data.notes);
      if (origin) {
        $('visit-share').hidden = false;
        $('visit-link').value = `${origin}/?island=${code}`;
        sharing.prepare($('visit-link').value);
      }
    } catch { $('guestbook-status').textContent = '방명록을 열지 못했어요. 잠시 뒤 다시 열어봐요.'; }
  }

  $('mood').append(...model.moods.map((label) => new Option(label, label)));
  $('workshop').addEventListener('click', () => openCatalog('decor'));
  $('point-shop').addEventListener('click', () => openCatalog('shop'));
  $('open-decor-from-shop').addEventListener('click', () => openCatalog('decor'));
  $('open-shop-from-decor').addEventListener('click', () => openCatalog('shop'));
  $('close-decor').addEventListener('click', () => workshop.close());
  $('close-shop').addEventListener('click', () => shop.close());
  $('look').addEventListener('click', () => {
    lookDraft = { character: island.character, color: island.color };
    lookOptions($('look-options'), lookDraft);
    look.showModal();
  });
  $('close-look').addEventListener('click', () => look.close());
  $('look-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canEdit()) return;
    Object.assign(island, lookDraft);
    persistIsland();
    look.close();
  });
  $('profile').addEventListener('click', () => {
    $('mood').value = island.mood;
    $('hobby').value = island.hobby;
    profile.showModal();
  });
  $('close-profile').addEventListener('click', () => profile.close());
  $('profile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canEdit()) return;
    island.mood = $('mood').value;
    island.hobby = $('hobby').value.trim();
    persistIsland();
    profile.close();
  });
  $('guestbook').addEventListener('click', openBook);
  $('copy-visit').addEventListener('click', async () => {
    const copied = await sharing.copy($('visit-link'));
    $('guestbook-status').textContent = copied ? '방문 링크를 복사했어요.' : '선택된 주소를 복사해 주세요.';
  });
  $('guestbook-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const send = event.currentTarget.querySelector('button');
    send.disabled = true;
    try {
      const data = await api(bookPath(bookCode), { name: $('guestbook-name').value, message: $('guestbook-message').value });
      $('guestbook-message').value = '';
      renderNotes(data.notes);
    } catch (error) {
      $('guestbook-status').textContent = error.message === '429' ? '잠시 기다렸다가 다시 남겨 주세요.' : '글을 저장하지 못했어요. 내용을 확인해 주세요.';
    } finally { send.disabled = false; }
  });

  $('leave-visit').addEventListener('click', () => {
    visit = null;
    visitCode = null;
    const url = new URL(location.href);
    url.searchParams.delete('island');
    history.replaceState(null, '', url);
    $('leave-visit').hidden = true;
    for (const id of ['host-room', 'move', 'account']) $(id).hidden = false;
    loadIsland(island.fire ? island : null);
  });

  window.islandLife = { sync, pickAt, currentVisit: () => visit };
  sync();
  const params = new URLSearchParams(location.search);
  const destination = params.get('island');
  if (!params.has('room') && /^[a-f0-9]{30}$/.test(destination)) {
    window.afterIslandLetter(() => {
      api(`/api/islands/${destination}`).then((data) => {
        visit = model.normalize(data.island);
        visitCode = destination;
        sync();
      }).catch(() => {
        $('guestbook-title').textContent = '친구의 섬';
        $('guestbook-status').textContent = '이 링크에서 섬을 찾지 못했어요.';
        book.showModal();
      });
    });
  }
})();
