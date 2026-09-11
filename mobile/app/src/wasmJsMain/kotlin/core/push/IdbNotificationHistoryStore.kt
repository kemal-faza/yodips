package ac.undip.sso.core.push

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlin.coroutines.resume

/**
 * IndexedDB-backed [NotificationHistoryStore] (PWA / wasmJs).
 *
 * Service worker TIDAK punya `localStorage` (Web Storage hanya tersedia di
 * Window/Worker, bukan ServiceWorkerGlobalScope) — jadi riwayat push dan
 * pending-nav TASK 6 dibagikan lewat IndexedDB: DB `sso_notif`, object store
 * `history` (keyPath `id`), dengan dua record:
 *  - `{id: 'list', items: [...]}`  — riwayat `StoredNotification` (array, sama
 *    dengan bentuk array yang dulu disimpan di localStorage `sso_notif_history`);
 *  - `{id: 'pendingNav', target}`  — target navigasi tap-notifikasi (pengganti
 *    localStorage `sso_pending_nav`).
 *
 * Konsumen dan penulis kedua record adalah service worker yang di-generate
 * `web/scripts/pwa-app-core.mjs` — jaga nama DB/store/key tetap sinkron.
 *
 * Catatan dedup: SW menulis `id = title + '|' + body` (di generator), dan
 * `mergeNotification` (commonMain) MEMPERTAHANKAN id non-blank itu
 * (`id.ifBlank { notificationId(...) }`) — hash `notificationId()` hanya
 * dipakai bila id kosong. Karena live `sso_push` append menerima toast yang
 * sama persis (id `title+'|'+body` ikut ter-decode dari JSON), dedup SW + live
 * memakai id yang SAMA → repeat-push saat app terbuka hanya satu entri di
 * riwayat (bukan ganda).
 */
class IdbNotificationHistoryStore : NotificationHistoryStore {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private val serializer = ListSerializer(StoredNotification.serializer())

    override suspend fun append(notification: StoredNotification) {
        val merged = mergeNotification(all(), notification)
        // Best-effort: gagal IndexedDB tidak dibawa ke UI (riwayat adalah bonus).
        runCatching { idbOp(MODE_PUT_LIST, json.encodeToString(serializer, merged)) }
    }

