import {importStatement,projection} from './investment-model.mjs';
import {interactiveChart as chart,dashboard} from './investment-dashboard.mjs';
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value===null || value===undefined?'No disponible':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const decimal=value=>{const s=String(value).trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))throw new Error('Usa valores válidos con hasta dos decimales.');return Number(s);};
export class InvestmentPage {
  constructor(container,notify) {
    this.container=container;this.notify=notify;this.uid=null;this.snapshots=[];this.projected=null;
    container.addEventListener('change',e=>{if(e.target.matches('[data-invest-file]'))this.importFile(e.target);});
    container.addEventListener('submit',e=>{if(e.target.matches('[data-invest-projection]')){e.preventDefault();this.calculate(e.target);}});
    container.addEventListener('click',e=>{if(e.target.closest('[data-invest-clear]'))this.clear();});
    const inspect=e=>{const target=e.target.closest('[data-chart-info]');if(!target)return;const shell=target.closest('.inv-chart-shell');shell.querySelector('.inv-chart-readout').textContent=target.dataset.chartInfo;shell.querySelectorAll('.inv-chart-target').forEach(node=>node.classList.toggle('is-active',node===target));};
    ['pointerover','pointerdown','focusin','click'].forEach(event=>container.addEventListener(event,inspect));
  }
  setUser(uid) {
    this.uid=uid;this.snapshots=[];this.projected=null;this.error='';
    if(uid)try{const data=JSON.parse(localStorage.getItem(this.key()) || '[]');if(!Array.isArray(data))throw new Error();this.snapshots=data;}catch{this.error='No se pudo leer el historial local. No se ha modificado.';}
    this.render();
  }
  key(){return `gastos-investments-v1:${this.uid}`;}
  async importFile(input) {
    const file=input.files?.[0],uid=this.uid;if(!file || !uid)return;
    try {
      if(file.size>5*1024*1024)throw new Error('El archivo supera el límite de 5 MB.');
      const snapshot=importStatement(await file.text());
      if(this.uid!==uid)return;
      if(this.error)throw new Error('No se puede guardar hasta resolver el error del historial local.');
      const updated=[...this.snapshots.filter(s=>s.date!==snapshot.date),snapshot].sort((a,b)=>a.date.localeCompare(b.date));
      if(updated.length>100)throw new Error('El historial admite hasta 100 fechas.');
      localStorage.setItem(this.key(),JSON.stringify(updated));this.snapshots=updated;
      this.notify('Extracto importado. La fecha repetida se actualiza sin duplicarse.');this.render();
    }catch(error){if(this.uid===uid){this.container.querySelector('[data-invest-error]').textContent=error.message;}}
    finally{input.value='';}
  }
  calculate(form) {
    try {
      const data=Object.fromEntries(new FormData(form));
      const initial=decimal(data.initial),monthly=decimal(data.monthly),rate=decimal(data.rate),years=Number(data.years);
      this.projected={initial,monthly,rate,years,points:projection(initial,monthly,rate,years)};this.render();
    }catch(error){this.container.querySelector('[data-projection-error]').textContent=error.message;}
  }
  clear(){if(!this.uid || !confirm('¿Eliminar todo el historial de inversiones guardado en este navegador? Esta acción no afecta a Interactive Brokers.'))return;try{localStorage.removeItem(this.key());this.snapshots=[];this.error='';this.render();}catch(error){this.container.querySelector('[data-invest-error]').textContent='No se pudo eliminar el historial local.';}}
  render() {
    if(!this.uid){this.container.innerHTML='';return;}
    const latest=this.snapshots.at(-1),p=this.projected,defaults=p || {initial:latest?latest.value.toFixed(2):0,monthly:0,rate:7,years:10};
    const history=new Map();this.snapshots.forEach(s=>{(s.history || []).forEach(point=>history.set(point.date,point));history.set(s.date,{date:s.date,value:s.value});});
    const points=[...history.values()].sort((a,b)=>a.date.localeCompare(b.date));
    this.container.innerHTML=`<div class="eyebrow">TU PATRIMONIO</div><h2>Mis inversiones</h2>
      ${latest?dashboard(latest):''}
      <p class="inv-help">Importa un informe de actividad en español o un informe detallado mensual de PortfolioAnalyst en CSV. Los importes corresponden a la fecha del informe, no a precios en tiempo real.</p>
      <section class="inv-panel"><h3>Importar extracto</h3><p class="inv-help">El archivo se lee en este dispositivo. No se muestra ni se guarda tu nombre, número de cuenta o el CSV original. Solo se guarda el resumen financiero en este navegador, separado por usuario; no se sincroniza ni es una copia de seguridad. Cualquier persona con acceso a este navegador podría ver esos datos.</p>
      <label class="inv-upload">Seleccionar CSV <input type="file" accept=".csv,text/csv" data-invest-file></label><p class="inv-error" role="alert" data-invest-error>${escape(this.error || '')}</p>${this.snapshots.length?'<button type="button" class="secondary" data-invest-clear>Eliminar historial de este navegador</button>':''}</section>
      ${latest?`<section class="inv-panel"><h3>Resumen al ${escape(latest.date)}</h3><div class="inv-stats"><article><small>VALOR TOTAL</small><strong>${money(latest.value)}</strong></article><article><small>EFECTIVO</small><strong>${money(latest.cash)}</strong></article><article><small>RENDIMIENTO DEL PERÍODO · IBKR</small><strong>${latest.rate===null?'No disponible':escape(latest.rate.toFixed(2))+' %'}</strong></article><article><small>DEPÓSITOS MENOS RETIROS · PERÍODO</small><strong>${money(latest.netDeposits)}</strong></article><article><small>COMISIONES · PERÍODO</small><strong>${money(latest.commissions)}</strong></article></div><p class="inv-help">El rendimiento ponderado por tiempo es el informado por IBKR para el período del extracto; no equivale a restar los depósitos del valor actual. Las subvenciones del período son ${money(latest.grant)}.</p></section>
      <section class="inv-panel"><h3>Posiciones abiertas</h3><div class="inv-table"><table><thead><tr><th>Símbolo</th><th>Cantidad</th><th>Precio</th><th>Valor</th><th>Resultado no realizado</th></tr></thead><tbody>${latest.positions.map(pos=>`<tr><td>${escape(pos.symbol)}</td><td>${escape(pos.quantity)}</td><td>${money(pos.price)}</td><td>${money(pos.value)}</td><td>${money(pos.profit)}</td></tr>`).join('') || '<tr><td colspan="5">El extracto no contiene posiciones abiertas.</td></tr>'}</tbody></table></div></section>
      <section class="inv-panel"><h3>Evolución del valor total</h3><p class="inv-help">Valores de cierre extraídos de los informes. Los puntos mensuales corresponden al fin de mes, salvo el último mes parcial, que usa la fecha de cierre del informe. Las líneas no representan datos diarios. Los depósitos y retiros también cambian el valor.</p>${chart(points,[{key:'value',label:'Valor total (USD)'}])}${points.length<2?'<p class="inv-help">Importa otro informe con valores históricos para comparar la evolución.</p>':''}<div class="inv-table"><table><thead><tr><th>Fecha de cierre</th><th>Valor total</th></tr></thead><tbody>${points.map(s=>`<tr><td>${escape(s.date)}</td><td>${money(s.value)}</td></tr>`).join('')}</tbody></table></div></section>`:'<section class="inv-panel"><p>Todavía no has importado un extracto.</p></section>'}
      <section class="inv-panel"><h3>Simulador de interés compuesto</h3><p class="inv-help">Estimación hipotética con rendimiento anual constante y aportes al final de cada mes. No garantiza resultados y no descuenta impuestos, inflación ni comisiones.</p><form data-invest-projection class="inv-form"><label>Capital inicial (USD)<input name="initial" inputmode="decimal" value="${escape(defaults.initial)}" required></label><label>Aporte mensual (USD)<input name="monthly" inputmode="decimal" value="${escape(defaults.monthly)}" required></label><label>Rendimiento anual estimado (%)<input name="rate" inputmode="decimal" value="${escape(defaults.rate)}" required></label><label>Años<input name="years" type="number" min="1" max="50" step="1" value="${escape(defaults.years)}" required></label><button type="submit">Calcular proyección</button></form><p class="inv-error" role="alert" data-projection-error></p>${p?`<p>Valor proyectado: <strong>${money(p.points.at(-1).balance)}</strong> · Total aportado: <strong>${money(p.points.at(-1).contributed)}</strong></p>${chart(p.points,[{key:'balance',label:'Valor proyectado'},{key:'contributed',label:'Capital aportado'}])}<p class="inv-help">De hoy a ${p.years} años; es una proyección, no el rendimiento real de tu cuenta.</p>`:''}</section>`;
  }
}
