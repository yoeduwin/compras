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
 *   clave | fecha | resumen | json | actualizado | ambito
 * "json" guarda el registro completo (fuente de verdad); las demás columnas
 * son para que tú puedas leer/filtrar la hoja a simple vista. La columna
 * "ambito" (laboratorio / empresa) permite filtrar la hoja sin abrir el JSON;
 * si la hoja viene de una versión anterior, el encabezado se repara solo.
 *
 * SERIES DE FOLIO (por ámbito y por año, todas calculadas en la hoja):
 *   laboratorio → SC-AA-NNN (solicitud)  ·  OC-AA-NNN  (orden)
 *   empresa     → REQ-AA-NNN (solicitud) ·  OCB-AA-NNN (orden)
 */

// ── Configuración de pestañas de datos ─────────────────────────────────────
var TABS = {
  solicitud:  'Solicitudes',
  orden:      'Ordenes',
  evaluacion: 'Evaluaciones',
  proveedor:  'Proveedores'
};
var HEADERS = ['clave', 'fecha', 'resumen', 'json', 'actualizado', 'ambito'];

// ── Series por ámbito ──────────────────────────────────────────────────────
// Laboratorio y empresa llevan numeración independiente. El prefijo distingue
// la serie, así que los cuatro consecutivos conviven en las mismas pestañas.
var PREFIJOS = {
  solicitud: { laboratorio: 'SC', empresa: 'REQ' },
  orden:     { laboratorio: 'OC', empresa: 'OCB' }
};
var AMBITOS = ['laboratorio', 'empresa'];

function ambitoDe_(valor) {
  return String(valor || '').toLowerCase() === 'empresa' ? 'empresa' : 'laboratorio';
}
function prefijoDe_(collection, ambito) {
  var m = PREFIJOS[collection];
  return m ? m[ambitoDe_(ambito)] : '';
}
/** Registros anteriores al ámbito: se deduce del prefijo del folio (SC/OC = laboratorio). */
function inferirAmbito_(collection, r) {
  if (r.ambito) return ambitoDe_(r.ambito);
  var folio = String(r.folio || '');
  var m = PREFIJOS[collection];
  if (m) {
    for (var i = 0; i < AMBITOS.length; i++) {
      if (folio.indexOf(m[AMBITOS[i]] + '-') === 0) return AMBITOS[i];
    }
  }
  return 'laboratorio';
}

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
    if (action === 'nextFolio') return json(nextFolio(params.collection, params.year, params.ambito));
    if (action === 'enviarCorreo') return json(enviarCorreo(params, auth.email));
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

/**
 * Lista de proveedores confiables (EA-FCPS-05.04). Se usa para sembrar la hoja.
 * Los IDs son fijos para que sembrar sea idempotente (no duplica al re-ejecutar).
 */
