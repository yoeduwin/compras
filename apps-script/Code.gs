/**
 * Ejecutiva Ambiental — Backend del Sistema de Compras sobre Google Sheets
 * ------------------------------------------------------------------------
 * Publica esta hoja como "Aplicación web" (Implementar → Nueva implementación
 * → Aplicación web → Ejecutar como: Yo → Con acceso: Cualquier usuario).
 * Copia la URL /exec y pégala en el sistema de compras (CONFIG.SHEETS_URL).
 *
 * SEGURIDAD (mismo patrón que SEADB):
 *   • YA NO existe un token secreto en el HTML. El acceso se controla al 100%
 *     por cuenta de Google (OAuth): el frontend manda el id_token de Google y
 *     el backend lo valida contra Google y contra la lista blanca de correos.
 *   • El Client ID vive en Propiedades del Script (no se codifica aquí).
 *   • Los correos autorizados viven en la pestaña "Usuarios" de esta misma
 *     hoja — se editan sin tocar código.
 *
 * CONFIGURACIÓN (una sola vez, ver apps-script/INSTRUCCIONES.md):
 *   1. Editor de Apps Script → ⚙ Configuración del proyecto → Propiedades del
 *      script → añade la propiedad GOOGLE_CLIENT_ID con tu Client ID de OAuth
 *      (el mismo de auth.js: ...apps.googleusercontent.com).
 *   2. Ejecuta una vez la función crearHojaUsuarios() para crear la pestaña
 *      "Usuarios" y sembrar tu correo. Luego agrega/quita correos ahí.
 *
 * Cada tipo de registro vive en su propia pestaña (Solicitudes, Ordenes,
 * Evaluaciones, Proveedores) con columnas:
 *   clave | fecha | resumen | json | actualizado
 * "json" guarda el registro completo (fuente de verdad); las demás columnas
 * son para que tú puedas leer/filtrar la hoja a simple vista.
 */

// ── Configuración de pestañas de datos ─────────────────────────────────────
var TABS = {
  solicitud:  'Solicitudes',
  orden:      'Ordenes',
  evaluacion: 'Evaluaciones',
  proveedor:  'Proveedores'
};
var HEADERS = ['clave', 'fecha', 'resumen', 'json', 'actualizado'];

// ── Configuración de seguridad ─────────────────────────────────────────────
var SHEET_USUARIOS = 'Usuarios';                 // pestaña con la lista blanca
var USUARIOS_HEADERS = ['correo', 'nombre', 'activo', 'alta'];
// Correo(s) que se siembran al crear la pestaña Usuarios por primera vez.
var USUARIOS_INICIALES = ['eduwin.ejecutiva@gmail.com'];

function doGet(e)  { return handle(e, (e.parameter || {})); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(e, body);
}

function handle(e, params) {
  try {
    var action = params.action;

    // ── Ping público: no expone datos, sólo confirma que el backend vive ──
    if (action === 'ping') {
      return json({ ok: true, service: 'EA Compras', time: new Date().toISOString(), authRequired: true });
    }

    // ── Verificar id_token de Google + lista blanca (obligatorio) ──
    var auth = verificarAcceso(params.id_token);

    // Contrato que espera auth.js (SEAAuth) para bloquear la app antes de cargar.
    if (action === 'verificarAcceso') {
      if (auth.ok) return json({ success: true, email: auth.email });
      return json({ success: false, error: 'AUTH_REQUIRED', message: auth.error });
    }

    // Para el resto de acciones: si no está autorizado, cortar aquí.
    if (!auth.ok) return json({ ok: false, authRequired: true, error: auth.error });

    if (action === 'pull')   return json({ ok: true, data: pullAll() });
    if (action === 'add')    return json(addRecord(params.collection, params.record || {}));
    if (action === 'upsert') return json(upsertRecord(params.collection, params.record || {}));
    if (action === 'delete') return json(deleteRecord(params.collection, params.key));
    return json({ ok: false, error: 'Acción no reconocida: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEGURIDAD — OAuth Google + lista blanca
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica que el id_token sea válido (emitido por Google, para NUESTRO
 * Client ID, no expirado, correo verificado) y que el correo esté en la lista
 * blanca de la pestaña "Usuarios". Devuelve { ok, email } o { ok:false, error }.
 */
function verificarAcceso(idToken) {
  var info = verificarIdToken_(idToken);
  if (!info) return { ok: false, error: 'Debes iniciar sesión con Google.' };
  if (!usuarioAutorizado_(info.email)) {
    return { ok: false, error: 'Acceso no autorizado para ' + info.email };
  }
  return { ok: true, email: info.email };
}

/**
 * Valida el id_token contra Google (tokeninfo). Usa CacheService 10 min para no
 * llamar a Google en cada request. Devuelve { email, name, sub } o null.
 */
function verificarIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 100) return null;

  var cacheKey = 'idtok_' + idToken.slice(-32);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (_) {} }

  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;

    var data = JSON.parse(resp.getContentText());
    if (data.error || data.error_description) return null;

    // La audiencia debe ser NUESTRO Client ID (bloquea tokens de otras apps).
    var CLIENT_ID = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
    if (!CLIENT_ID) { Logger.log('Falta la propiedad GOOGLE_CLIENT_ID'); return null; }
    if (String(data.aud) !== String(CLIENT_ID)) {
      Logger.log('Token rechazado: aud=' + data.aud + ' esperado=' + CLIENT_ID);
      return null;
    }
    if (Number(data.exp) * 1000 < Date.now()) return null;
    if (!(data.email_verified === 'true' || data.email_verified === true)) return null;

    var userInfo = { email: String(data.email || '').toLowerCase(), name: data.name || '', sub: data.sub || '' };
    var ttl = Math.min(600, Math.max(5, Number(data.exp) - Math.floor(Date.now() / 1000) - 60));
    cache.put(cacheKey, JSON.stringify(userInfo), ttl);
    return userInfo;
  } catch (e) {
    Logger.log('verificarIdToken_ error: ' + e.message);
    return null;
  }
}

