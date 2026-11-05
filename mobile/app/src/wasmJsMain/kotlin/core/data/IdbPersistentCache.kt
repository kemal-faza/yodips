package ac.undip.sso.core.data

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.coroutines.resume

/**
 * IndexedDB-backed [PersistentCache] for the PWA. Values are AES-GCM encrypted
 * with a non-extractable CryptoKey stored in the same database; any IDB or
 * WebCrypto failure is a cache miss, never a user-facing error.
 */
class IdbPersistentCache : PersistentCache {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun load(key: String): PersistentCache.Entry? {
        val raw = runCatching { op(MODE_LOAD, key = key) }.getOrNull() ?: return null
        val parsed = runCatching {
            val obj = json.parseToJsonElement(raw).jsonObject
            PersistentCache.Entry(
                json = obj.getValue("json").jsonPrimitive.content,
                fetchedAt = obj.getValue("fetchedAt").jsonPrimitive.long,
            )
        }.getOrNull()
        if (parsed == null) {
            // Corrupt/legacy record: drop it so it is not retried forever.
            runCatching { op(MODE_DELETE, value = json.encodeToString(listOf(key))) }
        }
        return parsed
    }

    override suspend fun save(key: String, json: String, fetchedAt: Long) {
        val size = json.encodeToByteArray().size
        if (!CacheCapacityPolicy.shouldStore(size)) return
        val existing = runCatching { parseMeta(op(MODE_LIST) ?: "[]") }
            .getOrDefault(emptyList())
        val delete = CacheCapacityPolicy.trim(
            existing.filterNot { it.key == key } + CacheEntryMeta(key, fetchedAt, size),
        )
        if (delete.isNotEmpty()) {
            runCatching { op(MODE_DELETE, value = this.json.encodeToString(delete.toList())) }
        }
        val first = runCatching {
            op(MODE_SAVE, key = key, value = json, fetchedAt = fetchedAt, size = size)
        }
        if (first.isFailure) {
            // Quota can appear after the metadata read; evict the oldest and retry once.
            val oldest = existing.sortedBy { it.fetchedAt }.take(1).map { it.key }
            if (oldest.isNotEmpty()) {
                runCatching { op(MODE_DELETE, value = this.json.encodeToString(oldest)) }
                runCatching {
                    op(MODE_SAVE, key = key, value = json, fetchedAt = fetchedAt, size = size)
                }
            }
        }
    }

    override suspend fun clear() {
        runCatching { op(MODE_CLEAR) }
    }

    private fun parseMeta(raw: String): List<CacheEntryMeta> =
        runCatching {
            json.parseToJsonElement(raw).jsonArray.map { element ->
                val obj = element.jsonObject
                CacheEntryMeta(
                    key = obj.getValue("key").jsonPrimitive.content,
                    fetchedAt = obj.getValue("fetchedAt").jsonPrimitive.long,
                    sizeBytes = obj.getValue("size").jsonPrimitive.int,
                )
            }
        }.getOrDefault(emptyList())

    private suspend fun op(
        mode: String,
        key: String? = null,
        value: String? = null,
        fetchedAt: Long = 0L,
        size: Int = 0,
    ): String? = suspendCancellableCoroutine { cont ->
        jsIdbCache(
            mode,
            key,
            value,
            fetchedAt.toDouble(),
            size,
            onOk = { result -> if (cont.isActive) cont.resume(result?.toString(), onCancellation = null) },
            onFail = { error ->
                if (cont.isActive) {
                    cont.resumeWith(Result.failure(RuntimeException(error?.toString() ?: "IndexedDB error")))
                }
            },
        )
    }

