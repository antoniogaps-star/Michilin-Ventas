/* Michilin Ventas - PWA v2 */
(() => {
  'use strict';

  // Si localStorage está vacío, usa el catálogo empaquetado en catalogo.js
  const _seed = window.CATALOGO_SEED || { productos: [], modeloramas: [] };
  const _lsProd = JSON.parse(localStorage.getItem('cat_productos') || '[]');
  const _lsMod = JSON.parse(localStorage.getItem('cat_modeloramas') || '[]');

  const state = {
    backendUrl: localStorage.getItem('backendUrl') || '',
    productos: _lsProd.length ? _lsProd : _seed.productos,
    modeloramas: _lsMod.length ? _lsMod : _seed.modeloramas,
    gastos: JSON.parse(localStorage.getItem('gastos_cache') || '[]'),
    pendientes: JSON.parse(localStorage.getItem('pendientes') || '[]'),
    venta: nuevaVenta(),
    pantalla: 'home',
    historial: []  // navegación atrás
  };

  function nuevaVenta() {
    return {
      fecha: hoy(),
      modelorama: null,
      items: {},      // {fila: {producto, cantidad, precio_unit, fila}}
      descuento: 0,
      tipoDesc: '$',  // $ o %
      motivoDesc: '',
      nota: ''
    };
  }

  // ===== Helpers =====
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
  const fmt = n => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function hoy() { const d = new Date(); return d.toISOString().slice(0, 10); }
  const guardarLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function toast(msg, tipo = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + tipo;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2500);
  }

  function setEstadoSync() {
    const el = $('#estadoSync');
    const n = state.pendientes.length;
    if (!navigator.onLine) { el.textContent = 'sin red'; el.className = 'badge warn'; }
    else if (n > 0) { el.textContent = n + ' pend'; el.className = 'badge warn'; }
    else { el.textContent = 'OK'; el.className = 'badge ok'; }
    const pi = $('#pendInfo');
    if (pi) pi.textContent = n + ' venta(s) sin sincronizar';
  }

  // ===== Navegación =====
  function ir(pantalla, push = true) {
    if (push && state.pantalla !== pantalla) state.historial.push(state.pantalla);
    state.pantalla = pantalla;
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === pantalla));
    $('#btnBack').hidden = state.historial.length === 0;
    const titulos = {
      home: 'Michilin', venta: 'Nueva venta',
      inventario: 'Inventario inicial', historial: 'Ventas del día',
      config: 'Configuración', productos: 'Productos',
      reimpresion: 'Reimprimir tickets', informes: 'Informes',
      gastos: 'Gastos', conexion: 'Conexión backend'
    };
    $('#titulo').textContent = titulos[pantalla] || 'Michilin';
    if (pantalla === 'venta') initVenta();
    if (pantalla === 'inventario') cargarInventario();
    if (pantalla === 'historial') cargarHistorial();
    if (pantalla === 'productos') renderProductosConfig();
    if (pantalla === 'reimpresion') cargarReimpresion();
    if (pantalla === 'informes') initInformes();
    if (pantalla === 'gastos') initGastos();
    if (pantalla === 'home') refrescarResumen();
    window.scrollTo(0, 0);
  }
  function atras() {
    const prev = state.historial.pop() || 'home';
    ir(prev, false);
  }

  // ===== API =====
  async function api(params, body) {
    if (!state.backendUrl) throw new Error('Configura la URL del backend');
    const url = state.backendUrl + (params ? '?' + new URLSearchParams(params) : '');
    const opts = body
      ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }
      : { method: 'GET' };
    const r = await fetch(url, opts);
    return r.json();
  }

  async function cargarCatalogosRemoto() {
    const r = await api({ accion: 'catalogos' });
    if (r.ok) {
      state.productos = r.productos;
      state.modeloramas = r.modeloramas;
      guardarLS('cat_productos', r.productos);
      guardarLS('cat_modeloramas', r.modeloramas);
      const ci = $('#catInfo');
      if (ci) ci.textContent = `${r.productos.length} productos · ${r.modeloramas.length} modeloramas`;
      return true;
    }
    return false;
  }

  async function sincronizar() {
    if (!navigator.onLine || !state.backendUrl) return;
    const pend = [...state.pendientes];
    for (const p of pend) {
      try {
        const r = await api(null, p);
        if (r.ok) {
          state.pendientes = state.pendientes.filter(x => x._id !== p._id);
          guardarLS('pendientes', state.pendientes);
        }
      } catch (e) { break; }
    }
    setEstadoSync();
  }

  // ===== VENTA =====
  function initVenta() {
    state.venta = nuevaVenta();
    $('#fechaVenta').value = state.venta.fecha;
    $('#modSel').hidden = true;
    $('#notaVenta').value = '';
    renderCarrito();
    actualizarTotales();
  }

  function abrirSelectorModelorama() {
    $('#modalModelorama').hidden = false;
    $('#buscaModelorama').value = '';
    renderListaModeloramas('');
    setTimeout(() => $('#buscaModelorama').focus(), 100);
  }

  function renderListaModeloramas(filtro) {
    const f = norm(filtro);
    const cont = $('#listaModeloramas');
    const items = (state.modeloramas || []).filter(m =>
      !f || norm(m.nombre).includes(f) || String(m.numero).includes(f)
    ).slice(0, 50);
    cont.innerHTML = items.length
      ? items.map(m => `<div class="prod-pick-item" data-num="${m.numero}">
          <div>
            <div class="nombre">${m.nombre}</div>
            <div class="precio">#${m.numero}${m.ciudad ? ' · ' + m.ciudad : ''}</div>
          </div>
        </div>`).join('')
      : '';
    // Si lo que tecleó no coincide con ningún resultado, ofrecer capturarlo nuevo
    const txt = (filtro || '').trim();
    $('#nuevoModBox').hidden = !(txt.length >= 2 && items.length === 0);
  }

  function usarNuevoModelorama() {
    const nombre = ($('#buscaModelorama').value || '').trim().toUpperCase();
    if (!nombre) { toast('Escribe el nombre', 'error'); return; }
    let numero = Number($('#nuevoModNum').value) || 0;
    if (!numero) {
      // genera un número temporal único basado en timestamp
      numero = 900000000 + Math.floor(Math.random() * 99999999);
    }
    const m = { numero, nombre, sag: '', estado: '', ciudad: '' };
    // Si no existe ya, lo agregamos al catálogo local
    if (!state.modeloramas.find(x => Number(x.numero) === Number(numero))) {
      state.modeloramas.push(m);
      guardarLS('cat_modeloramas', state.modeloramas);
      // Y lo encolamos para subir al backend
      state.pendientes.push({ accion: 'modelorama_alta', numero, nombre, _id: 'm_' + Date.now() });
      guardarLS('pendientes', state.pendientes);
      setEstadoSync();
    }
    $('#nuevoModNum').value = '';
    $('#nuevoModBox').hidden = true;
    elegirModelorama(m);
  }

  function elegirModelorama(m) {
    state.venta.modelorama = m;
    $('#modSel').hidden = false;
    $('#modSel').innerHTML = `<strong>${m.nombre}</strong><small>#${m.numero}${m.ciudad ? ' · ' + m.ciudad : ''}</small>`;
    $('#modalModelorama').hidden = true;
    actualizarTotales();
    toast('✓ ' + m.nombre, 'ok');
  }

  function abrirSelectorProductos() {
    $('#modalProductos').hidden = false;
    $('#buscaProd').value = '';
    renderPickerProductos('');
    setTimeout(() => $('#buscaProd').focus(), 100);
  }

  function renderPickerProductos(filtro) {
    const f = norm(filtro);
    const cont = $('#listaProductos');
    const items = state.productos.filter(p => !f || norm(p.nombre).includes(f));
    cont.innerHTML = items.map(p => {
      const added = !!state.venta.items[p.fila];
      return `<div class="prod-pick-item ${added ? 'added' : ''}" data-fila="${p.fila}">
        <div><div class="nombre">${p.nombre}</div><div class="precio">${fmt(p.precio)}</div></div>
      </div>`;
    }).join('') || '<p class="muted small">Sin resultados</p>';
  }

  function agregarProducto(fila) {
    const prod = state.productos.find(p => p.fila === fila);
    if (!prod) return;
    // Abre diálogo de cantidad manual
    const actual = state.venta.items[fila]?.cantidad || 1;
    $('#modalCantTitulo').textContent = prod.nombre;
    $('#modalCantProd').textContent = 'Precio: ' + fmt(prod.precio);
    $('#inpCantidad').value = actual;
    $('#inpCantidad').dataset.fila = fila;
    $('#modalCantidad').hidden = false;
    setTimeout(() => { $('#inpCantidad').focus(); $('#inpCantidad').select(); }, 100);
  }

  function aceptarCantidad() {
    const fila = Number($('#inpCantidad').dataset.fila);
    const cant = Math.max(0, Math.floor(Number($('#inpCantidad').value) || 0));
    const prod = state.productos.find(p => p.fila === fila);
    if (!prod) return;
    if (cant === 0) delete state.venta.items[fila];
    else state.venta.items[fila] = { producto: prod.nombre, cantidad: cant, precio_unit: prod.precio, fila };
    $('#modalCantidad').hidden = true;
    renderCarrito();
    actualizarTotales();
    renderPickerProductos($('#buscaProd').value);
    toast(`${cant} × ${prod.nombre}`, 'ok');
  }

  function actualizarItem(fila, campo, valor) {
    const it = state.venta.items[fila];
    if (!it) return;
    if (campo === 'cantidad') it.cantidad = Math.max(0, Number(valor) || 0);
    if (campo === 'precio_unit') it.precio_unit = Math.max(0, Number(valor) || 0);
    if (it.cantidad === 0) delete state.venta.items[fila];
    renderCarrito();
    actualizarTotales();
  }

  function quitarItem(fila) {
    delete state.venta.items[fila];
    renderCarrito();
    actualizarTotales();
  }

  function renderCarrito() {
    const items = Object.values(state.venta.items);
    const tbl = $('#tablaCarrito');
    const vac = $('#carritoVacio');
    const fab = $('#btnCarritoIcon');
    if (!items.length) {
      tbl.hidden = true; vac.hidden = false; fab.style.display = 'flex';
      return;
    }
    tbl.hidden = false; vac.hidden = true; fab.style.display = 'flex';
    $('#carritoBody').innerHTML = items.map(it => `
      <tr data-fila="${it.fila}">
        <td class="prod">${it.producto}</td>
        <td><input type="number" inputmode="numeric" min="0" data-k="cantidad" value="${it.cantidad}" /></td>
        <td><input type="number" inputmode="decimal" min="0" step="0.01" data-k="precio_unit" value="${it.precio_unit}" /></td>
        <td class="col-total">${fmt(it.cantidad * it.precio_unit)}</td>
        <td><button class="btn-del" data-quitar="${it.fila}">×</button></td>
      </tr>
    `).join('');
  }

  function calcularTotales() {
    const items = Object.values(state.venta.items);
    const subtotal = items.reduce((s, it) => s + it.cantidad * it.precio_unit, 0);
    let desc = 0;
    if (state.venta.tipoDesc === '%') desc = subtotal * (state.venta.descuento / 100);
    else desc = state.venta.descuento;
    desc = Math.min(desc, subtotal);
    const total = subtotal - desc;
    return { subtotal, desc, total, itemsCount: items.length };
  }

  function actualizarTotales() {
    const { subtotal, desc, total, itemsCount } = calcularTotales();
    $('#subtotalVenta').textContent = fmt(subtotal);
    $('#descuentoVal').textContent = '-' + fmt(desc);
    $('#totalVenta').textContent = fmt(total);
    const sinMod = !state.venta.modelorama;
    const sinItems = itemsCount === 0;
    const valido = !sinMod && !sinItems && total >= 0;
    $('#btnGuardar').disabled = !valido;
    $('#btnImprimir').disabled = !valido;
    const msg = $('#msgFalta');
    if (sinMod && sinItems) { msg.textContent = '⚠ Falta seleccionar modelorama y agregar productos'; msg.hidden = false; }
    else if (sinMod) { msg.textContent = '⚠ Falta seleccionar el modelorama'; msg.hidden = false; }
    else if (sinItems) { msg.textContent = '⚠ Falta agregar productos al carrito'; msg.hidden = false; }
    else { msg.hidden = true; }
  }

  function abrirDescuento() {
    $('#modalDescuento').hidden = false;
    $('#inpDescuento').value = state.venta.descuento || '';
    $('#motivoDesc').value = state.venta.motivoDesc || '';
    $$('input[name=tipoDesc]').forEach(r => r.checked = (r.value === state.venta.tipoDesc));
  }

  function aplicarDescuento() {
    const tipo = $$('input[name=tipoDesc]').find(r => r.checked).value;
    const monto = Number($('#inpDescuento').value) || 0;
    state.venta.tipoDesc = tipo;
    state.venta.descuento = monto;
    state.venta.motivoDesc = $('#motivoDesc').value.trim();
    $('#modalDescuento').hidden = true;
    actualizarTotales();
    toast('Descuento aplicado', 'ok');
  }

  function payloadVenta() {
    const items = Object.values(state.venta.items);
    const { subtotal, desc, total } = calcularTotales();
    if (!state.venta.hora) {
      const d = new Date();
      state.venta.hora = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    if (!state.venta.visita) {
      const key = 'visitas_' + state.venta.fecha;
      const n = (Number(localStorage.getItem(key)) || 0) + 1;
      localStorage.setItem(key, n);
      state.venta.visita = n;
    }
    return {
      accion: 'venta',
      fecha: state.venta.fecha,
      hora: state.venta.hora,
      visita: state.venta.visita,
      modelorama_num: state.venta.modelorama.numero,
      modelorama_nombre: state.venta.modelorama.nombre,
      items: items.map(it => ({ producto: it.producto, cantidad: it.cantidad, precio_unit: it.precio_unit })),
      subtotal, descuento: desc, tipo_descuento: state.venta.tipoDesc,
      motivo_descuento: state.venta.motivoDesc,
      total,
      nota: $('#notaVenta').value.trim(),
      _id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    };
  }

  async function guardarVenta() {
    if (!state.venta.modelorama || !Object.keys(state.venta.items).length) return;
    const payload = payloadVenta();
    let enviado = false;
    if (navigator.onLine && state.backendUrl) {
      try {
        const r = await api(null, payload);
        if (r.ok) enviado = true;
        else toast('Error: ' + (r.error || 'desconocido'), 'error');
      } catch (e) { toast('Sin red — guardando local', 'warn'); }
    }
    if (!enviado) {
      state.pendientes.push(payload);
      guardarLS('pendientes', state.pendientes);
    }
    setEstadoSync();
    toast(enviado ? '✓ Venta guardada' : '✓ Guardada (pendiente)', 'ok');
    ir('home');
  }

  // ===== Ticket =====
  function generarTicketTexto(p) {
    const ancho = 32;
    const center = s => s.length >= ancho ? s : ' '.repeat(Math.floor((ancho - s.length) / 2)) + s;
    const linea = '-'.repeat(ancho);
    const lr = (l, r) => l + ' '.repeat(Math.max(1, ancho - l.length - r.length)) + r;
    let t = '';
    t += center('MICHILIN') + '\n';
    t += center('Productos artesanales') + '\n';
    t += linea + '\n';
    t += lr('Fecha: ' + p.fecha, p.hora ? p.hora : '') + '\n';
    if (p.visita) t += 'Visita #' + p.visita + ' del dia\n';
    t += 'Cliente: ' + p.modelorama_nombre + '\n';
    t += '#' + p.modelorama_num + '\n';
    t += linea + '\n';
    for (const it of p.items) {
      t += it.producto.substring(0, ancho) + '\n';
      t += lr(`  ${it.cantidad} x ${fmt(it.precio_unit)}`, fmt(it.cantidad * it.precio_unit)) + '\n';
    }
    t += linea + '\n';
    t += lr('Subtotal:', fmt(p.subtotal)) + '\n';
    if (p.descuento > 0) {
      t += lr('Descuento:', '-' + fmt(p.descuento)) + '\n';
      if (p.motivo_descuento) t += '  (' + p.motivo_descuento + ')\n';
    }
    t += lr('TOTAL:', fmt(p.total)) + '\n';
    t += linea + '\n';
    if (p.nota) t += 'Nota: ' + p.nota + '\n';
    t += center('Gracias por su compra') + '\n';
    t += '\n\n';
    return t;
  }

  function renderTicketCarrito() {
    const items = Object.values(state.venta.items);
    const body = $('#ticketCarritoBody');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;">Sin productos</td></tr>';
      return;
    }
    body.innerHTML = items.map(it => `
      <tr data-fila="${it.fila}">
        <td class="prod">${it.producto}</td>
        <td><input type="number" inputmode="numeric" min="0" data-k="cantidad" value="${it.cantidad}" style="width:60px;" /></td>
        <td class="col-total">${fmt(it.cantidad * it.precio_unit)}</td>
        <td><button class="btn-del" data-quitar="${it.fila}">×</button></td>
      </tr>
    `).join('');
  }

  function refrescarTicketPreview() {
    if (!Object.keys(state.venta.items).length) {
      $('#modalTicket').hidden = true;
      return;
    }
    const payload = payloadVenta();
    $('#ticketRender').textContent = generarTicketTexto(payload);
    renderTicketCarrito();
    renderCarrito();
    actualizarTotales();
  }

  function mostrarTicket(payload) {
    const txt = generarTicketTexto(payload);
    $('#ticketRender').textContent = txt;
    renderTicketCarrito();
    $('#modalTicket').hidden = false;
  }

  async function imprimirTicket() {
    if (!state.venta.modelorama || !Object.keys(state.venta.items).length) return;
    const payload = payloadVenta();
    mostrarTicket(payload);
  }

  function imprimirBluetooth() {
    let txt = $('#ticketRender').textContent;
    txt = txt.normalize('NFD').replace(/[̀-ͯ]/g, '');
    txt = txt + '\n\n\n\n';
    try {
      const url = 'rawbt:' + encodeURIComponent(txt);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch (e) {} }, 100);
    } catch (e) {
      toast('No se pudo abrir RawBT. ¿Está instalada?', 'error');
    }
  }
  function imprimirHoja() { window.print(); }

  // ===== Inventario =====
  function cargarInventario() {
    $('#fechaInv').value = hoy();
    const cont = $('#invList');
    const guardado = JSON.parse(localStorage.getItem('inv_' + hoy()) || '{}');
    cont.innerHTML = '<div class="inv-row head"><div>Producto</div><div>I.I.</div><div>Resurt.</div><div>Devol.</div></div>' +
      state.productos.map(p => {
        const g = guardado[p.fila] || {};
        return `<div class="inv-row" data-fila="${p.fila}">
          <div>${p.nombre}</div>
          <input type="number" inputmode="numeric" min="0" data-k="ii" value="${g.ii ?? ''}" />
          <input type="number" inputmode="numeric" min="0" data-k="resurtido" value="${g.resurtido ?? ''}" />
          <input type="number" inputmode="numeric" min="0" data-k="devolucion" value="${g.devolucion ?? ''}" />
        </div>`;
      }).join('');
  }

  async function guardarInventarioInicial() {
    const fecha = $('#fechaInv').value || hoy();
    const items = $$('#invList .inv-row[data-fila]').map(row => {
      const fila = Number(row.dataset.fila);
      const prod = state.productos.find(p => p.fila === fila);
      const inputs = {};
      $$('input', row).forEach(i => { inputs[i.dataset.k] = Number(i.value) || 0; });
      return { fila_inv: fila, producto: prod.nombre, ...inputs };
    }).filter(it => it.ii || it.resurtido || it.devolucion);
    if (!items.length) { toast('Captura al menos un valor', 'error'); return; }
    const cacheMap = {};
    items.forEach(it => cacheMap[it.fila_inv] = { ii: it.ii, resurtido: it.resurtido, devolucion: it.devolucion });
    localStorage.setItem('inv_' + fecha, JSON.stringify(cacheMap));
    const payload = { accion: 'inventario_inicial', fecha, items, _id: 'i_' + Date.now() };
    let enviado = false;
    if (navigator.onLine && state.backendUrl) {
      try { const r = await api(null, payload); enviado = !!r.ok; } catch (e) {}
    }
    if (!enviado) { state.pendientes.push(payload); guardarLS('pendientes', state.pendientes); }
    setEstadoSync();
    toast(enviado ? '✓ Inventario guardado' : '✓ Guardado (pendiente)', 'ok');
    ir('home');
  }

  // ===== Historial =====
  async function cargarHistorial() {
    $('#fechaHist').value = hoy();
    await mostrarHistorial(hoy());
  }
  async function mostrarHistorial(fecha) {
    const cont = $('#histList');
    cont.innerHTML = '<p class="muted small">Cargando…</p>';
    if (!state.backendUrl) { cont.innerHTML = '<p class="muted">Configura el backend</p>'; return; }
    try {
      const r = await api({ accion: 'ventas', fecha });
      if (!r.ok) { cont.innerHTML = '<p class="muted">Error: ' + r.error + '</p>'; return; }
      const grupos = agruparVentas(r.ventas || []);
      const lista = Object.values(grupos);
      const total = lista.reduce((s, g) => s + g.total, 0);
      cont.innerHTML = lista.length
        ? lista.map(g => `<div class="hist-item">
            <div class="hi-head"><span>${g.modelorama}</span><span>${fmt(g.total)}</span></div>
            <div class="hi-sub">#${g.num}</div>
            <ul>${g.items.map(i => `<li>${i.cantidad} × ${i.producto}</li>`).join('')}</ul>
          </div>`).join('')
        : '<p class="muted">Sin ventas en esta fecha</p>';
      $('#histTotal').hidden = !lista.length;
      $('#histTotal').innerHTML = `<div class="row between"><span><strong>${lista.length}</strong> ventas</span><strong>${fmt(total)}</strong></div>`;
    } catch (e) { cont.innerHTML = '<p class="muted">Sin conexión</p>'; }
  }

  function agruparVentas(ventas) {
    const grupos = {};
    ventas.forEach(v => {
      const k = v.venta_id;
      if (!grupos[k]) grupos[k] = {
        venta_id: k, modelorama: v.modelorama_nombre, num: v.modelorama_num,
        fecha: v.fecha, items: [], subtotal: 0, descuento: 0, total: 0
      };
      grupos[k].items.push(v);
      grupos[k].subtotal += Number(v.importe) || 0;
      grupos[k].total = Number(v.total) || grupos[k].subtotal - (Number(v.descuento) || 0);
      grupos[k].descuento = Number(v.descuento) || 0;
    });
    return grupos;
  }

  async function refrescarResumen() {
    const c = $('#resumenDia');
    if (!state.backendUrl) { c.innerHTML = '<p class="muted small">Configura el backend en ⚙️</p>'; return; }
    try {
      const r = await api({ accion: 'ventas', fecha: hoy() });
      if (r.ok) {
        const grupos = agruparVentas(r.ventas || []);
        const cnt = Object.keys(grupos).length;
        const total = Object.values(grupos).reduce((s, g) => s + g.total, 0);
        c.innerHTML = `<div class="row between"><span>Ventas hoy</span><strong>${cnt}</strong></div>
          <div class="row between"><span>Importe</span><strong>${fmt(total)}</strong></div>`;
      }
    } catch (e) { c.innerHTML = '<p class="muted small">Sin conexión</p>'; }
  }

  // ===== Productos (config) =====
  function renderProductosConfig() {
    const cont = $('#listaProductosConfig');
    cont.innerHTML = state.productos.map(p => `
      <div class="prod-cfg-row" data-fila="${p.fila}">
        <input type="text" data-k="nombre" value="${p.nombre}" />
        <input type="number" data-k="precio" min="0" step="0.01" value="${p.precio}" />
        <button class="btn-del" data-borrar="${p.fila}">×</button>
      </div>
    `).join('');
  }

  async function agregarProducto2() {
    const nombre = $('#nuevoProdNombre').value.trim();
    const precio = Number($('#nuevoProdPrecio').value) || 0;
    if (!nombre) { toast('Falta nombre', 'error'); return; }
    const filaMax = state.productos.reduce((m, p) => Math.max(m, p.fila), 5);
    const nuevo = { fila: filaMax + 1, nombre, precio };
    state.productos.push(nuevo);
    guardarLS('cat_productos', state.productos);
    $('#nuevoProdNombre').value = '';
    $('#nuevoProdPrecio').value = '';
    if (navigator.onLine && state.backendUrl) {
      try { await api(null, { accion: 'producto_alta', ...nuevo }); } catch (e) {}
    } else {
      state.pendientes.push({ accion: 'producto_alta', ...nuevo, _id: 'p_' + Date.now() });
      guardarLS('pendientes', state.pendientes);
    }
    renderProductosConfig();
    toast('✓ Producto agregado', 'ok');
  }

  async function actualizarProducto(fila, campo, valor) {
    const p = state.productos.find(x => x.fila === fila);
    if (!p) return;
    p[campo] = campo === 'precio' ? Number(valor) || 0 : valor;
    guardarLS('cat_productos', state.productos);
    if (navigator.onLine && state.backendUrl) {
      try { await api(null, { accion: 'producto_edit', fila, [campo]: p[campo] }); } catch (e) {}
    }
  }

  async function borrarProducto(fila) {
    if (!confirm('¿Eliminar este producto?')) return;
    state.productos = state.productos.filter(p => p.fila !== fila);
    guardarLS('cat_productos', state.productos);
    if (navigator.onLine && state.backendUrl) {
      try { await api(null, { accion: 'producto_baja', fila }); } catch (e) {}
    }
    renderProductosConfig();
    toast('Producto eliminado', 'ok');
  }

  // ===== Reimpresión de tickets =====
  async function cargarReimpresion() {
    $('#fechaReimp').value = hoy();
    await mostrarTicketsReimp(hoy());
  }
  async function mostrarTicketsReimp(fecha) {
    const cont = $('#listaTickets');
    cont.innerHTML = '<p class="muted small">Cargando…</p>';
    try {
      const r = await api({ accion: 'ventas', fecha });
      const grupos = Object.values(agruparVentas(r.ventas || []));
      cont.innerHTML = grupos.length
        ? grupos.map(g => `<div class="hist-item">
            <div class="hi-head"><span>${g.modelorama}</span><span>${fmt(g.total)}</span></div>
            <div class="hi-sub">#${g.num} · ${g.fecha}</div>
            <button data-reimp='${JSON.stringify(g.venta_id)}'>🖨️ Reimprimir</button>
          </div>`).join('')
        : '<p class="muted">Sin tickets</p>';
      cont.querySelectorAll('[data-reimp]').forEach(b => b.addEventListener('click', () => {
        const id = JSON.parse(b.dataset.reimp);
        reimprimir(id, grupos);
      }));
    } catch (e) { cont.innerHTML = '<p class="muted">Sin conexión</p>'; }
  }
  function reimprimir(ventaId, grupos) {
    const g = grupos.find(x => x.venta_id === ventaId);
    if (!g) return;
    const payload = {
      fecha: g.fecha, modelorama_num: g.num, modelorama_nombre: g.modelorama,
      items: g.items.map(i => ({ producto: i.producto, cantidad: i.cantidad, precio_unit: i.precio_unit })),
      subtotal: g.subtotal, descuento: g.descuento, total: g.total, motivo_descuento: '', nota: ''
    };
    mostrarTicket(payload);
  }

  // ===== Informes =====
  function initInformes() {
    const h = hoy();
    const d = new Date(); d.setDate(d.getDate() - 7);
    $('#infDesde').value = d.toISOString().slice(0, 10);
    $('#infHasta').value = h;
    $('#informeRes').innerHTML = '';
  }
  async function generarInforme() {
    const d1 = $('#infDesde').value, d2 = $('#infHasta').value;
    const cont = $('#informeRes');
    cont.innerHTML = '<p class="muted">Generando…</p>';
    try {
      const r = await api({ accion: 'ventas', desde: d1, hasta: d2 });
      if (!r.ok) { cont.innerHTML = 'Error: ' + r.error; return; }
      const grupos = Object.values(agruparVentas(r.ventas || []));
      const total = grupos.reduce((s, g) => s + g.total, 0);
      const desc = grupos.reduce((s, g) => s + (g.descuento || 0), 0);
      // ranking productos
      const porProd = {};
      (r.ventas || []).forEach(v => {
        porProd[v.producto] = (porProd[v.producto] || 0) + (Number(v.cantidad) || 0);
      });
      const ranking = Object.entries(porProd).sort((a, b) => b[1] - a[1]).slice(0, 10);
      cont.innerHTML = `
        <div class="card">
          <div class="row between"><span>Ventas</span><strong>${grupos.length}</strong></div>
          <div class="row between"><span>Descuentos</span><strong>${fmt(desc)}</strong></div>
          <div class="row between" style="font-size:18px; color:var(--primary);"><span><strong>Total cobrado</strong></span><strong>${fmt(total)}</strong></div>
        </div>
        <div class="card">
          <label>Productos más vendidos</label>
          ${ranking.map(([p, c]) => `<div class="row between"><span>${p}</span><strong>${c}</strong></div>`).join('')}
        </div>`;
    } catch (e) { cont.innerHTML = 'Sin conexión'; }
  }

  // ===== Gastos =====
  function initGastos() {
    $('#gastoFecha').value = hoy();
    $('#gastoConcepto').value = '';
    $('#gastoMonto').value = '';
    $('#gastoNota').value = '';
    cargarGastos();
  }
  async function cargarGastos() {
    const cont = $('#listaGastos');
    try {
      const r = await api({ accion: 'gastos' });
      const g = r.gastos || [];
      cont.innerHTML = g.length
        ? g.slice(-20).reverse().map(x =>
            `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border);">
              <div><div>${x.concepto}</div><div class="muted small">${x.fecha}${x.nota ? ' · ' + x.nota : ''}</div></div>
              <strong>${fmt(x.monto)}</strong>
            </div>`).join('')
        : '<p class="muted small">Sin gastos registrados</p>';
    } catch (e) { cont.innerHTML = '<p class="muted small">Sin conexión</p>'; }
  }
  async function guardarGasto() {
    const payload = {
      accion: 'gasto',
      fecha: $('#gastoFecha').value || hoy(),
      concepto: $('#gastoConcepto').value.trim(),
      monto: Number($('#gastoMonto').value) || 0,
      nota: $('#gastoNota').value.trim(),
      _id: 'g_' + Date.now()
    };
    if (!payload.concepto || payload.monto <= 0) { toast('Falta concepto o monto', 'error'); return; }
    let ok = false;
    if (navigator.onLine && state.backendUrl) {
      try { const r = await api(null, payload); ok = r.ok; } catch (e) {}
    }
    if (!ok) { state.pendientes.push(payload); guardarLS('pendientes', state.pendientes); setEstadoSync(); }
    toast(ok ? '✓ Gasto guardado' : '✓ Pendiente sync', 'ok');
    initGastos();
  }

  // ===== Eventos =====
  function bind() {
    $('#btnBack').addEventListener('click', atras);
    $$('[data-go]').forEach(b => b.addEventListener('click', () => ir(b.dataset.go)));

    const h = new Date().getHours();
    $('#saludo').textContent = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    $('#fechaHoy').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

    // Venta
    $('#fechaVenta').addEventListener('change', e => state.venta.fecha = e.target.value || hoy());
    $('#btnElegirModelorama').addEventListener('click', abrirSelectorModelorama);
    $('#buscaModelorama').addEventListener('input', e => renderListaModeloramas(e.target.value));
    $('#listaModeloramas').addEventListener('click', e => {
      const it = e.target.closest('.prod-pick-item'); if (!it) return;
      const m = state.modeloramas.find(x => String(x.numero) === it.dataset.num);
      if (m) elegirModelorama(m);
    });
    $('#btnUsarNuevoMod').addEventListener('click', usarNuevoModelorama);
    $('#btnAbrirProductos').addEventListener('click', abrirSelectorProductos);
    $('#btnCarritoIcon').addEventListener('click', abrirSelectorProductos);
    $('#buscaProd').addEventListener('input', e => renderPickerProductos(e.target.value));
    $('#listaProductos').addEventListener('click', e => {
      const it = e.target.closest('.prod-pick-item'); if (!it) return;
      agregarProducto(Number(it.dataset.fila));
    });
    $('#carritoBody').addEventListener('change', e => {
      if (e.target.matches('input')) {
        const fila = Number(e.target.closest('tr').dataset.fila);
        actualizarItem(fila, e.target.dataset.k, e.target.value);
      }
    });
    $('#carritoBody').addEventListener('click', e => {
      const b = e.target.closest('[data-quitar]'); if (b) quitarItem(Number(b.dataset.quitar));
    });

    $('#btnAceptarCant').addEventListener('click', aceptarCantidad);
    $('#inpCantidad').addEventListener('keydown', e => { if (e.key === 'Enter') aceptarCantidad(); });
    $('#btnDescuento').addEventListener('click', abrirDescuento);
    $('#btnAplicarDesc').addEventListener('click', aplicarDescuento);
    $('#btnImprimir').addEventListener('click', imprimirTicket);
    $('#btnGuardar').addEventListener('click', guardarVenta);
    $('#btnImprimirBT').addEventListener('click', imprimirBluetooth);
    $('#btnImprimirHoja').addEventListener('click', imprimirHoja);

    // Edicion de cantidades dentro del ticket
    $('#ticketCarritoBody').addEventListener('change', e => {
      if (e.target.matches('input')) {
        const fila = Number(e.target.closest('tr').dataset.fila);
        actualizarItem(fila, e.target.dataset.k, e.target.value);
        refrescarTicketPreview();
      }
    });
    $('#ticketCarritoBody').addEventListener('click', e => {
      const b = e.target.closest('[data-quitar]');
      if (b) {
        quitarItem(Number(b.dataset.quitar));
        refrescarTicketPreview();
      }
    });

    $$('[data-cerrar-modal]').forEach(b => b.addEventListener('click', () => {
      b.closest('.modal').hidden = true;
    }));

    // Inventario
    $('#btnGuardarInv').addEventListener('click', guardarInventarioInicial);

    // Historial
    $('#fechaHist').addEventListener('change', e => mostrarHistorial(e.target.value));

    // Config / Conexión
    $('#cfgUrl').value = state.backendUrl;
    $('#btnGuardarCfg').addEventListener('click', () => {
      const u = $('#cfgUrl').value.trim();
      state.backendUrl = u; localStorage.setItem('backendUrl', u);
      toast('✓ URL guardada', 'ok');
    });
    $('#btnProbar').addEventListener('click', async () => {
      try {
        const r = await api({ accion: 'ping' });
        $('#cfgEstado').textContent = r.ok ? '✓ Conexión correcta · ' + r.ts : '✗ Error: ' + (r.error || '');
      } catch (e) { $('#cfgEstado').textContent = '✗ Sin conexión: ' + e.message; }
    });
    $('#btnRecargar').addEventListener('click', async () => {
      try { const ok = await cargarCatalogosRemoto(); toast(ok ? '✓ Catálogos actualizados' : '✗ Error', ok ? 'ok' : 'error'); }
      catch (e) { toast('✗ ' + e.message, 'error'); }
    });
    $('#btnSync').addEventListener('click', sincronizar);

    // Productos config
    $('#btnAgregarProd').addEventListener('click', agregarProducto2);
    $('#listaProductosConfig').addEventListener('change', e => {
      if (e.target.matches('input')) {
        const fila = Number(e.target.closest('.prod-cfg-row').dataset.fila);
        actualizarProducto(fila, e.target.dataset.k, e.target.value);
      }
    });
    $('#listaProductosConfig').addEventListener('click', e => {
      const b = e.target.closest('[data-borrar]'); if (b) borrarProducto(Number(b.dataset.borrar));
    });

    // Reimpresión
    $('#fechaReimp').addEventListener('change', e => mostrarTicketsReimp(e.target.value));

    // Informes
    $('#btnGenerarInforme').addEventListener('click', generarInforme);

    // Gastos
    $('#btnGuardarGasto').addEventListener('click', guardarGasto);

    // Online/offline
    window.addEventListener('online', () => { setEstadoSync(); sincronizar(); });
    window.addEventListener('offline', setEstadoSync);
  }

  function init() {
    bind();
    setEstadoSync();
    const ci = $('#catInfo');
    if (ci) ci.textContent = `${state.productos.length} productos · ${state.modeloramas.length} modeloramas`;
    ir('home', false);
    setTimeout(sincronizar, 1000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', init);
})();