var PROVEEDORES_CONFIABLES = [
  { id: 'prov-01', nombre: 'Ingeniería y Servicio EHS', servicio: 'Venta de equipos: Sonómetro, Calibrador acústico, Medidor de tierras, Luxómetro, Medidor de estrés térmico, Termómetro de líquido en vidrio', ingreso: '2024-02-01', direccion: 'Cedros 15, Salitrería, Texcoco, Estado de México, C.P. 56150', numero: '55 8290 0905', correo: 'daniel@isehs.com' },
  { id: 'prov-02', nombre: 'GIMIN (Grupo de Instrumentación y Medición Industrial de México)', servicio: 'Venta de equipos: Anemómetro', ingreso: '2024-03-01', direccion: 'Estudios Azteca Mz.B L23 No.14 Col. Jardines Tecma, Iztacalco, C.P. 08920, CDMX', numero: '5634-0402 / 5634-7274', correo: 'cmin@gimim.com' },
  { id: 'prov-03', nombre: 'Suministros en Metrología', servicio: 'Venta de equipos: Dosímetro', ingreso: '2024-03-01', direccion: 'Francisco I. Madero 200, Col. Domingo Arenas, San Martín Texmelucan, Puebla, C.P. 74000', numero: '246 148 8540', correo: 'ventas2@suministrosenmetrologia.com' },
  { id: 'prov-04', nombre: 'MICROIMPORT', servicio: 'Venta de equipos: Medidor de vibraciones, Calibrador de vibraciones, Acelerómetros triaxiales cuerpo entero y mano-brazo', ingreso: '2024-06-01', direccion: 'Viaducto Miguel Alemán No. 230 Col. Magdalena Mixhuca, Venustiano Carranza, CDMX, C.P. 15850', numero: '55 6185 8153', correo: 'm.camacho@microimport.mx' },
  { id: 'prov-05', nombre: 'PROCONSA (Proveedora Comercial del Norte)', servicio: 'Venta de equipos: Termohigrómetro', ingreso: '2024-07-01', direccion: '5a Avenida #924 local 1, Col. Cumbres 2do sector, C.P. 64610, Monterrey, Nuevo León', numero: '81 8110-9439', correo: 'proconsamexico@hotmail.com' },
  { id: 'prov-06', nombre: 'Ingeniería Acústica Spectrum', servicio: 'Ensayos de aptitud: NOM-011-STPS-2001, NOM-081-SEMARNAT-1994', ingreso: '2024-08-01', direccion: 'Apaseo el Alto No. 66 Col. San Bartolo Atepehuacan, Gustavo A. Madero, C.P. 07730, CDMX', numero: '55 5567-0878 / 55 5368-6180', correo: 'acusticaspectrum@prodigy.net.mx' },
  { id: 'prov-07', nombre: 'SIMH (Servicios Integrales en Medición e Higiene)', servicio: 'Calibración: Sonómetro, Calibrador Acústico, Dosímetro', ingreso: '2024-08-01', direccion: 'Adolfo G. García No. 4 Col. Constituyentes, C.P. 76147, Querétaro, Qro.', numero: '442 295 27 42', correo: 'imh@simh-mexico.com' },
  { id: 'prov-08', nombre: 'Amazon.com.mx', servicio: 'Venta de equipo en línea: Década de resistencia', ingreso: '2024-08-01', direccion: 'Dr. Ángel Leaño 401, Col. Parque Industrial San Ángel, CDMX', numero: 'Compra independiente', correo: 'https://www.amazon.com.mx/' },
  { id: 'prov-09', nombre: 'Metrología y Física Aplicada (MFA)', servicio: 'Calibración: Luxómetro', ingreso: '2024-08-01', direccion: 'Xel-Ha 22 Col. Vista Azul, Querétaro, Qro., México, C.P. 76087', numero: '442 254 3354', correo: 'metrologiafa@mfa.com' },
  { id: 'prov-10', nombre: 'Grupo de Metrología CLAM', servicio: 'Calibración: Medidor de resistencia de tierras, Década de resistencia, Multímetro digital', ingreso: '2024-09-01', direccion: 'Misión de Santiago No. 15, Las Misiones, Naucalpan de Juárez, México, C.P. 53140', numero: '53438344 / 53439739', correo: 'ventas@grupoclam.com.mx' },
  { id: 'prov-11', nombre: 'EVAMSA (Evaluaciones Ambientales del Centro)', servicio: 'Calibración: Medidor de estrés térmico', ingreso: '2024-09-01', direccion: 'Av. Hidalgo 29 San Juan Ixtacala, C.P. 54160, Tlalnepantla, Estado de México', numero: '55 7090 9624', correo: 'cotiza.evamsa@outlook.com' },
  { id: 'prov-12', nombre: 'ICEMA (Ingeniería y Calibraciones de Equipos para Monitoreo Ambiental)', servicio: 'Calibración: Anemómetro, Higrómetro, Termómetro digital', ingreso: '2024-10-01', direccion: 'Aretillo 144 Patrimonio Familiar, 02980 Azcapotzalco, CDMX', numero: '55 7155 7731', correo: 'contacto@icema.com.mx' },
  { id: 'prov-13', nombre: 'Metas (Metrólogos Asociados)', servicio: 'Calibración: Medidor de vibraciones, Calibrador de vibraciones, Acelerómetros triaxiales, Termómetros de líquido en vidrio', ingreso: '2024-12-01', direccion: 'Antonio Caso 246 Col. Ciudad Guzmán Centro, Zapotlán el Grande, Jalisco', numero: '341 413 6123', correo: 'metas@metas.com.mx' },
  { id: 'prov-14', nombre: 'TWILIGHT', servicio: 'Venta de equipos: Dosímetro', ingreso: '2024-12-01', direccion: 'Del Paseo Residencial, Monterrey, Nuevo León, C.P. 64920', numero: '81 8115-1400 / 81 8173-4300', correo: 'ventas@twilight.mx' },
  { id: 'prov-15', nombre: 'Servicio de Medición + Control', servicio: 'Venta de equipo: Medidor de resistencia a tierra física', ingreso: '2025-08-01', direccion: 'Luis Moya 76-A, Col. Centro, Cuauhtémoc, 06070, CDMX', numero: '55 5518 2260', correo: 'https://www.smedicion.com/' }
];

