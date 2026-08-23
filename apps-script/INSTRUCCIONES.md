# Conectar el Sistema de Compras a Google Sheets

Esto convierte tu hoja de Google en la **base de datos compartida** del sistema:
todas las solicitudes, órdenes, evaluaciones y proveedores quedan en la hoja y
las ve todo el equipo desde cualquier equipo. Es **gratis** y no ocupa un
proyecto de Supabase. Montaje único de ~10 minutos.

> Mientras no lo conectes, el sistema funciona igual guardando en el navegador
> (localStorage) con respaldo Exportar/Importar JSON.

## Seguridad (importante — cambió respecto a la versión anterior)

**Ya no hay un "token secreto" escrito en el `index.html`.** Ese token quedaba
expuesto a cualquiera que abriera el código fuente de la página. Ahora el acceso
funciona **igual que en SEADB**:

- El usuario **inicia sesión con su cuenta de Google**.
- El navegador manda el **id_token de Google** (no un token fijo, y viaja en el
  cuerpo de la petición, nunca en la URL).
- El **servidor (Apps Script)** valida ese id_token contra Google y comprueba que
  el correo esté en la **lista blanca** (pestaña `Usuarios` de la hoja).

Resultado: aunque alguien tenga la URL `/exec`, **no puede leer ni escribir nada**
si no inicia sesión con un correo autorizado. El único dato "público" es el
**Client ID de Google**, que por diseño de Google **no es secreto**.

---

## Paso 1 — Abre tu hoja de Google
Usa **esta hoja** (la que ya tienes):
<https://docs.google.com/spreadsheets/d/1IoGmRjVUIItcCfEjb6HOP8gglqvkw6ZHbfDT-oX3FnY/edit>
No necesitas crear las pestañas de datos a mano; el script crea solas las
pestañas **Solicitudes, Ordenes, Evaluaciones y Proveedores**.

## Paso 2 — Abre el editor de Apps Script
En la hoja: menú **Extensiones → Apps Script**.

## Paso 3 — Pega el código
1. Borra lo que traiga el archivo `Código.gs`.
2. Copia **todo** el contenido de [`Code.gs`](./Code.gs) de este repositorio y pégalo.
3. Guarda (💾 o Ctrl+S). Ya no hay que editar ningún token dentro del código.

## Paso 4 — Configura el Client ID en Propiedades del Script
El Client ID **no se escribe en el código**: se guarda en las propiedades del
proyecto para que sea fácil de cambiar.

1. En el editor de Apps Script: ⚙️ **Configuración del proyecto**.
2. Baja a **Propiedades del script → Agregar propiedad de script**.
3. Crea la propiedad:
   - **Propiedad:** `GOOGLE_CLIENT_ID`
   - **Valor:** `407541868250-5pbtl3me85quu1nl38b1c57ebi3nn9a6.apps.googleusercontent.com`
     (es el **mismo Client ID** que usa `auth.js` y los sistemas SEA/SEADB).
4. Guarda.

> Este es el mismo proyecto de Google Cloud que ya usas en SEA, por eso puedes
> reutilizar el Client ID. Solo hay que autorizar el nuevo origen (Paso 7).

## Paso 5 — Crea la lista blanca de correos
1. En el editor de Apps Script, en la lista de funciones (arriba, junto a
   ▶ Ejecutar), elige **`crearHojaUsuarios`** y haz clic en **Ejecutar**.
   La primera vez Google pedirá **autorizar permisos**: acepta.
2. Esto crea la pestaña **`Usuarios`** en la hoja y siembra tu correo
   (`eduwin.ejecutiva@gmail.com`).
3. Para dar acceso a alguien más, **agrega una fila** en esa pestaña:
   `correo | nombre | activo | alta`. Con `activo` vacío, `sí`, `true` o `1` queda
   autorizado; con `no` queda bloqueado sin borrarlo.

## Paso 5.1 — (Opcional) Carga los proveedores confiables en la hoja
Si quieres los **15 proveedores confiables** (EA-FCPS-05.04) directamente en la
hoja compartida: en la lista de funciones del editor elige **`sembrarProveedores`**
y haz clic en **Ejecutar**. Crea/rellena la pestaña **`Proveedores`**. Es
idempotente: si la vuelves a ejecutar, actualiza en vez de duplicar.

## Paso 6 — Publica como Aplicación web
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. En "Tipo", elige **Aplicación web** (ícono ⚙️ → Aplicación web).
3. Configura:
   - **Descripción:** Compras EA
   - **Ejecutar como:** *Yo (tu correo)*
   - **Quién tiene acceso:** **Cualquier usuario**
     (esto es seguro: la puerta real es el login de Google + lista blanca).
