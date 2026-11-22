(() => {
  const STORE = 'runs';
  const serialize = value => JSON.parse(JSON.stringify(value));

  function database() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('此浏览器未启用 IndexedDB'));
        return;
      }
      const request = indexedDB.open('physics-lab-records', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'runId'});
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('实验记录库被其他页面占用'));
    });
  }

  function transaction(db, execute) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const result = execute(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result());
      tx.onabort = () => reject(tx.error ?? new Error('实验记录保存中断'));
    });
  }

  function create({legacy, onLoad, onError}) {
    const deferred = [];
    let loading = true;
    const db = database();
    let queue = db.then(connection => transaction(connection, store => {
      const list = store.getAll();
      let merged = [];
      list.onsuccess = () => {
        const migrated = legacy.filter(record => record?.runId);
        migrated.forEach(record => store.put(serialize(record)));
        const byId = new Map([...list.result, ...migrated].map(record => [record.runId, record]));
        for (const change of deferred) change.reconcile(byId);
        merged = [...byId.values()].sort((left, right) =>
          String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')));
      };
      return () => merged;
    })).then(records => {
      loading = false;
      onLoad(records);
    }).catch(error => {
      loading = false;
      onError(error);
    });

    function write(change) {
      if (loading) deferred.push(change);
      queue = queue.then(async () => {
        const connection = await db;
        await transaction(connection, store => {
          change.apply(store);
          return () => undefined;
        });
      }).catch(onError);
      return queue;
    }

    return {
      put(record) {
        const snapshot = serialize(record);
        return write({apply: store => store.put(snapshot), reconcile: all => all.set(snapshot.runId, snapshot)});
      },
      remove(id) {
        return write({apply: store => store.delete(id), reconcile: all => all.delete(id)});
      },
      clear() {
        return write({apply: store => store.clear(), reconcile: all => all.clear()});
      },
    };
  }

  globalThis.PhysicsRecordStorage = {create};
})();
