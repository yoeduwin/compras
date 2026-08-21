/**
 * Ejecutiva Ambiental — Backend del Sistema de Compras sobre Google Sheets
 * ------------------------------------------------------------------------
 * Publica esta hoja como "Aplicación web" (Implementar → Nueva implementación
 * → Aplicación web → Ejecutar como: Yo → Con acceso: Cualquier usuario).
 * Copia la URL /exec y pégala en el sistema de compras (pestaña Historial →
 * "Conexión con Google Sheets"), junto con el TOKEN de abajo.
 *
 * La app manda/pide datos aquí. Cada tipo de registro vive en su propia
 * pestaña (Solicitudes, Ordenes, Evaluaciones, Proveedores) con columnas:
 *   clave | fecha | resumen | json | actualizado
 * "json" guarda el registro completo (fuente de verdad); las demás columnas
 * son para que tú puedas leer/filtrar la hoja a simple vista.
 */

// ⚠️ CAMBIA ESTE TOKEN por una palabra secreta tuya y ponla igual en la app.
var TOKEN = 'CAMBIA-ESTE-TOKEN';

// ── (OPCIONAL) Restringir acceso por correo de Google (OAuth) ──────────────
// Si dejas ALLOWED_EMAILS vacío [], solo se pide el token de arriba.
// Si pones correos, ADEMÁS del token se exige iniciar sesión con Google y que
// el correo esté en esta lista. Pega el mismo Client ID que configures en la app.
var CLIENT_ID = '';              // ej. '1234-abc.apps.googleusercontent.com'
var ALLOWED_EMAILS = [           // correos de Gmail/Workspace autorizados
  // 'eduwin.ejecutiva@gmail.com',
  // 'eduardo.campos@ejecutivaambiental.com',
];

var TABS = {
  solicitud:  'Solicitudes',
  orden:      'Ordenes',
  evaluacion: 'Evaluaciones',
  proveedor:  'Proveedores'
};
var HEADERS = ['clave', 'fecha', 'resumen', 'json', 'actualizado'];

function doGet(e)  { return handle(e, (e.parameter || {})); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(e, body);
}

function handle(e, params) {
  try {
    if (String(params.token) !== String(TOKEN)) return json({ ok: false, error: 'Token inválido' });
    var action = params.action;
    if (action === 'ping')   return json({ ok: true, service: 'EA Compras', time: new Date().toISOString(), authRequired: ALLOWED_EMAILS.length > 0 });
    // Segunda capa (opcional): correo de Google autorizado
    var auth = verifyAuth(params);
    if (!auth.ok) return json(auth);
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

/**
 * Verifica el inicio de sesión con Google (OAuth) contra la lista blanca.
 * Si ALLOWED_EMAILS está vacío, no restringe (solo aplica el token).
 * Valida el idToken con Google (tokeninfo): audiencia, expiración, correo
 * verificado y que el correo esté autorizado.
 */
function verifyAuth(params) {
  if (!ALLOWED_EMAILS || ALLOWED_EMAILS.length === 0) return { ok: true };
  var idToken = params.idToken;
  if (!idToken) return { ok: false, error: 'Debes iniciar sesión con Google.', authRequired: true };
  try {
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    var info = JSON.parse(resp.getContentText());
    if (info.error || info.error_description) return { ok: false, error: 'Sesión de Google inválida.', authRequired: true };
    if (CLIENT_ID && String(info.aud) !== String(CLIENT_ID)) return { ok: false, error: 'El Client ID no coincide.', authRequired: true };
    if (Number(info.exp) * 1000 < Date.now()) return { ok: false, error: 'Tu sesión de Google expiró, inicia sesión de nuevo.', authRequired: true };
    if (!(info.email_verified === 'true' || info.email_verified === true)) return { ok: false, error: 'El correo de Google no está verificado.', authRequired: true };
    var email = String(info.email || '').toLowerCase();
    var allowed = ALLOWED_EMAILS.map(function (e) { return String(e).toLowerCase().trim(); });
    if (allowed.indexOf(email) < 0) return { ok: false, error: 'Acceso no autorizado para ' + email, authRequired: true };
    return { ok: true, email: email };
  } catch (e) {
    return { ok: false, error: 'No se pudo validar el inicio de sesión de Google.', authRequired: true };
  }
}

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
