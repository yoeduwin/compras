# Conectar el Sistema de Compras a Google Sheets

Esto convierte tu hoja de Google en la **base de datos compartida** del sistema:
todas las solicitudes, órdenes, evaluaciones y proveedores quedan en la hoja y
las ve todo el equipo desde cualquier equipo. Es **gratis** y no ocupa un
proyecto de Supabase. Montaje único de ~5 minutos.

> Mientras no lo conectes, el sistema funciona igual guardando en el navegador
> (localStorage) con respaldo Exportar/Importar JSON.

---

## Paso 1 — Abre tu hoja de Google
Usa **esta hoja** (la que ya tienes):
<https://docs.google.com/spreadsheets/d/1IoGmRjVUIItcCfEjb6HOP8gglqvkw6ZHbfDT-oX3FnY/edit>
No necesitas crear las pestañas a mano; el script crea solas las pestañas
**Solicitudes, Ordenes, Evaluaciones y Proveedores**.

## Paso 2 — Abre el editor de Apps Script
En la hoja: menú **Extensiones → Apps Script**.

## Paso 3 — Pega el código
1. Borra lo que traiga el archivo `Código.gs`.
2. Copia **todo** el contenido de [`Code.gs`](./Code.gs) de este repositorio y pégalo.
3. En la línea de arriba, cambia el token por una palabra secreta tuya:
   ```js
   var TOKEN = 'CAMBIA-ESTE-TOKEN';   // ej. 'EA-compras-2026-x7k9'
   ```
   Anótala; la usarás en el Paso 6.
4. Guarda (💾 o Ctrl+S).

## Paso 4 — Publica como Aplicación web
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. En "Tipo", elige **Aplicación web** (ícono ⚙️ → Aplicación web).
3. Configura:
   - **Descripción:** Compras EA
   - **Ejecutar como:** *Yo (tu correo)*
   - **Quién tiene acceso:** **Cualquier usuario**
4. Clic en **Implementar**. La primera vez Google pedirá **autorizar permisos**:
   acepta (elige tu cuenta → "Configuración avanzada" → "Ir a … (no seguro)" →
   Permitir). Es normal: el permiso es para que el script escriba en *tu* hoja.

## Paso 5 — Copia la URL
Al terminar te da una **URL de la app web** que termina en **`/exec`**.
Cópiala. (Si la pierdes: **Implementar → Administrar implementaciones**.)

## Paso 6 — Conéctalo en el código (una sola vez)
La configuración **no se captura en la aplicación** (para no exponer el token ni
la URL a quien usa el sistema): se pone una vez en el archivo `index.html`, en el
bloque `CONFIG` que está hasta arriba del `<script>`:

```js
const CONFIG = {
    SHEETS_URL: 'https://script.google.com/macros/s/AKfy.../exec',
    SHEETS_TOKEN: 'EA-compras-2026-x7k9',   // el mismo token del Paso 3
    GOOGLE_CLIENT_ID: ''                     // (opcional, ver más abajo)
};
```

Guarda y publica `index.html`. Desde ese momento, al abrir el sistema aparece una
barra discreta **☁️ Sincronización: Conectado ✓** en la pestaña Historial y cada
folio que generes se guarda en tu hoja de Google. Si dejas `CONFIG` vacío, el
sistema trabaja solo en el navegador (sin barra ni conexión).

¡Listo!

---

## Cómo funciona
- **Folios consecutivos por año** (SC-AA-NN / OC-AA-NN): los asigna el servidor,
  así **no se repiten** aunque dos personas generen al mismo tiempo. Se reinician
  cada año.
- **Sin internet:** el sistema guarda local y deja los cambios "pendientes";
  al reconectar, el botón **🔄 Sincronizar** de la barra (o abrir la app) los sube.
- **La hoja es legible:** cada pestaña tiene `clave | fecha | resumen | json`.
  La columna `json` es la fuente de verdad; las demás son para que tú leas/filtres.

---

## (Opcional) Restringir el acceso por correo de Gmail — OAuth

Por defecto el acceso está protegido solo con el **token**. Si además quieres que
**solo ciertos correos de Google** puedan usar el sistema (como en tu proyecto
"SEA"), activa esta capa. Requiere un **Client ID de OAuth**.

### A. Crea (o reutiliza) un Client ID de OAuth
1. Entra a **Google Cloud Console → APIs y servicios → Credenciales**
   (<https://console.cloud.google.com/apis/credentials>).
2. **Crear credenciales → ID de cliente de OAuth → Tipo: Aplicación web**.
   (Si ya tienes uno en el proyecto "SEA", puedes reutilizarlo: solo agrégale el
   origen del Paso A.3.)
3. En **Orígenes de JavaScript autorizados** agrega la **URL donde está publicado
   el sistema** (solo el origen, sin ruta). Por ejemplo, si lo abres desde GitHub
   Pages: `https://yoeduwin.github.io`. (El login de Google **no** funciona
   abriendo el archivo como `file://`; necesita una URL `https://` real.)
4. Guarda y **copia el Client ID** (`…apps.googleusercontent.com`).
5. En **Pantalla de consentimiento de OAuth**, agrega como *usuarios de prueba*
   los correos que vayan a entrar (o publica la app).

### B. Configura el Apps Script
En `Code.gs`, arriba, llena estas dos variables y **vuelve a implementar**
(Administrar implementaciones → editar → Versión: Nueva → Implementar):
```js
var CLIENT_ID = 'TU-CLIENT-ID.apps.googleusercontent.com';
var ALLOWED_EMAILS = [
  'eduwin.ejecutiva@gmail.com',
  'eduardo.campos@ejemplo.com',
];
```
> Si dejas `ALLOWED_EMAILS` vacío, no se restringe por correo (solo el token).

### C. Configura el sistema de compras
1. En `index.html`, en el bloque `CONFIG`, pon tu Client ID:
   ```js
   GOOGLE_CLIENT_ID: 'TU-CLIENT-ID.apps.googleusercontent.com'
   ```
2. Al abrir el sistema, la barra de Historial mostrará **🔑 Iniciar sesión**.
   Cada persona hace clic y elige su cuenta de Google.
3. Si su correo está en la lista, verá **Sesión: su@correo** y podrá trabajar.
   Si no está autorizado, el sistema lo rechaza y no sincroniza.

Así, aunque alguien tenga el token, **no podrá leer ni escribir** si su correo no
está en la lista blanca.

---

## Preguntas frecuentes
- **¿Es seguro?** El acceso está protegido por tu *token*. Cualquiera con la URL
  **y** el token puede leer/escribir, así que trata el token como una contraseña.
  Para más control, cambia el token en el Apps Script y en el bloque `CONFIG`.
- **¿Puedo seguir usando el respaldo JSON?** Sí, sigue disponible en la misma
  pestaña como copia de seguridad adicional.
- **¿Cambié el código?** Cada vez que edites `Code.gs` debes hacer
  **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva
  → Implementar** para que los cambios tomen efecto.