    override suspend fun all(): List<StoredNotification> {
        val raw = runCatching { idbOp(MODE_READ_LIST, null) }.getOrNull() ?: return emptyList()
        return runCatching { json.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
    }

    override suspend fun clear() {
        runCatching { idbOp(MODE_CLEAR_LIST, null) }
    }

    /** Baca DAN hapus sekali-pakai (semantik `sso_pending_nav` lama). */
    suspend fun consumePendingNav(): String? = runCatching { idbOp(MODE_CONSUME_PENDING, null) }.getOrNull()

    private suspend fun idbOp(mode: String, value: String?): String? =
        suspendCancellableCoroutine { cont ->
            jsIdbOp(
                mode,
                value,
                onOk = { v -> if (cont.isActive) cont.resume(v?.toString(), onCancellation = null) },
                onFail = { e ->
                    if (cont.isActive) cont.resumeWith(Result.failure(RuntimeException(errText(e))))
                },
            )
        }

    private fun errText(e: JsAny?): String = jsErrText(e)?.toString() ?: "IndexedDB error"

    private companion object {
        // Nama DB/store/key di @JsFun di bawah HARDCODED — harus sinkron dengan
        // generator SW (web/scripts/pwa-app-core.mjs) dan konstanta ini.
        const val DB_NAME = "sso_notif"
        const val STORE_NAME = "history"
        const val LIST_KEY = "list"
        const val PENDING_NAV_KEY = "pendingNav"

        const val MODE_READ_LIST = "readList"
        const val MODE_PUT_LIST = "putList"
        const val MODE_CLEAR_LIST = "clearList"
        const val MODE_CONSUME_PENDING = "consumePending"
    }
}

// ---------- interop primitives (implementasi JS) ----------

/**
 * Satu JsFun untuk semua operasi IDB (mode-driven, promise-di-chained manual):
 *  - readList         -> JSON string array items, atau null bila belum ada
 *  - putList          -> value = JSON string array items; put {id:'list', items}
 *  - clearList        -> delete record 'list'
 *  - consumePending   -> target 'pendingNav' LALU delete record tsb
 * Di luar 4 mode itu => onFail. Semua kegagalan IDB dilaporkan lewat onFail
 * (Kotlin mengubahnya jadi exception yang di-runCatching).
 */
@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(mode, value, onOk, onFail) => {" +
        "function errText(e) { return e && e.message ? e.message : String(e); }" +
        "function openDb() {" +
        "  return new Promise(function (resolve, reject) {" +
        "    var req = indexedDB.open('sso_notif', 1);" +
        "    req.onupgradeneeded = function () {" +
        "      var db = req.result;" +
        "      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });" +
        "    };" +
        "    req.onsuccess = function () { resolve(req.result); };" +
        "    req.onerror = function () { reject(req.error); };" +
        "  });" +
        "}" +
        "function readList(db) {" +
        "  return new Promise(function (resolve, reject) {" +
        "    var tx = db.transaction('history', 'readonly');" +
        "    var req = tx.objectStore('history').get('list');" +
        "    req.onsuccess = function () {" +
        "      var r = req.result;" +
        "      resolve(r && Array.isArray(r.items) ? r.items : []);" +
        "    };" +
        "    req.onerror = function () { reject(req.error); };" +
        "  });" +
        "}" +
        "function putRecord(db, rec) {" +
        "  return new Promise(function (resolve, reject) {" +
        "    var tx = db.transaction('history', 'readwrite');" +
        "    tx.objectStore('history').put(rec);" +
        "    tx.oncomplete = function () { resolve(); };" +
        "    tx.onerror = function () { reject(tx.error); };" +
        "  });" +
        "}" +
        "function delRecord(db, key) {" +
        "  return new Promise(function (resolve, reject) {" +
        "    var tx = db.transaction('history', 'readwrite');" +
        "    tx.objectStore('history').delete(key);" +
        "    tx.oncomplete = function () { resolve(); };" +
        "    tx.onerror = function () { reject(tx.error); };" +
        "  });" +
        "}" +
        "openDb().then(function (db) {" +
        "  var p;" +
        "  if (mode === 'readList') {" +
        "    p = readList(db).then(function (items) { return JSON.stringify(items); });" +
        "  } else if (mode === 'putList') {" +
        "    var arr;" +
        "    try { arr = JSON.parse(value || '[]'); } catch (e) { db.close(); onFail(errText(e)); return; }" +
        "    p = putRecord(db, { id: 'list', items: arr }).then(function () { return null; });" +
        "  } else if (mode === 'clearList') {" +
        "    p = delRecord(db, 'list').then(function () { return null; });" +
        "  } else if (mode === 'consumePending') {" +
        "    p = new Promise(function (resolve, reject) {" +
        "      var tx = db.transaction('history', 'readwrite');" +
        "      var store = tx.objectStore('history');" +
        "      var target = null;" +
        "      var req = store.get('pendingNav');" +
        "      req.onsuccess = function () {" +
        "        target = req.result && req.result.target ? String(req.result.target) : null;" +
        "        store.delete('pendingNav');" +
        "      };" +
        "      req.onerror = function () { reject(req.error); };" +
        "      tx.oncomplete = function () { resolve(target); };" +
        "      tx.onerror = function () { reject(tx.error); };" +
        "    });" +
        "  } else {" +
        "    db.close(); onFail('unknown idb mode: ' + mode); return;" +
        "  }" +
        "  p.then(function (result) { db.close(); onOk(result); })" +
        "   .catch(function (e) { db.close(); onFail(errText(e)); });" +
        "}).catch(function (e) { onFail(errText(e)); });" +
        "}",
)
private external fun jsIdbOp(
    mode: String,
    value: String?,
    onOk: (JsAny?) -> Unit,
    onFail: (JsAny?) -> Unit,
)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(e) => { if (!e) return 'unknown error'; if (e.message) return e.message; return String(e); }")
private external fun jsErrText(err: JsAny?): JsString?
