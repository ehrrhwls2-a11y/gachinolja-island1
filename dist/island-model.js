(() => {
  const legacyFire = [{ x: -0.41, y: 0.08 }, { x: 0, y: 0.27 }, { x: 0.43, y: 0.12 }];
  const characters = ['꼬마 사람', '토끼', '곰', '고양이', '여우', '사슴', '판다', '개구리'];
  const colors = ['#b3a6e9', '#96d1b8', '#eea591', '#ebca83', '#85afda', '#f2b2cb'];
  const colorNames = ['라벤더', '민트', '살구', '버터', '하늘', '분홍'];
  const moods = ['평온해요', '신나요', '졸려요', '집중 중', '쉬는 중', '친구 기다리는 중'];
  const shells = [
    [-0.78, 0.17], [-0.69, 0.39], [-0.49, 0.51], [-0.30, 0.61], [-0.12, 0.67],
    [0.07, 0.61], [0.24, 0.63], [0.43, 0.52], [0.61, 0.43], [0.79, 0.25],
  ];
  const categories = {
    plant: '식물', house: '집', tent: '텐트', bridge: '다리', terrain: '섬 지형', firepit: '모닥불',
  };
  const catalog = {
    hydrangeas: { slot: 'plant', name: '달빛 수국', cost: 3, shade: '#bba1ec' },
    fireflyTree: { slot: 'plant', name: '반딧불 나무', cost: 5, shade: '#9bcaa7' },
    moonCabin: { slot: 'house', name: '달빛 오두막', cost: 7, shade: '#d5a5aa', at: [0.42, 0.24] },
    blueCottage: { slot: 'house', name: '파란 지붕집', cost: 9, shade: '#80aed5', at: [0.42, 0.24] },
    starlightTent: { slot: 'tent', name: '별빛 텐트', cost: 3, shade: '#b4a2ec', at: [-0.42, 0.24] },
    mintTent: { slot: 'tent', name: '민트 텐트', cost: 5, shade: '#8bcdb4', at: [-0.42, 0.24] },
    cedarBridge: { slot: 'bridge', name: '삼나무 다리', cost: 4, shade: '#c89976' },
    lanternBridge: { slot: 'bridge', name: '랜턴 다리', cost: 6, shade: '#dfb4a3' },
    roundShore: { slot: 'terrain', name: '둥근 해변', cost: 0, shade: '#a2c7aa', shape: 0 },
    crescentShore: { slot: 'terrain', name: '초승달 해변', cost: 5, shade: '#b5a8d9', shape: 1 },
    beanShore: { slot: 'terrain', name: '강낭콩 해변', cost: 6, shade: '#8cbab3', shape: 2 },
    logFire: { slot: 'firepit', name: '나뭇가지 모닥불', cost: 0, shade: '#f6ae75' },
    stoneFire: { slot: 'firepit', name: '돌화로 모닥불', cost: 4, shade: '#d9987a' },
    violetFire: { slot: 'firepit', name: '보랏빛 모닥불', cost: 7, shade: '#c4a0f2' },
  };
  const defaults = { plant: null, house: null, tent: null, bridge: null, terrain: 'roundShore', firepit: 'logFire' };
  const terrains = ['roundShore', 'crescentShore', 'beanShore'];
  const shellInterval = 35000;
  const index = (number, total, fallback = 0) => Number.isInteger(number) && number >= 0 && number < total ? number : fallback;
  function point(value) {
    if (Number.isInteger(value)) return legacyFire[value] ? { ...legacyFire[value] } : null;
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 1 || Math.abs(value.y) > 1) return null;
    return { x: Number(value.x.toFixed(4)), y: Number(value.y.toFixed(4)) };
  }
  function normalize(input = {}) {
    const data = input || {};
    const collected = [...new Set((Array.isArray(data.collected) ? data.collected : []).filter(id => Number.isInteger(id) && id >= 0 && id < shells.length))];
    const shellCycles = Number.isSafeInteger(data.shellCycles) ? Math.min(10000, Math.max(0, data.shellCycles)) : 0;
    const refreshAt = Number.isSafeInteger(data.refreshAt) && data.refreshAt >= 0 ? data.refreshAt : 0;
    const oldTerrain = !data.decor && point(data.fire) ? terrains[index(data.shape, terrains.length)] : null;
    const legacyTerrain = terrains.slice(1).includes(data.legacyTerrain) ? data.legacyTerrain : oldTerrain !== terrains[0] ? oldTerrain : null;
    const legacyBuildings = !data.decor && Array.isArray(data.built)
      ? data.built.map(key => ({ tent: 'starlightTent', house: 'moonCabin' })[key]).filter(Boolean) : [];
    const owned = [];
    let remaining = shellCycles * shells.length + collected.length;
    for (const key of new Set([...(Array.isArray(data.owned) ? data.owned : []), ...legacyBuildings])) {
      const item = Object.hasOwn(catalog, key) && catalog[key];
      if (!item || !item.cost || key === legacyTerrain || item.cost > remaining) continue;
      owned.push(key);
      remaining -= item.cost;
    }
    const selected = data.decor || Object.fromEntries([
      ['terrain', legacyTerrain || defaults.terrain],
      ...legacyBuildings.map(key => [catalog[key].slot, key]),
    ]);
    const decor = { ...defaults };
    for (const slot of Object.keys(categories)) {
      const key = selected[slot];
      if (Object.hasOwn(catalog, key) && catalog[key].slot === slot && hasItem({ owned, legacyTerrain }, key)) decor[slot] = key;
    }
    return {
      character: index(data.character, characters.length),
      color: index(data.color, colors.length), shape: catalog[decor.terrain].shape,
      name: typeof data.name === 'string' ? data.name.trim().slice(0, 24) : '',
      fire: point(data.fire),
      collected, shellCycles, refreshAt, owned, legacyTerrain, decor,
      mood: moods.includes(data.mood) ? data.mood : '',
      hobby: typeof data.hobby === 'string' ? data.hobby.trim().slice(0, 80) : '',
    };
  }
  function balance(data) {
    return earned(data) - data.owned.reduce((total, key) => total + catalog[key].cost, 0);
  }
  const earned = (data) => data.shellCycles * shells.length + data.collected.length;
  const hasItem = (data, key) => Object.hasOwn(catalog, key) && (!catalog[key].cost || data.legacyTerrain === key || data.owned.includes(key));
  const shellsReturned = (data, now) => data.collected.length === shells.length && now >= data.refreshAt;
  globalThis.IslandModel = { characters, colors, colorNames, moods, shells, categories, catalog, defaults,
    normalize, point, index, balance, earned, hasItem, shellsReturned, shellInterval };
})();
