import * as M from './money-model.mjs';
const $=selector=>document.querySelector(selector);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const dateLabel=value=>new Intl.DateTimeFormat('es',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00'));
const monthLabel=value=>new Intl.DateTimeFormat('es',{month:'long',year:'numeric'}).format(new Date(value+'-01T12:00:00'));
const types={income:'Ingreso',opening:'Saldo inicial',variable:'Gasto variable',fixed:'Gasto fijo'};
const button=(action,label,id='',style='secondary')=>`<button type="button" class="${style}" data-money-action="${action}" data-id="${escape(id)}">${label}</button>`;
const field=(label,name,type,value='',extra='')=>`<label class="md-field">${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;

export class MoneyPage {
  constructor(container,notify) {
    this.container=container;this.notify=notify;this.month=M.monthKey();this.scope='month';this.type='all';this.store=null;this.saving=false;
    document.addEventListener('click',event=>{
      const target=event.target.closest('[data-money-action]');
      if(target)this.action(target.dataset.moneyAction,target.dataset.id).catch(error=>this.error(error));
    });
    this.container.addEventListener('change',event=>{
      const {id,value}=event.target;
      if(id==='md-month' && M.validMonth(value))this.month=value;
      if(id==='md-scope')this.scope=value;
      if(id==='md-type')this.type=value;
      this.render();
    });
    $('#money-cancel').onclick=()=>$('#money-dialog').close();
    $('#money-form').onsubmit=async event=>{
      event.preventDefault();if(!this.submit || this.saving)return;
      this.setSaving(true);
      try {await this.submit(Object.fromEntries(new FormData(event.target)));$('#money-dialog').close();this.notify('Guardado. Tu saldo está actualizado.');}
      catch(error){this.error(error);}
      finally{this.setSaving(false);}
    };
    $('#money-fields').addEventListener('change',event=>this.categoryChange(event.target));
  }
  setStore(store) {this.store=store;this.month=M.monthKey();this.scope='month';this.type='all';this.submit=null;$('#money-dialog').close();this.render();}
  setSaving(value) {this.saving=value;$('#money-save').disabled=value;$('#money-save').textContent=value?'Guardando…':'Guardar';}
  error(error) {if($('#money-dialog').open)$('#money-error').textContent=error.message;else this.notify(error.message);}
  categoryLabel(m) {return m.type==='fixed'?m.category || 'Gasto fijo':m.type==='opening'?'Saldo anterior':this.store.state.categories.find(c=>c.id===m.categoryId)?.name || 'Sin categoría';}
  render() {
    if(!this.store?.ready){this.container.innerHTML=`<p class="muted">${escape(this.store?.error || 'Cargando Mi Dinero…')}</p>`;return;}
    const state=this.store.state, summary=M.summary(state,this.month), opening=state.movements.find(m=>m.type==='opening');
    const rows=M.ledger(state).filter(m=>(this.scope==='all' || m.date.slice(0,7)===this.month) && (this.type==='all' || m.type===this.type)).reverse();
    const limits=state.budgets[this.month] || {};
    const spent={};state.movements.filter(m=>m.type==='variable' && m.date.slice(0,7)===this.month).forEach(m=>spent[m.categoryId]=(spent[m.categoryId] || 0)+m.amount);
    const categories=state.categories.filter(c=>limits[c.id] || spent[c.id]);
    this.container.innerHTML=`
      <div class="md-heading"><div><div class="eyebrow">CONTROL DE DINERO</div><h2>Mi Dinero</h2><p class="muted">Tus ingresos, tus gastos diarios y lo que te queda.</p></div><div class="md-actions">${button('income','＋ Ingreso','','')}${button('expense','＋ Gasto')}</div></div>
      <section class="md-balance"><div><small>DINERO DISPONIBLE</small><strong id="md-balance">${money(M.balance(state))}</strong><p>Saldo real acumulado. Continúa de un mes a otro.</p></div><div>${button('opening',opening?'Editar saldo inicial':'＋ Saldo inicial','','secondary')}<p class="md-help">${opening?'Registrado: '+money(opening.amount):'Registra el dinero que ya tienes una sola vez.'}</p></div></section>
      <section class="md-panel"><div class="md-heading"><h3>Resumen · ${escape(monthLabel(this.month))}</h3><label class="md-month">Mes <input id="md-month" type="month" min="1900-01" value="${this.month}"></label></div>
      <div class="md-stats">${[['Ingresos del mes',summary.income,'md-positive'],['Gastos fijos pagados',summary.fixed,''],['Gastos variables',summary.variable,''],['Gastado este mes',summary.spent,'md-negative']].map(([label,value,style])=>`<article><small>${label}</small><strong class="${style}">${money(value)}</strong></article>`).join('')}</div>
      <div class="md-month-results"><span>Ahorro / restante generado <b class="${summary.net<0?'md-negative':'md-positive'}">${money(summary.net)}</b></span><span>Saldo anterior <b>${money(summary.previous)}</b></span><span>Saldo al cierre del mes <b>${money(summary.closing)}</b></span></div><p class="md-help">El cierre incluye los movimientos registrados hasta ese mes. El saldo inicial no cuenta como ingreso. Este resumen es informativo y no reinicia el dinero disponible.</p></section>
      <section class="md-panel"><div class="md-heading"><div><h3>Presupuesto por categorías</h3><p class="md-help">${escape(monthLabel(this.month))} · Límites opcionales para gastos variables</p></div><div class="md-actions">${button('budget','＋ Límite mensual')}${button('categories','Categorías')}</div></div>
      <div class="md-budgets">${categories.map(c=>{
        const used=spent[c.id] || 0, limit=limits[c.id] || 0, ratio=limit?used/limit:0;
        return `<article class="md-budget ${ratio>=1?'md-over':ratio>=.8?'md-warning':''}"><div class="md-heading"><b>${escape(c.name)}</b>${button('budget','Editar',c.id,'secondary md-small')}</div><div>${money(used)} <span class="muted">/ ${limit?money(limit):'sin límite'}</span></div>${limit?`<progress value="${Math.min(used,limit)}" max="${limit}" aria-label="Presupuesto de ${escape(c.name)}"></progress><p class="md-budget-status">${ratio>1?'Límite superado por '+money(used-limit):ratio===1?'Límite alcanzado':ratio>=.8?'Cerca del límite · '+Math.round(ratio*100)+'% utilizado':money(limit-used)+' disponibles'}</p>`:'<p class="md-help">Puedes establecer un límite mensual.</p>'}</article>`;
      }).join('') || '<p class="md-empty">Registra un gasto o agrega un límite mensual para empezar.</p>'}</div></section>
      <section class="md-panel"><div class="md-heading"><div><h3>Movimientos</h3><p class="md-help">Más recientes primero. Cada saldo incluye el historial anterior completo.</p></div><div class="md-filters"><select id="md-scope" aria-label="Período de movimientos"><option value="month" ${this.scope==='month'?'selected':''}>Mes seleccionado</option><option value="all" ${this.scope==='all'?'selected':''}>Todo el historial</option></select><select id="md-type" aria-label="Tipo de movimiento"><option value="all">Todos los movimientos</option>${Object.entries(types).map(([value,label])=>`<option value="${value}" ${this.type===value?'selected':''}>${label}</option>`).join('')}</select></div></div>
      <div class="md-table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Tipo</th><th>Valor</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>${rows.map(m=>`<tr><td>${dateLabel(m.date)}</td><td class="md-concept">${escape(m.description)}${m.type==='fixed'?`<p class="md-help">Cuota: ${escape(monthLabel(m.period))}${m.estimatedDate?' · Fecha estimada del pago previo':''}</p>`:''}</td><td>${escape(this.categoryLabel(m))}</td><td class="${M.sign(m)>0?'md-positive':'md-negative'}">${types[m.type]}</td><td class="md-amount ${M.sign(m)>0?'md-positive':'md-negative'}">${M.sign(m)>0?'+':'−'}${money(m.amount)}</td><td class="md-amount">${money(m.balance)}</td><td><div class="md-row-actions">${button('edit-movement','Editar',m.id,'secondary md-small')}${button('delete-movement','Eliminar',m.id,'danger md-small')}</div></td></tr>`).join('') || '<tr><td colspan="7" class="md-empty">No hay movimientos en este período.</td></tr>'}</tbody></table></div></section>`;
  }
  dialog(title,content,submit) {$('#money-dialog-title').textContent=title;$('#money-fields').innerHTML=content;$('#money-error').textContent='';this.submit=submit;this.setSaving(false);$('#money-save').hidden=!submit;if(!$('#money-dialog').open)$('#money-dialog').showModal();}
  options(selected,optional=false) {return `${optional?'<option value="">Sin categoría</option>':''}${this.store.state.categories.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${escape(c.name)}</option>`).join('')}<option value="__new">＋ Agregar categoría…</option>`;}
  categoryField(selected,optional=false) {return `<label class="md-field">Categoría${optional?' (opcional)':''}<select name="categoryId" data-money-category ${optional?'data-optional':''}>${this.options(selected,optional)}</select></label>`;}
  async categoryChange(select) {
    if(!select.matches('[data-money-category]'))return;
    if(select.value==='__new') {
      const name=prompt('Nombre de la nueva categoría:');
      try {
        const id=name===null?'':await this.store.category(null,name);
        // La transacción ya guardó la categoría; espera al estado sincronizado.
        if(id && !this.store.state.categories.some(c=>c.id===id)) {
          select.insertAdjacentHTML('afterbegin',`<option value="${id}">${escape(name.trim())}</option>`);
          select.value=id;
        } else select.innerHTML=this.options(id,select.hasAttribute('data-optional'));
      } catch(error){select.selectedIndex=0;this.error(error);}
    }
    const limit=$('#money-fields [name=limit]');
    if(limit)limit.value=(this.store.state.budgets[this.month]?.[select.value] || 0)/100;
  }
  movementForm(type,id) {
    const store=this.store,item=store.state.movements.find(m=>m.id===id);
    if(id && !item)throw new Error('El movimiento ya no existe.');
    type=item?.type || type;
    const opening=type==='opening',fixed=type==='fixed';
    const title=item?'Editar movimiento':opening?'Saldo inicial':type==='income'?'Agregar ingreso':'Agregar gasto';
    const note=opening?'Registra una sola vez el dinero que tenías al empezar. No se contará como ingreso del mes.':type==='variable'?'Este gasto se descontará inmediatamente de tu dinero disponible.':type==='income'?'Este ingreso se sumará al saldo disponible.':'El pago mantiene su cuota mensual. Puedes corregir su descripción, fecha y valor.';
    this.dialog(title,`<p class="muted">${note}</p>`+field('Descripción / concepto','description','text',item?.description || (opening?'Saldo inicial':''),'required maxlength="160"')+field('Valor (USD)','amount','number',item?item.amount/100:'','required min="0.01" max="1000000000" step="0.01"')+field('Fecha','date','date',item?.date || M.today(),`required min="1900-01-01" max="${M.today()}"`)+(fixed?`<p class="md-help">Cuota: ${escape(monthLabel(item.period))}</p>`:opening?'':this.categoryField(item?.categoryId,type==='income')),data=>store.saveMovement({...data,type,amount:M.cents(data.amount)},item?.id));
  }
  budgetForm(id) {
    const store=this.store,month=this.month,category=id || store.state.categories[0]?.id;
    this.dialog('Límite mensual',`<p class="muted">${escape(monthLabel(month))}. Introduce 0 para quitar el límite.</p>${this.categoryField(category)}${field('Límite mensual (USD)','limit','number',(store.state.budgets[month]?.[category] || 0)/100,'required min="0" max="1000000000" step="0.01"')}`,data=>store.budget(month,data.categoryId,M.cents(data.limit)));
  }
  categories() {this.dialog('Categorías',`<p class="muted">Puedes agregar o renombrar categorías. Sus movimientos y presupuestos conservarán la relación.</p>${this.store.state.categories.map(c=>`<div class="md-category-row"><span>${escape(c.name)}</span>${button('rename-category','Renombrar',c.id,'secondary md-small')}</div>`).join('')}<div class="md-actions">${button('new-category','＋ Agregar categoría','','')}</div>`,null);}
  async action(action,id) {
    if(!this.store?.ready)throw new Error('Espera a que se cargue Mi Dinero.');
    if(action==='income')this.movementForm('income');
    if(action==='expense')this.movementForm('variable');
    if(action==='opening')this.movementForm('opening',this.store.state.movements.find(m=>m.type==='opening')?.id);
    if(action==='edit-movement')this.movementForm(null,id);
    if(action==='delete-movement' && confirm('¿Eliminar este movimiento? Se recalculará el saldo. Si es un pago mensual, la cuota volverá a estar pendiente si el gasto todavía existe.')){await this.store.deleteMovement(id);this.notify('Movimiento eliminado y saldo recalculado.');}
    if(action==='budget')this.budgetForm(id);
    if(action==='categories')this.categories();
    if(action==='new-category' || action==='rename-category') {
      const previous=this.store.state.categories.find(c=>c.id===id)?.name || '';
      const name=prompt(action==='new-category'?'Nombre de la nueva categoría:':'Nuevo nombre:',previous);
      if(name!==null){await this.store.category(action==='new-category'?null:id,name);this.categories();}
    }
  }
}
