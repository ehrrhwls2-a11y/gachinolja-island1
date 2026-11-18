(() => {
  const dialog = $('room-dialog');
  const inviteDialog = $('invite-dialog');
  const sharing = window.islandSharing;
  sharing.mount($('room-sharing'), $('invite-link'), $('invite-hint'), '같이놀자 아일랜드에서 지금 같이 놀자!');
  const map = document.createElement('canvas').getContext('2d');
  const directions = {
    ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
  };
  const keys = new Set();
  const inviteRoom = new URLSearchParams(location.search).get('room');
  let guest = false;
  let connection = null;
  let lastFrame = 0;
  let lastSend = 0;
  let target = null;

  async function request(path, body, token, options = {}) {
    const response = await fetch(`/api/${path}`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(7000), ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(await response.json().then((value) => value.error).catch(() => 'network'));
    return response.json();
  }

  function syncControls() {
    const active = !!connection;
    document.body.classList.toggle('in-room', active);
    $('room-controls').hidden = !active || placing;
    $('account').hidden = active;
    $('host-room').hidden = active;
    $('move').hidden = active && !connection.owner;
    if (active) $('tools').hidden = placing;
    window.islandLife?.sync();
  }

  function openDialog(forGuest) {
    guest = forGuest;
    $('room-title').textContent = guest ? '친구 섬에 놀러 가기' : '친구랑 놀기';
    $('guest-look').hidden = !guest;
    $('guest-character').value = island.character;
    $('guest-color').value = island.color;
    $('room-error').hidden = true;
    $('enter-room').textContent = guest ? '놀러 가기' : '초대방 열기';
    dialog.showModal();
    $('room-name').focus();
  }

  function roomStatus(room, message) {
    const title = $('island-title');
    const hint = $('hint');
    const status = message || `함께 있어요 · ${room.players.length}명`;
    if (title.textContent !== room.island.name) title.textContent = room.island.name;
    if (!placing && hint.textContent !== status) hint.textContent = status;
  }

  function receive(room, data) {
    room.island = data.island;
    room.visitCode = data.visitCode;
    const incoming = new Set(data.players.map((player) => player.id));
    for (const id of room.characters.keys()) if (!incoming.has(id)) room.characters.delete(id);
    for (const player of data.players) {
      const existing = room.characters.get(player.id);
      if (existing) {
        if (player.wave > existing.lastWave) {
          existing.waveUntil = performance.now() + 1700;
          existing.lastWave = player.wave;
        }
        existing.destinationX = player.x;
        existing.destinationY = player.y;
        existing.character = player.character;
        existing.color = player.color;
      } else {
        room.characters.set(player.id, { ...player, destinationX: player.x, destinationY: player.y, lastWave: player.wave, waveUntil: 0 });
      }
    }
    room.players = data.players;
    const me = room.characters.get(room.player);
    if (me && !walkable(me.x, me.y, room.island.shape)) {
      const fallback = IslandModel.point(1);
      if (walkable(fallback.x, fallback.y, room.island.shape)) {
        Object.assign(me, fallback);
        target = null;
        enqueue(room, fallback);
      }
    }
    roomStatus(room);
    window.islandLife?.sync();
  }

  function connect(data, owner) {
    const room = { id: data.room, token: data.token, player: data.id, owner, island: data.island, visitCode: data.visitCode, characters: new Map(), pending: {}, sending: false };
    connection = room;
    $('welcome').hidden = true;
    $('setup').hidden = true;
    $('island-info').hidden = false;
    syncControls();
    receive(room, data);
    const events = new EventSource(`/api/rooms/${room.id}/events?token=${room.token}`);
    room.events = events;
    events.onmessage = ({ data: message }) => {
      if (connection === room) receive(room, JSON.parse(message));
    };
    events.onerror = () => {
      if (connection !== room) return;
      const message = events.readyState === EventSource.CLOSED ? '연결이 끊겼어요. 초대 링크로 다시 들어갈 수 있어요.' : '친구들과 다시 연결하는 중이에요.';
      roomStatus(room, message);
    };
    $('wave').focus();
  }

  function enqueue(room, update) {
    Object.assign(room.pending, update);
    flush(room);
  }

  function flush(room) {
    if (connection !== room || room.sending || !Object.keys(room.pending).length) return;
    const update = room.pending;
    room.pending = {};
    room.sending = true;
    request(`rooms/${room.id}/move`, update, room.token).catch((error) => {
      if (error.message === 'rate' || error instanceof TypeError || error.name === 'TimeoutError') {
        room.pending = { ...update, ...room.pending };
      }
    }).finally(() => {
      room.sending = false;
      if (Object.keys(room.pending).length) setTimeout(() => flush(room), 85);
    });
  }

  function walkable(x, y, shape) {
    return y >= -0.66 && y <= 0.78 && Math.abs(x) <= 0.93 && map.isPointInPath(coastlines[shape], x / 0.94, y / 0.90);
  }

  function view(time) {
    const delta = Math.min(0.035, Math.max(0, (time - lastFrame) / 1000));
    lastFrame = time;
    const room = connection;
    if (!room) return null;
    const me = room.characters.get(room.player);
    if (me && scenery && !document.querySelector('dialog[open]') && !placing) {
      let horizontal = 0;
      let vertical = 0;
      for (const key of keys) {
        horizontal += directions[key][0];
        vertical += directions[key][1];
      }
      let distance = Math.hypot(horizontal, vertical);
      let [dx, dy] = turnVector(scenery, horizontal * scenery.ry / scenery.rx, vertical);
      if (target && !distance) {
        dx = target.x - me.x;
        dy = target.y - me.y;
        const [endX, endY] = project(scenery, target.x, target.y);
        const [startX, startY] = project(scenery, me.x, me.y);
        distance = Math.hypot(endX - startX, endY - startY) / scenery.ry;
      }
      if (distance) {
        const stride = target ? Math.min(distance, delta * 1.45) : delta * 1.45;
        const x = me.x + dx / distance * stride;
        const y = me.y + dy / distance * stride;
        const moved = walkable(x, y, room.island.shape);
        if (moved) { me.x = x; me.y = y; }
        if (!moved || (target && stride === distance)) target = null;
      }
      if (time - lastSend >= 70 && (me.sentX !== me.x || me.sentY !== me.y)) {
        lastSend = time;
        me.sentX = me.x;
        me.sentY = me.y;
        enqueue(room, { x: me.x, y: me.y });
      }
    }
    const blend = Math.min(1, delta * 16);
    const players = [];
    for (const player of room.characters.values()) {
      if (player !== me) {
        player.x += (player.destinationX - player.x) * blend;
        player.y += (player.destinationY - player.y) * blend;
      }
      players.push({ ...player, wave: player.waveUntil > time ? 1 : 0 });
    }
    return { island: room.island, players };
  }

  function leave() {
    const room = connection;
    if (!room) return;
    connection = null;
    target = null;
    keys.clear();
    disconnect(room);
    syncControls();
    if (island.fire === null) {
      placing = false;
      step = 0;
      $('island-info').hidden = true;
      $('tools').hidden = true;
      showSetup();
    } else {
      showIsland(false);
      $('host-room').focus();
    }
  }

  function disconnect(room) {
    room.events.close();
    request(`rooms/${room.id}/leave`, {}, room.token, { keepalive: true }).catch(() => {});
  }

  window.islandMultiplayer = {
    syncControls, view,
    details: () => connection,
    updateIsland(next) {
      if (!connection?.owner) return;
      connection.island = { ...next };
      const me = connection.characters.get(connection.player);
      if (me) Object.assign(me, { character: next.character, color: next.color });
      enqueue(connection, { island: next });
    },
    walkTo(screenX, screenY) {
      if (!connection || !scenery || placing || photoDialog.open) return;
      const [x, y] = unproject(scenery, screenX, screenY);
      if (walkable(x, y, connection.island.shape)) target = { x, y };
    },
  };

  $('host-room').addEventListener('click', () => openDialog(false));
  $('close-room-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    if ($('enter-room').disabled) event.preventDefault();
  });
  $('room-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('enter-room').disabled = true;
    $('close-room-dialog').disabled = true;
    $('room-error').hidden = true;
    try {
      const profile = guest ? { character: Number($('guest-character').value), color: Number($('guest-color').value) } : island;
      const path = guest ? `rooms/${inviteRoom}/join` : 'rooms';
      const data = await request(path, { character: profile.character, color: profile.color, name: $('room-name').value,
        ...(guest ? {} : { island, visitCode: window.islandAccount?.visitCode() }) });
      dialog.close();
      connect(data, !guest);
      if (!guest) $('copy-invite').click();
    } catch (error) {
      $('room-error').hidden = false;
      $('room-error').textContent = error.message === 'room' ? '이 초대방은 닫혔어요. 새 링크를 받아 주세요.'
        : error.message === 'full' ? '친구가 가득 찼어요. 한 방에 8명까지 들어갈 수 있어요.'
        : '함께 놀기 서버에 연결할 수 없어요. 서버가 실행된 주소에서 열어 주세요.';
    } finally {
      $('enter-room').disabled = false;
      $('close-room-dialog').disabled = false;
    }
  });

  $('copy-invite').addEventListener('click', async () => {
    const room = connection;
    if (!room) return;
    const origin = await sharing.inviteOrigin();
    if (connection !== room || inviteDialog.open) return;
    $('invite-link').value = `${origin}/?room=${room.id}`;
    $('invite-hint').textContent = location.protocol === 'http:' ? '같은 Wi-Fi에서 이 링크를 열면 같이 놀 수 있어요.' : '';
    sharing.prepare($('invite-link').value);
    inviteDialog.showModal();
  });
  $('copy-link').addEventListener('click', async () => {
    const copied = await sharing.copy($('invite-link'));
    $('invite-hint').textContent = copied ? '초대 링크를 복사했어요.' : '선택된 링크를 복사해 친구에게 보내 주세요.';
  });
  $('leave-room').addEventListener('click', leave);
  $('wave').addEventListener('click', () => {
    if (!connection) return;
    const me = connection.characters.get(connection.player);
    if (me) me.waveUntil = performance.now() + 1700;
    enqueue(connection, { wave: true });
  });

  function direction(event) { return event.key.length === 1 ? event.key.toLowerCase() : event.key; }
  window.addEventListener('keydown', (event) => {
    const key = direction(event);
    if (!connection || !Object.hasOwn(directions, key) || document.querySelector('dialog[open]') || placing || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    target = null;
    keys.add(key);
  });
  window.addEventListener('keyup', (event) => keys.delete(direction(event)));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('pagehide', (event) => {
    if (connection && !event.persisted) disconnect(connection);
  });
  $('guest-character').replaceChildren(...characters.map((label, value) => new Option(label, value)));
  $('guest-color').replaceChildren(...colorNames.map((label, value) => new Option(label, value)));
  if (/^[0-9a-f]{20}$/.test(inviteRoom ?? '')) window.afterIslandLetter(() => openDialog(true));
})();
