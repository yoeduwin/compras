# Conectar el Sistema de Compras a Google Sheets

Esto convierte tu hoja de Google en la **base de datos compartida** del sistema:
todas las solicitudes, órdenes, evaluaciones y proveedores quedan en la hoja y
las ve todo el equipo desde cualquier equipo. Es **gratis** y no ocupa un
proyecto de Supabase. Montaje único de ~5 minutos.

> Mientras no lo conectes, el sistema funciona igual guardando en el navegador
> (localStorage) con respaldo Exportar/Importar JSON.

---

## Paso 1 — Abre tu hoja de Google
Usa la que ya tienes (o crea una nueva). No necesitas crear las pestañas a mano;
el script crea solas las pestañas **Solicitudes, Ordenes, Evaluaciones y Proveedores**.

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

## Paso 6 — Conéctalo en el sistema de compras
1. Abre el sistema → pestaña **🗂️ Historial y Trazabilidad**.
2. En **"Conexión con Google Sheets"**:
   - Pega la **URL** (…/exec).
   - Escribe el mismo **token** del Paso 3.
   - Clic en **🔌 Probar conexión y guardar**.
3. Si todo está bien verás **Conectado ✓** y se sincroniza al instante.

¡Listo! Desde ahora cada folio que generes se guarda en tu hoja de Google.

---

## Cómo funciona
- **Folios consecutivos por año** (SC-AA-NN / OC-AA-NN): los asigna el servidor,
  así **no se repiten** aunque dos personas generen al mismo tiempo. Se reinician
  cada año.
- **Sin internet:** el sistema guarda local y deja los cambios "pendientes";
  al reconectar, el botón **🔄 Sincronizar ahora** (o abrir la app) los sube.
- **La hoja es legible:** cada pestaña tiene `clave | fecha | resumen | json`.
  La columna `json` es la fuente de verdad; las demás son para que tú leas/filtres.

## Preguntas frecuentes
- **¿Es seguro?** El acceso está protegido por tu *token*. Cualquiera con la URL
  **y** el token puede leer/escribir, así que trata el token como una contraseña.
  Para más control, cambia el token y vuelve a **Probar conexión**.
- **¿Puedo seguir usando el respaldo JSON?** Sí, sigue disponible en la misma
  pestaña como copia de seguridad adicional.
- **¿Cambié el código?** Cada vez que edites `Code.gs` debes hacer
  **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva
  → Implementar** para que los cambios tomen efecto.
