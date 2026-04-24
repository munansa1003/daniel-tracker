// localStorage 기반 저장소 (오프라인에서도 작동)
const DB_PREFIX = 'dt_';

const store = {
  get(key) {
    try {
      const raw = localStorage.getItem(DB_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  set(key, value) {
    try {
      localStorage.setItem(DB_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage error:', e);
      return false;
    }
  },

  delete(key) {
    try {
      localStorage.removeItem(DB_PREFIX + key);
      return true;
    } catch { return false; }
  },

  list(prefix) {
    const keys = [];
    const fullPrefix = DB_PREFIX + prefix;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(fullPrefix)) {
        keys.push(k.replace(DB_PREFIX, ''));
      }
    }
    return keys;
  },

  // 전체 데이터 백업 (JSON)
  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(DB_PREFIX)) {
        data[k] = localStorage.getItem(k);
      }
    }
    return JSON.stringify(data);
  },

  // 백업에서 복원
  importAll(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      Object.entries(data).forEach(([k, v]) => {
        localStorage.setItem(k, v);
      });
      return true;
    } catch { return false; }
  },

  // 전체 삭제
  clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(DB_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  }
};

export default store;
