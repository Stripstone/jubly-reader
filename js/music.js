(function () {
  const MUSIC_DB_NAME = 'rc_music_v1';
  const MUSIC_DB_VERSION = 1;
  const MUSIC_STORE = 'tracks';
  const CUSTOM_ID = 'custom';
  let dbPromise = null;

  function openMusicDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MUSIC_STORE)) {
          db.createObjectStore(MUSIC_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open music database'));
    });
    return dbPromise;
  }

  async function customMusicPut(blob, name, type) {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MUSIC_STORE, 'readwrite');
      const store = tx.objectStore(MUSIC_STORE);
      store.put({ id: CUSTOM_ID, blob, name: name || 'Custom track', type: type || (blob && blob.type) || '', savedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Failed to save custom music'));
      tx.onabort = () => reject(tx.error || new Error('Failed to save custom music'));
    });
  }

  async function customMusicGet() {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MUSIC_STORE, 'readonly');
      const store = tx.objectStore(MUSIC_STORE);
      const req = store.get(CUSTOM_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Failed to load custom music'));
    });
  }

  async function customMusicDelete() {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MUSIC_STORE, 'readwrite');
      const store = tx.objectStore(MUSIC_STORE);
      store.delete(CUSTOM_ID);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Failed to delete custom music'));
      tx.onabort = () => reject(tx.error || new Error('Failed to delete custom music'));
    });
  }

  window.rcMusicDb = { openMusicDb, customMusicPut, customMusicGet, customMusicDelete };
})();