    private companion object {
        const val MODE_LOAD = "load"
        const val MODE_SAVE = "save"
        const val MODE_LIST = "list"
        const val MODE_DELETE = "delete"
        const val MODE_CLEAR = "clear"
    }
}

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(mode, key, value, fetchedAt, size, onOk, onFail) => {" +
        "function fail(e){ onFail(e && e.message ? e.message : String(e)); }" +
        "function openDb(){ return new Promise(function(resolve,reject){" +
        "  var req=indexedDB.open('sso_cache',1);" +
        "  req.onupgradeneeded=function(){ var db=req.result;" +
        "    if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries',{keyPath:'key'});" +
        "    if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'id'}); };" +
        "  req.onsuccess=function(){ var db=req.result; db.onversionchange=function(){ db.close(); }; resolve(db); };" +
        "  req.onerror=function(){ reject(req.error); }; }); }" +
        "function get(db,store,key){ return new Promise(function(resolve,reject){" +
        "  var tx=db.transaction(store,'readonly'); var r=tx.objectStore(store).get(key);" +
        "  r.onsuccess=function(){ resolve(r.result || null); }; r.onerror=function(){ reject(r.error); }; }); }" +
        "function put(db,store,record){ return new Promise(function(resolve,reject){" +
        "  var tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(record);" +
        "  tx.oncomplete=function(){ resolve(); }; tx.onerror=function(){ reject(tx.error); }; }); }" +
        "function del(db,store,key){ return new Promise(function(resolve,reject){" +
        "  var tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key);" +
        "  tx.oncomplete=function(){ resolve(); }; tx.onerror=function(){ reject(tx.error); }; }); }" +
        "function b64(bytes){ var s=''; for(var i=0;i<bytes.length;i+=0x8000){" +
        "  s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); } return btoa(s); }" +
        "function unb64(text){ var bin=atob(text); var out=new Uint8Array(bin.length);" +
        "  for(var i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }" +
        "function generate(){ return crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']); }" +
        "function ensureKey(db){ return get(db,'meta','cryptoKey').then(function(existing){" +
        "  if(existing && existing.key) return existing.key;" +
        "  if(navigator.locks && navigator.locks.request){" +
        "    return navigator.locks.request('sso_cache_init',function(){ return get(db,'meta','cryptoKey').then(function(again){" +
        "      if(again && again.key) return again.key;" +
        "      return generate().then(function(k){ return put(db,'meta',{id:'cryptoKey',key:k}).then(function(){ return k; }); }); }); }); }" +
        "  return generate().then(function(candidate){ return new Promise(function(resolve,reject){" +
        "    var tx=db.transaction('meta','readwrite'); var store=tx.objectStore('meta'); var req=store.get('cryptoKey');" +
        "    req.onsuccess=function(){ if(req.result && req.result.key){ resolve(req.result.key); return; } store.put({id:'cryptoKey',key:candidate}); resolve(candidate); };" +
        "    req.onerror=function(){ reject(req.error); }; }); }); }); }" +
        "openDb().then(function(db){" +
        "  var p;" +
        "  if(mode==='load'){" +
        "    p=get(db,'entries',key).then(function(rec){ if(!rec) return null;" +
        "      if(rec.v!==1) return del(db,'entries',key).then(function(){return null;});" +
        "      return get(db,'meta','cryptoKey').then(function(k){ if(!k || !k.key) return null;" +
        "        return crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(rec.iv)},k.key,unb64(rec.ct)).then(function(buf){" +
        "          return JSON.stringify({json:new TextDecoder().decode(buf),fetchedAt:rec.fetchedAt});" +
        "        }).catch(function(){ return del(db,'entries',key).then(function(){return null;}); }); }); }); }" +
        "  else if(mode==='save'){ p=ensureKey(db).then(function(k){" +
        "    var iv=crypto.getRandomValues(new Uint8Array(12));" +
        "    return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},k.key,new TextEncoder().encode(value)).then(function(buf){" +
        "      return put(db,'entries',{key:key,iv:b64(iv),ct:b64(new Uint8Array(buf)),fetchedAt:fetchedAt,size:size,v:1}); }); }); }" +
        "  else if(mode==='list'){ p=new Promise(function(resolve,reject){" +
        "    var tx=db.transaction('entries','readonly'); var req=tx.objectStore('entries').getAll();" +
        "    req.onsuccess=function(){ resolve(JSON.stringify((req.result||[]).map(function(e){ return {key:e.key,fetchedAt:e.fetchedAt,size:e.size||0}; }))); };" +
        "    req.onerror=function(){ reject(req.error); }; }); }" +
        "  else if(mode==='delete'){ var keys=JSON.parse(value||'[]'); p=Promise.all(keys.map(function(k){ return del(db,'entries',k); })).then(function(){ return null; }); }" +
        "  else if(mode==='clear'){ p=new Promise(function(resolve,reject){" +
        "    var tx=db.transaction(['entries','meta'],'readwrite'); tx.objectStore('entries').clear(); tx.objectStore('meta').clear();" +
        "    tx.oncomplete=function(){ resolve(null); }; tx.onerror=function(){ reject(tx.error); }; }); }" +
        "  else { db.close(); onFail('unknown cache mode: '+mode); return; }" +
        "  p.then(function(result){ db.close(); onOk(result); }).catch(function(e){ db.close(); fail(e); });" +
        "}).catch(fail); }",
)
private external fun jsIdbCache(
    mode: String,
    key: String?,
    value: String?,
    fetchedAt: Double,
    size: Int,
    onOk: (JsAny?) -> Unit,
    onFail: (JsAny?) -> Unit,
)
