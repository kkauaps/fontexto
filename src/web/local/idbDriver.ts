/** IndexedDB storage for the browser edition: everything stays in this browser profile, nothing is uploaded. */
import type { StorageDriver } from '../../core/coreStore';

const DB = 'fontexto';
const JSON_STORE = 'json';
const BYTES_STORE = 'bytes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(JSON_STORE);
      req.result.createObjectStore(BYTES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
}

const wrap = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class IdbDriver implements StorageDriver {
  private db: Promise<IDBDatabase> = open();
  private async store(name: string, mode: IDBTransactionMode) {
    return (await this.db).transaction(name, mode).objectStore(name);
  }
  private k = (p: string, n: string) => `${p}/${n}`;

  async getJson<T>(p: string, n: string) {
    return (await wrap((await this.store(JSON_STORE, 'readonly')).get(this.k(p, n)))) as T | undefined;
  }
  async putJson(p: string, n: string, data: unknown) {
    await wrap((await this.store(JSON_STORE, 'readwrite')).put(JSON.parse(JSON.stringify(data)), this.k(p, n)));
  }
  async getBytes(p: string, n: string) {
    const v = (await wrap((await this.store(BYTES_STORE, 'readonly')).get(this.k(p, n)))) as ArrayBuffer | Uint8Array | undefined;
    return v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : undefined;
  }
  async putBytes(p: string, n: string, data: Uint8Array) {
    const copy = data.buffer.byteLength === data.byteLength ? data.buffer.slice(0) : data.slice().buffer;
    await wrap((await this.store(BYTES_STORE, 'readwrite')).put(copy, this.k(p, n)));
  }
  async remove(p: string, n: string) {
    await wrap((await this.store(JSON_STORE, 'readwrite')).delete(this.k(p, n)));
    await wrap((await this.store(BYTES_STORE, 'readwrite')).delete(this.k(p, n)));
  }
  async removeProject(p: string) {
    const range = IDBKeyRange.bound(`${p}/`, `${p}/\uffff`);
    await wrap((await this.store(JSON_STORE, 'readwrite')).delete(range));
    await wrap((await this.store(BYTES_STORE, 'readwrite')).delete(range));
  }
  async listProjects() {
    const keys = (await wrap((await this.store(JSON_STORE, 'readonly')).getAllKeys())) as string[];
    return keys.filter((k) => k.endsWith('/project.json')).map((k) => k.split('/')[0]);
  }
}
