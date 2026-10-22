const DATABASE = 'prosody-recording-set';
const MAX_BYTES = 150 * 1024 * 1024;

export class RecordingStore {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; this.opening = null; }

  open() {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('Browser storage is unavailable.')); return; }
      const request = this.factory.open(DATABASE, 1);
      let settled = false;
      const timer = setTimeout(() => {
        settled = true; this.opening = null;
        reject(new Error('Recording storage could not open. Close other recording-set tabs and retry.'));
      }, 10000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('takes')) request.result.createObjectStore('takes', {keyPath: 'id'});
      };
      request.onerror = () => { clearTimeout(timer); this.opening = null; reject(request.error); };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.opening = null; };
        resolve(db);
      };
    });
    this.opening.catch(() => { this.opening = null; });
    return this.opening;
  }

  async list() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('takes', 'readonly'), request = tx.objectStore('takes').getAll();
      tx.oncomplete = () => resolve(request.result.map(t => ({...t, persisted: true})));
      tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Could not read saved recordings.'));
    });
  }

  async save(take) {
    if (!(take.blob instanceof Blob) || !take.blob.size || !take.id) throw new Error('This recording is empty.');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction('takes', 'readwrite', {durability: 'strict'}); }
      catch { tx = db.transaction('takes', 'readwrite'); }
      const store = tx.objectStore('takes'), all = store.getAll();
      let failure;
      all.onsuccess = () => {
        const bytes = all.result.reduce((sum, t) => sum + (t.id === take.id ? 0 : t.blob.size), take.blob.size);
        if (bytes > MAX_BYTES) {
          failure = new Error('Recording storage is full. Download this take or your set as a backup.');
          tx.abort(); return;
        }
        store.put({...take, persisted: true});
      };
      // Request success alone is not proof that an IndexedDB write committed.
      tx.oncomplete = () => resolve({...take, persisted: true});
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('This take could not be saved.'));
    });
  }
}
