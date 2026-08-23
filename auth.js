/**
 * auth.js — Módulo de autenticación Google OAuth para SEA
 *
 * USO: Páginas internas (SEAPD, SEAOT, SEAINF) y Sistema de Compras (compras).
 *      Es el MISMO módulo y el MISMO Client ID en todos los sistemas de EA.
 *
 * CONFIGURACIÓN:
 *   1. Reemplaza CLIENT_ID con el OAuth 2.0 Client ID de Google Cloud Console.
 *      El Client ID NO es secreto — es público por diseño de Google.
 *   2. En cada HTML: <script src="auth.js"></script>
 *      Llama a SEAAuth.init(callback) en lugar de inicializar la app directamente.
 *
 * REUTILIZABLE: Copiar este archivo a cualquier repo del proyecto.
 * Solo cambiar CLIENT_ID si usas un proyecto Google Cloud diferente.
 */

const SEAAuth = (() => {
  // ─── CONFIGURACIÓN ─────────────────────────────────────────────────────────
  // Reemplazar con tu OAuth 2.0 Client ID de Google Cloud Console
  const CLIENT_ID = '407541868250-5pbtl3me85quu1nl38b1c57ebi3nn9a6.apps.googleusercontent.com';
  const TOKEN_KEY = 'sea_google_id_token';

  // ─── Helpers de token ──────────────────────────────────────────────────────
  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function saveToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  /**
   * Retorna true si el token está expirado o vence en menos de 60 segundos.
   */
  function isExpired(token) {
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp < Math.floor(Date.now() / 1000) + 60;
    } catch (_) {
      return true;
    }
  }

  /**
   * Parsea el payload del JWT (sin verificar firma — solo uso en frontend).
   */
  function getPayload(token) {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch (_) {
      return null;
    }
  }

  // ─── UI: Overlay de login ─────────────────────────────────────────────────
  function createOverlay() {
    if (document.getElementById('sea-auth-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sea-auth-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:#003810',
      'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');

    overlay.innerHTML = `
      <div style="
        background:#fff; border-radius:16px; padding:56px 64px;
        text-align:center; max-width:520px; width:92%;
        box-shadow:0 24px 80px rgba(0,0,0,0.6);
        font-family:'Google Sans',Roboto,Arial,sans-serif;
      ">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" style="margin-bottom:16px">
          <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
          <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.32-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
          <path fill="#FBBC05" d="M11.68 28.18A13.9 13.9 0 0 1 10.9 24c0-1.45.25-2.86.78-4.18v-5.7H4.34A23.93 23.93 0 0 0 0 24c0 3.86.92 7.51 2.55 10.73l7.13-5.52-.0-.03z"/>
          <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.34 5.7c1.74-5.2 6.59-9.07 12.32-9.07z"/>
        </svg>
        <h2 style="margin:0 0 8px;font-size:22px;color:#202124;font-weight:500;">
          Ejecutiva Ambiental
        </h2>
        <p style="margin:0 0 4px;color:#5f6368;font-size:13px;">SISTEMA DE GESTIÓN EJECUTIVA</p>
        <p style="margin:0 0 28px;color:#5f6368;font-size:13px;">
          Inicia sesión con tu cuenta Google autorizada.
        </p>
        <div id="sea-signin-btn" style="display:flex;justify-content:center;"></div>
        <p id="sea-auth-error" style="
          display:none; margin-top:16px; color:#d93025;
          font-size:13px; line-height:1.4;
        "></p>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    const overlay = document.getElementById('sea-auth-overlay');
    if (overlay) overlay.remove();
  }

  function showAuthError(msg) {
    const el = document.getElementById('sea-auth-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  // ─── UI: Barra de usuario ─────────────────────────────────────────────────
  function showUserBar(payload) {
    if (!payload) return;
    const container = document.getElementById('sea-user-info');
    if (!container) return;
    container.innerHTML = `
      <img src="${payload.picture || ''}"
           style="width:28px;height:28px;border-radius:50%;vertical-align:middle;"
           onerror="this.style.display='none'" alt="">
      <span style="font-size:13px;color:#5f6368;vertical-align:middle;margin:0 6px;">
        ${payload.name || payload.email}
      </span>
      <button onclick="SEAAuth.logout()" style="
        padding:3px 10px;font-size:12px;cursor:pointer;
        border:1px solid #dadce0;border-radius:4px;
        background:#fff;color:#3c4043;vertical-align:middle;
      ">Salir</button>
    `;
  }

  // ─── Inicialización ───────────────────────────────────────────────────────
  let _onAuthSuccess = null;
  let _gasUrl = null; // URL del GAS para verificación pre-carga

  /**
   * Punto de entrada principal.
   * @param {function(token:string, payload:object):void} onAuthSuccess
   *   Callback invocado cuando hay sesión válida y el usuario está autorizado.
   * @param {{gasUrl:string}} [options]
   *   gasUrl: URL del GAS. Si se proporciona, verifica la whitelist ANTES de
   *   mostrar la app. Sin esta opción, la UI se carga antes de la verificación.
   */
  function init(onAuthSuccess, options) {
    _onAuthSuccess = onAuthSuccess;
    _gasUrl = (options && options.gasUrl) || null;
    const existing = getToken();

    if (existing && !isExpired(existing)) {
      const payload = getPayload(existing);
      showUserBar(payload);
      onAuthSuccess(existing, payload);
      return;
    }

    clearToken();
    createOverlay();

    // Exponer _initGIS para que onGISLoaded() pueda llamarlo
    window._seaAuthInitGIS = _initGIS;

    // Si el script de GIS ya cargó, inicializar directamente
    if (window.google && window.google.accounts) {
      _initGIS();
    }
    // Si no cargó aún, onGISLoaded() llamará a window._seaAuthInitGIS
  }

  function _initGIS() {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: _handleCredential,
      auto_select: true,          // Intento silencioso si hay sesión activa
      cancel_on_tap_outside: false,
    });

    google.accounts.id.renderButton(
      document.getElementById('sea-signin-btn'),
      { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
    );

    // Prompt de una-sola-presión (puede resolver silenciosamente)
    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // El prompt no se mostró; el botón ya está visible en el overlay
      }
    });
  }

  /**
   * Llama a GAS para verificar que el usuario está en la whitelist.
   * Se invoca ANTES de cerrar el overlay — la UI nunca se muestra a no autorizados.
   * @param {string} token  id_token de Google
   * @param {object} payload  Claims del JWT (email, name, etc.)
   */
  async function _handleCredential(response) {
    const token = response.credential;
    const payload = getPayload(token);

    // Mostrar estado "verificando" en el overlay mientras pinguea GAS
    const btn = document.getElementById('sea-signin-btn');
    if (btn) btn.innerHTML = '<p style="color:#5f6368;font-size:14px;margin:8px 0;">Verificando acceso...</p>';

    // Si hay gasUrl configurado, verificar con GAS antes de abrir la app
    if (_gasUrl) {
      try {
        // Usar POST para mantener el token fuera de la URL (B-03)
        const resp = await fetch(_gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'verificarAcceso', id_token: token })
        });
        const data = await resp.json();

        if (!data.success || data.error === 'AUTH_REQUIRED') {
          // Usuario NO autorizado — mostrar error en overlay, nunca cerrar
          if (window.google && window.google.accounts) {
            google.accounts.id.disableAutoSelect();
          }
          const email = payload ? (payload.email || '') : '';
          showAuthError(
            `Tu cuenta (${email}) no tiene acceso a este sistema.\n` +
            'Contacta al administrador para solicitar acceso.'
          );
          // Restaurar botón de login para que pueda intentar con otra cuenta
          if (btn) {
            google.accounts.id.renderButton(btn,
              { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
            );
          }
          return; // ← la app NO se carga
        }
      } catch (_err) {
        // Error de red al verificar — mostrar mensaje pero no bloquear indefinidamente
        showAuthError('No se pudo verificar el acceso. Revisa tu conexión e intenta de nuevo.');
        if (btn) {
          google.accounts.id.renderButton(btn,
            { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
          );
        }
        return;
      }
    }

    // ✅ Autorizado (o no se configuró gasUrl) — proceder normalmente
    saveToken(token);
    removeOverlay();
    showUserBar(payload);
    if (_onAuthSuccess) _onAuthSuccess(token, payload);
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  function logout() {
    const token = getToken();
    clearToken();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
      // Revocar token si es posible
      const payload = token ? getPayload(token) : null;
      if (payload && payload.sub) {
        google.accounts.id.revoke(payload.sub, () => {});
      }
    }
    location.reload();
  }

  // ─── wrapFetch: inyecta el token en cada request ──────────────────────────
  /**
   * Reemplaza fetch() para incluir automáticamente el id_token.
   *
   * Todos los requests autenticados se envían como POST con el token en el body
   * (no en la URL) para evitar que quede en el historial del navegador y logs.
   *
   * Si el token expiró, recarga la página (fuerza re-login).
   */
  async function wrapFetch(url, options = {}) {
    const token = getToken();

    if (isExpired(token)) {
      clearToken();
      location.reload();
      return Promise.reject(new Error('Sesión expirada. Por favor inicia sesión nuevamente.'));
    }

    const method = (options.method || 'GET').toUpperCase();

    if (method === 'GET') {
      // Convertir GET a POST para mantener el id_token fuera de la URL (B-03).
      // Se extraen los query params de la URL y se envían en el body JSON junto al token.
      const urlObj = new URL(url, location.origin);
      const body = { id_token: token };
      urlObj.searchParams.forEach((v, k) => { body[k] = v; });
      return fetch(urlObj.origin + urlObj.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } else {
      let body = {};
      try {
        body = JSON.parse(options.body || '{}');
      } catch (_) {
        // body no es JSON — caso edge, no modificar
        return fetch(url, options);
      }
      body.id_token = token;
      return fetch(url, { ...options, body: JSON.stringify(body) });
    }
  }

  // ─── API pública del módulo ───────────────────────────────────────────────
  return { init, logout, getToken, isExpired, wrapFetch };
})();

// `const` de nivel superior NO crea propiedad en window: se expone a mano para
// que cualquier página pueda comprobar `window.SEAAuth` sin fallar.
window.SEAAuth = SEAAuth;

/**
 * Llamado automáticamente por el script de Google Identity Services al cargar.
 * No renombrar — es el callback del atributo onload del <script> de GIS.
 */
function onGISLoaded() {
  if (window._seaAuthInitGIS) {
    window._seaAuthInitGIS();
  }
}