4. Clic en **Implementar**. Copia la **URL** que termina en **`/exec`**.
   (Si la pierdes: **Implementar → Administrar implementaciones**.)

## Paso 7 — Autoriza el origen en Google Cloud
Para que el login de Google funcione desde donde publicas el sistema:

1. Ve a **Google Cloud Console → APIs y servicios → Credenciales**
   (<https://console.cloud.google.com/apis/credentials>), en el **mismo proyecto**
   del Client ID.
2. Abre el **ID de cliente de OAuth** (el del Client ID de arriba).
3. En **Orígenes de JavaScript autorizados**, agrega el **origen** (sin ruta)
   donde abres el sistema. Ej. GitHub Pages: `https://yoeduwin.github.io`.
   > El login de Google **no** funciona abriendo el archivo como `file://`:
   > necesita una URL `https://` real.
4. En la **Pantalla de consentimiento de OAuth**, agrega como *usuarios de
   prueba* los correos que vayan a entrar (o publica la app).

## Paso 8 — Conecta la URL en el sistema (una sola vez)
En `index.html`, en el bloque `CONFIG` de hasta arriba del `<script>`, pon la URL:

```js
const CONFIG = {
    SHEETS_URL: 'https://script.google.com/macros/s/AKfy.../exec'
    // Ya NO hay token aquí. El acceso lo controla Google (auth.js + lista blanca).
};
```

Guarda y publica `index.html`. Al abrir el sistema aparecerá el **login de Google**
a pantalla completa; al entrar con un correo autorizado se muestra la barra
**☁️ Sincronización: Conectado ✓** y arriba tu correo con el botón **Salir**.
Si dejas `SHEETS_URL` vacío, el sistema trabaja solo en el navegador (sin login
ni conexión).

¡Listo!

---

## Cómo funciona
- **Login obligatorio con Google** cuando hay base compartida. El módulo
  `auth.js` (el **mismo** de SEA/SEADB) muestra el overlay de acceso y bloquea la
  app hasta verificar contra la lista blanca en el servidor.
- **Folios consecutivos por año** (SC-AA-NN / OC-AA-NN): los asigna el servidor,
  así **no se repiten** aunque dos personas generen al mismo tiempo. Se reinician
  cada año.
- **Sin internet:** el sistema guarda local y deja los cambios "pendientes";
  al reconectar, el botón **🔄 Sincronizar** de la barra (o abrir la app) los sube.
- **La hoja es legible:** cada pestaña tiene `clave | fecha | resumen | json`.
  La columna `json` es la fuente de verdad; las demás son para que tú leas/filtres.

---

## Preguntas frecuentes
- **¿Es seguro ahora?** Sí: no hay contraseñas ni tokens en el código público.
  Para entrar hace falta una cuenta de Google que **tú** hayas puesto en la
  pestaña `Usuarios`, y Google valida el token en cada petición.
- **¿Cómo doy o quito acceso?** Agrega o edita filas en la pestaña `Usuarios`
  (columna `activo`). No hay que tocar código ni volver a implementar.
- **¿Y si cambia el equipo?** Cada persona solo necesita su cuenta de Google
  autorizada; no se comparte ninguna clave.
- **¿Puedo seguir usando el respaldo JSON?** Sí, sigue disponible como copia de
  seguridad adicional.
- **¿Cambié el `Code.gs`?** Cada vez que lo edites: **Implementar → Administrar
  implementaciones → editar (lápiz) → Versión: Nueva → Implementar**.
- **¿Qué series maneja?** Laboratorio usa `SC` (solicitud) y `OC` (orden);
  empresa usa `REQ` y `OCB`. Cada serie lleva su propio consecutivo por año y
  todas se calculan en la hoja. El sistema pregunta el ámbito antes de capturar.
- **¿Por qué me pide un permiso nuevo al re-implementar?** El envío de
  documentos por correo usa `GmailApp`: la primera vez Google pide autorizar
  el permiso de envío. Los correos salen de la cuenta dueña del script y la
  respuesta llega a quien lo envió desde el sistema (`Responder a`).
- **¿De dónde salen los folios?** Siempre de la hoja. El servidor los calcula
  bajo candado (`LockService`) al dar de alta, y la acción `nextFolio` sirve
  para mostrar la vista previa en el formulario. El navegador ya no inventa
  consecutivos: si no hay conexión con la hoja, no se guarda el registro.
- **¿Por qué el Client ID está a la vista?** Porque Google lo diseñó público:
  identifica a la app, no autoriza nada por sí solo. Lo que protege es la
  verificación del id_token + la lista blanca, ambas en el servidor.