/**
 * Siembra los 15 proveedores confiables en la pestaña "Proveedores".
 * Ejecuta esta función UNA vez desde el editor de Apps Script.
 * Es idempotente: si ya existen (por id), los actualiza en lugar de duplicar.
 */
function sembrarProveedores() {
  var n = 0;
  PROVEEDORES_CONFIABLES.forEach(function (p) {
    upsertRecord('proveedor', { id: p.id, nombre: p.nombre, servicio: p.servicio, ingreso: p.ingreso,
      direccion: p.direccion, numero: p.numero, correo: p.correo, ultimaCalif: null, ultimaEval: null });
    n++;
  });
  return 'Listo: ' + n + ' proveedores sembrados/actualizados en la pestaña "' + TABS.proveedor + '".';
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
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); return sh; }
  // Repara el encabezado si la hoja viene de una versión anterior (p. ej. sin
  // la columna 'ambito'). Idempotente: sólo escribe cuando algo no coincide.
  if (sh.getMaxColumns() < HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  }
  var head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var reparar = false;
  for (var i = 0; i < HEADERS.length; i++) { if (String(head[i]) !== HEADERS[i]) reparar = true; }
  if (reparar) sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
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
    try {
      var r = JSON.parse(jsonCell);
      r.ambito = inferirAmbito_(collection, r);
      out.push(r);
    } catch (err) {}
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
           JSON.stringify(record), new Date().toISOString(), inferirAmbito_(collection, record) ];
}

/**
 * Siguiente folio consecutivo del año, calculado SIEMPRE leyendo la hoja.
 * Es la única fuente de verdad de la numeración (el navegador no la inventa).
 */
function nextFolio_(collection, year, ambito) {
  var prefix = prefijoDe_(collection, ambito);
  var yy = String(year).slice(-2);
  var re = new RegExp('^' + prefix + '-' + yy + '-(\\d+)$');
  var max = 0;
  readCollection(collection).forEach(function (r) {
    var m = re.exec(r.folio || '');
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  return prefix + '-' + yy + '-' + ('00' + (max + 1)).slice(-3);
}

/** Acción 'nextFolio': vista previa del consecutivo. Sólo lee, no escribe. */
function nextFolio(collection, year, ambito) {
  if (!PREFIJOS[collection]) {
    return { ok: false, error: 'Colección sin folio: ' + collection };
  }
  var y = parseInt(year, 10) || new Date().getFullYear();
  var amb = ambitoDe_(ambito);
  return { ok: true, collection: collection, year: y, ambito: amb, folio: nextFolio_(collection, y, amb) };
}

/** Inserta asignando folio consecutivo por año (SC/OC). Usa Lock para evitar choques. */
function addRecord(collection, record) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    record.ambito = ambitoDe_(record.ambito);
    if (PREFIJOS[collection]) {
      var year = (record.fecha ? new Date(record.fecha + 'T00:00:00').getFullYear() : new Date().getFullYear());
      record.folio = nextFolio_(collection, year, record.ambito);
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

// ═══════════════════════════════════════════════════════════════════════════
//  ENVÍO DE DOCUMENTOS POR CORREO
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Envía un documento (PDF en base64) por correo desde la cuenta dueña del
 * script. Responder al correo llega a quien lo envió desde el sistema.
 * params: { para, cc, asunto, cuerpo, adjunto: { nombre, base64 } }
 */
function enviarCorreo(params, remitente) {
  var para = String(params.para || '').trim();
  if (!para) return { ok: false, error: 'Falta el destinatario' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return { ok: false, error: 'Correo inválido: ' + para };

  var opciones = { name: 'Ejecutiva Ambiental' };
  if (remitente) opciones.replyTo = remitente;
  if (params.cc) opciones.cc = String(params.cc).trim();

  var adj = params.adjunto;
  if (adj && adj.base64) {
    var bytes = Utilities.base64Decode(adj.base64);
    opciones.attachments = [
      Utilities.newBlob(bytes, 'application/pdf', adj.nombre || 'documento.pdf')
    ];
  }

  GmailApp.sendEmail(para, String(params.asunto || 'Documento — Ejecutiva Ambiental'),
                     String(params.cuerpo || ''), opciones);
  return { ok: true, para: para, cc: opciones.cc || '', adjunto: adj ? (adj.nombre || '') : '' };
}