/**
 * ¿El correo está activo en la pestaña "Usuarios"?
 * Columnas: correo | nombre | activo | alta. "activo" acepta vacío/sí/true/1.
 */
function usuarioAutorizado_(email) {
  if (!email) return false;
  var emailLower = String(email).toLowerCase().trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_USUARIOS);
  if (!sh) return false;                       // sin lista → nadie autorizado (falla cerrado)
  var last = sh.getLastRow();
  if (last < 2) return false;
  var values = sh.getRange(2, 1, last - 1, 3).getValues(); // correo | nombre | activo
  for (var i = 0; i < values.length; i++) {
    var correo = String(values[i][0] || '').toLowerCase().trim();
    if (correo !== emailLower) continue;
    var activo = String(values[i][2] == null ? '' : values[i][2]).toLowerCase().trim();
    var inactivo = (activo === 'no' || activo === 'false' || activo === '0' || activo === 'inactivo');
    return !inactivo;                          // vacío / sí / true / 1 → autorizado
  }
  return false;
}

/**
 * Crea (o repara) la pestaña "Usuarios" con encabezados y siembra el/los
 * correo(s) inicial(es). Ejecuta esta función UNA vez desde el editor de GAS.
 */
function crearHojaUsuarios() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_USUARIOS);
  if (!sh) sh = ss.insertSheet(SHEET_USUARIOS);
  if (sh.getLastRow() === 0) sh.appendRow(USUARIOS_HEADERS);
  var existentes = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      existentes[String(r[0] || '').toLowerCase().trim()] = true;
    });
  }
  USUARIOS_INICIALES.forEach(function (correo) {
    var c = String(correo).toLowerCase().trim();
    if (c && !existentes[c]) sh.appendRow([c, '', 'sí', new Date().toISOString()]);
  });
  return 'Pestaña "' + SHEET_USUARIOS + '" lista. Agrega o quita correos ahí.';
}

// ═══════════════════════════════════════════════════════════════════════════
//  DATOS
// ═══════════════════════════════════════════════════════════════════════════

function getSheet(collection) {
  var name = TABS[collection];
  if (!name) throw 'Colección desconocida: ' + collection;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); }
  return sh;
}

function readCollection(collection) {
  var sh = getSheet(collection);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var jsonCell = values[i][3];
    if (!jsonCell) continue;
    try { out.push(JSON.parse(jsonCell)); } catch (err) {}
  }
  return out;
}

function pullAll() {
  return {
    solicitudes:  readCollection('solicitud'),
    ordenes:      readCollection('orden'),
    evaluaciones: readCollection('evaluacion'),
    proveedores:  readCollection('proveedor')
  };
}

function keyOf(collection, record) {
  return (collection === 'solicitud' || collection === 'orden') ? record.folio : record.id;
}
function resumenOf(collection, r) {
  if (collection === 'solicitud')  return (r.area || '') + ' — ' + (r.descripcion || '').slice(0, 60);
  if (collection === 'orden')      return (r.proveedor || '') + ' — $' + (r.total || 0);
  if (collection === 'evaluacion') return (r.proveedor || '') + ' — ' + (r.calificacion || '') + ' ' + (r.conclusion || '');
  if (collection === 'proveedor')  return (r.nombre || '');
  return '';
}

function findRow(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var keys = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(key)) return i + 2; // fila real (1-based, +header)
  }
  return -1;
}

function rowFor(collection, record) {
  return [ keyOf(collection, record), record.fecha || '', resumenOf(collection, record),
           JSON.stringify(record), new Date().toISOString() ];
}

/** Inserta asignando folio consecutivo por año (SC/OC). Usa Lock para evitar choques. */
function addRecord(collection, record) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (collection === 'solicitud' || collection === 'orden') {
      var prefix = collection === 'solicitud' ? 'SC' : 'OC';
      var year = (record.fecha ? new Date(record.fecha + 'T00:00:00').getFullYear() : new Date().getFullYear());
      var yy = String(year).slice(-2);
      var existentes = readCollection(collection);
      var max = 0;
      var re = new RegExp('^' + prefix + '-' + yy + '-(\\d+)$');
      existentes.forEach(function (r) {
        var m = re.exec(r.folio || '');
        if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
      });
      record.folio = prefix + '-' + yy + '-' + ('00' + (max + 1)).slice(-3);
    }
    var sh = getSheet(collection);
    var existingRow = findRow(sh, keyOf(collection, record));
    if (existingRow > 0) sh.getRange(existingRow, 1, 1, HEADERS.length).setValues([rowFor(collection, record)]);
    else sh.appendRow(rowFor(collection, record));
    return { ok: true, record: record };
  } finally {
    lock.releaseLock();
  }
}

/** Inserta o actualiza por clave existente (no reasigna folio). */
function upsertRecord(collection, record) {
  var sh = getSheet(collection);
  var key = keyOf(collection, record);
  if (!key) return { ok: false, error: 'Registro sin clave' };
  var row = findRow(sh, key);
  if (row > 0) sh.getRange(row, 1, 1, HEADERS.length).setValues([rowFor(collection, record)]);
  else sh.appendRow(rowFor(collection, record));
  return { ok: true, record: record };
}

function deleteRecord(collection, key) {
  var sh = getSheet(collection);
  var row = findRow(sh, key);
  if (row > 0) sh.deleteRow(row);
  return { ok: true, key: key };
}
