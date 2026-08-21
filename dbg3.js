const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }).catch(()=>chromium.launch());
  const p = await (await b.newContext()).newPage();
  await p.goto('file:///home/user/compras/index.html'); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.jspdf.jsPDF.API.save=function(){}; });
  await p.evaluate(()=>{ switchTab('historial'); document.getElementById('sync-url').value='http://localhost:8931/'; document.getElementById('sync-token').value='secreto123'; });
  await p.evaluate(()=>probarConexion()); await p.waitForTimeout(500);

  // isolate: does apiPost to dead port reject?
  const rej = await p.evaluate(async ()=>{ const old=SYNC.url; SYNC.url='http://localhost:9999/'; let out;
    try{ await apiPost({action:'ping'}); out='RESOLVED'; }catch(e){ out='REJECTED:'+e.name; } SYNC.url=old; return out; });
  console.log('apiPost to dead port ->', rej);

  const vals = await p.evaluate(()=>{ switchTab('solicitud');
    document.getElementById('area-solicita').value='Lab'; document.getElementById('tipo-solicitud').value='Equipamiento'; document.getElementById('descripcion').value='offline doc';
    return { fecha: document.getElementById('fecha-solicitud').value, area: document.getElementById('area-solicita').value, desc: document.getElementById('descripcion').value, folioInput: document.getElementById('folio-solicitud').value };
  });
  console.log('form values:', JSON.stringify(vals));

  const r = await p.evaluate(async ()=>{ SYNC.url='http://localhost:9999/'; saveSync();
    const t=Date.now(); await guardarYGenerarSolicitud();
    return { ms:Date.now()-t, sols:DB.solicitudes.length, pending:(DB._pending||[]).length, last:DB.solicitudes[DB.solicitudes.length-1].folio };
  });
  console.log('offline create:', JSON.stringify(r));
  await b.close();
})();
