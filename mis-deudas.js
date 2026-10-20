import * as D from './debt-model.mjs';
import * as M from './money-model.mjs';

const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const dateLabel=value=>new Intl.DateTimeFormat('es',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00'));
const field=(label,name,type,value,extra='')=>`<label class="debt-field">${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const button=(action,label,id='',extra='')=>`<button type="button" class="secondary" data-debt-action="${action}" data-id="${escape(id)}" ${extra}>${label}</button>`;

export class DebtPage {
  constructor(container,notify) {
    this.container=container;this.notify=notify;this.month=M.monthKey();this.busy=false;
    this.dialog=document.createElement('dialog');this.dialog.className='debt-dialog';
    this.dialog.setAttribute('aria-labelledby','debt-dialog-title');document.body.append(this.dialog);
    container.addEventListener('click',event=>{
      const target=event.target.closest('[data-debt-action]');
      if(target)this.action(target.dataset.debtAction,target.dataset.id).catch(error=>this.notify(error.message));
    });
    container.addEventListener('change',event=>{if(event.target.id==='debt-month' && M.validMonth(event.target.value)){this.month=event.target.value;this.render();}});
    this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});
  }
  setStore(store) {this.store=store;this.month=M.monthKey();this.dialog.close();this.render();}
  render() {
    const store=this.store;
    if(!store?.ready || !store.money.ready) {
      this.container.innerHTML=`<p class="muted">${escape(store?.error || store?.money.error || 'Cargando Mis deudas…')}</p>`;return;
    }
    const state=store.state || D.initialDebts(),account=store.money.state,initialized=!!store.state;
    const total=state.debts.reduce((sum,d)=>sum+D.remaining(account,d),0),capital=state.debts.reduce((sum,d)=>sum+D.paidPrincipal(account,d.id),0);
    const all=account.movements.filter(m=>state.debts.some(d=>d.id===m.debtId));
    const paidMonth=all.filter(m=>m.date.slice(0,7)===this.month).reduce((sum,m)=>sum+m.amount,0);
    const commitment=state.debts.reduce((sum,d)=>D.remaining(account,d)>0?sum+D.schedule(account,d,`${this.month}-01`).filter(row=>row.period===this.month).reduce((s,row)=>s+row.pending,0):sum,0);
    this.container.innerHTML=`
      <div class="eyebrow">SALIR DE LAS DEUDAS</div><h2>Mis deudas</h2>
      <p class="muted">Cuatro deudas, un objetivo: pagarlas sin volver a endeudarte.</p>
      ${!initialized?`<section class="debt-task"><strong>Registra tus cuatro deudas iniciales</strong><p class="debt-help">Revisa los importes de abajo. Guardarlos no descontará dinero de tus cuentas ni cambiará tu historial actual.</p>${button('initialize','Guardar mis 4 deudas')}</section>`:''}
      <label class="debt-month">Mes del resumen <input id="debt-month" type="month" value="${this.month}" required></label>
      <section class="debt-summary" aria-label="Resumen de deudas">
        <article><small>DEUDA PENDIENTE</small><strong>${money(total)}</strong></article>
        <article><small>CAPITAL PAGADO</small><strong>${money(capital)}</strong></article>
        <article><small>PAGADO EN EL MES</small><strong>${money(paidMonth)}</strong></article>
        <article><small>CUOTAS / MÍNIMO PENDIENTES DEL MES</small><strong>${money(commitment)}</strong></article>
      </section>
      <p class="debt-help">Los vencimientos se marcan por su mes de cuota. El dinero pagado se muestra por la fecha real del pago. Los abonos libres a tu suegra no se incluyen en las obligaciones del mes.</p>
      ${state.debts.some(d=>d.deferPending)?`<section class="debt-task"><strong>☐ Tarea pendiente: diferir deuda de JEP</strong><p class="debt-help">Mientras no esté diferida, registra el mínimo mensual de $58.31. Diferir no se considera un pago; introduce las condiciones que te confirme JEP.</p>${button('configure','Ya hice el diferido: registrar condiciones','',initialized?'':'disabled')}</section>`:''}
      <section class="debt-grid">${state.debts.map(debt=>this.card(debt,account,initialized)).join('')}</section>
      <section class="debt-panel"><h3>Historial de pagos</h3><p class="debt-help">Todos los pagos de deudas, incluidos los de otros meses. Si eliminas un pago aquí o en Mi Dinero, se restituye el saldo de la cuenta y se recalcula la deuda.</p>
      <div class="debt-table-wrap"><table><thead><tr><th>Fecha</th><th>Deuda</th><th>Mes de cuota</th><th>Cuenta</th><th>Total</th><th>Capital</th><th>Intereses / cargos</th><th>Acción</th></tr></thead><tbody>
      ${[...all].sort((a,b)=>b.date.localeCompare(a.date)||b.order-a.order).map(m=>`<tr><td>${dateLabel(m.date)}</td><td>${escape(state.debts.find(d=>d.id===m.debtId)?.name)}</td><td>${escape(m.debtPeriod || 'Abono libre')}</td><td>${escape(M.accountName(account,m.accountId))}</td><td>${money(m.amount)}</td><td>${money(D.principal(m))}</td><td>${money(m.debtInterest || 0)}</td><td>${button('undo','Eliminar pago',m.id)}</td></tr>`).join('') || '<tr><td colspan="8">Todavía no hay pagos registrados.</td></tr>'}
      </tbody></table></div></section>`;
  }
  card(debt,account,initialized) {
    const remaining=D.remaining(account,debt),rows=D.schedule(account,debt),next=remaining>0?rows.find(row=>row.pending>0):null;
    const completed=rows.filter(row=>!row.pending).length,percent=Math.min(100,Math.max(0,D.paidPrincipal(account,debt.id)/debt.openingAmount*100));
    return `<article class="debt-card"><h3>${escape(debt.name)}</h3><span class="debt-amount">${money(remaining)}</span><span class="debt-help">Saldo pendiente</span><progress max="100" value="${percent}" aria-label="Progreso de pago de ${escape(debt.name)}"></progress>
      <dl><dt>Capital pagado</dt><dd>${money(D.paidPrincipal(account,debt.id))}</dd>
      ${debt.kind==='flexible'?'<dt>Modalidad</dt><dd>Abonos libres</dd><dt>Vencimiento</dt><dd>Sin fecha obligatoria</dd>':`<dt>${debt.kind==='minimum'?'Mínimo actual':'Cuota mensual'}</dt><dd>${money(debt.installment)}</dd>${debt.kind==='installments'?`<dt>Cuotas cubiertas</dt><dd>${completed} de ${debt.count}</dd>`:''}<dt>Primer vencimiento</dt><dd>${dateLabel(debt.firstDue)}</dd><dt>Fecha de pago</dt><dd>${debt.dueDay===31?'Fin de cada mes':`Día ${debt.dueDay}`}</dd>${debt.cutDay?`<dt>Corte</dt><dd>Día ${debt.cutDay}${debt.cutUnconfirmed?' · por confirmar':''}</dd>`:''}`}</dl>
      ${remaining<=0?'<p class="debt-paid">✓ Deuda pagada</p>':next?`<p class="${next.date<M.today()?'debt-late':'debt-help'}">${next.date<M.today()?'Cuota / mínimo pendiente':'Próximo pago'}: ${dateLabel(next.date)} · ${money(Math.min(next.pending,remaining))}</p>`:debt.kind==='flexible'?'<p class="debt-help">Paga el importe que puedas, cuando decidas.</p>':'<p class="debt-help">Calendario cubierto; revisa el saldo restante con la entidad.</p>'}
      ${debt.kind==='minimum'?'<p class="debt-help">El mínimo puede cambiar. Comprueba en tu estado de cuenta cuánto reduce capital y cuánto corresponde a intereses o cargos.</p>':''}
      <div class="debt-actions">${button('pay','Registrar pago',debt.id,!initialized || remaining<=0?'disabled':'')}</div>
      ${rows.length?`<details><summary>Ver calendario de ${debt.kind==='minimum'?'mínimos':'cuotas'}</summary><div class="debt-table-wrap"><table><thead><tr><th>N.º</th><th>Vence</th><th>Pagado</th><th>Pendiente</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.index}</td><td>${dateLabel(row.date)}</td><td>${money(row.paid)}</td><td class="${!row.pending?'debt-paid':row.date<M.today()?'debt-late':''}">${!row.pending?'✓ Cubierta':money(row.pending)}</td></tr>`).join('')}</tbody></table></div>${debt.kind==='minimum'?'<p class="debt-help">Proyección del mínimo actual, no es un diferido ni una estimación de la fecha de cancelación.</p>':''}</details>`:''}
    </article>`;
  }
  open(title,content,submit) {
    const store=this.store;
    this.dialog.innerHTML=`<form><h2 id="debt-dialog-title">${escape(title)}</h2>${content}<p class="debt-error" role="alert"></p><div class="debt-actions"><button type="submit">Guardar</button><button type="button" class="secondary" data-cancel>Cancelar</button></div></form>`;
    this.dialog.querySelector('[data-cancel]').onclick=()=>{if(!this.busy)this.dialog.close();};
    this.dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(this.busy || this.store!==store)return;this.busy=true;
      this.dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
      try {await submit(Object.fromEntries(new FormData(event.target)));if(this.store===store){this.dialog.close();this.notify('Guardado. Tus datos están actualizados.');this.render();}}
      catch(error){this.dialog.querySelector('[role=alert]').textContent=error.message;}
      finally {this.busy=false;this.dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };
    this.dialog.showModal();
  }
  async action(action,id) {
    const store=this.store;if(!store?.ready || !store.money.ready)return;
    if(action==='initialize') {
      if(this.busy)return;this.busy=true;
      try{await store.initialize();this.notify('Deudas guardadas. Tus cuentas no han cambiado.');}finally{this.busy=false;}
    }
    if(action==='undo') {
      if(confirm('¿Eliminar este pago? El dinero volverá a la cuenta de origen y la deuda volverá a quedar pendiente.'))await store.undo(id);
    }
    if(action==='pay') {
      const debt=store.state.debts.find(d=>d.id===id),state=store.money.state;
      if(!M.accountsActive(state))throw new Error('Configura primero tus cuentas en Mi Dinero. No se ha registrado ningún pago.');
      const accounts=state.accounts.filter(a=>!a.needsOpeningBalance),next=D.schedule(state,debt).find(row=>row.pending>0);
      const amount=debt.kind==='flexible'?'':Math.min(next?.pending || debt.installment,D.remaining(state,debt))/100;
      this.open(`Registrar pago · ${debt.name}`,`<p>Registra solo pagos que ya hayas realizado. Se descontará una sola vez de la cuenta elegida. Para corregir un pago, elimínalo y vuelve a registrarlo.</p>`+
        field('Total pagado (USD)','amount','number',amount,'required min="0.01" max="1000000000" step="0.01"')+
        field('Intereses / cargos incluidos en ese total (USD)','interest','number',0,'required min="0" max="1000000000" step="0.01"')+
        '<p>El resto se aplicará a capital. Si todo el pago reduce tu deuda, deja los intereses en 0.</p>'+
        (debt.kind==='minimum'?'<label class="debt-field"><span><input type="checkbox" required> He comprobado el capital y los intereses en el estado de cuenta de JEP.</span></label>':'')+
        field('Fecha real del pago','date','date',M.today(),`required min="${state.accountsActivatedAt}" max="${M.today()}"`)+
        (debt.kind==='flexible'?'':field('Mes de la cuota / mínimo que estás pagando','period','month',next?.period || this.month,`required min="${debt.firstDue.slice(0,7)}" ${debt.kind==='installments'?`max="${D.dueDate(debt,debt.count-1).slice(0,7)}"`:''}`))+
        `<label class="debt-field">Cuenta de origen<select name="accountId" required>${accounts.map(a=>`<option value="${escape(a.id)}" ${a.id===state.lastAccountId?'selected':''}>${escape(a.name)} · ${money(M.accountBalance(state,a.id))}</option>`).join('')}</select></label>`,
        data=>store.pay(id,{...data,amount:M.cents(data.amount),interest:M.cents(data.interest)}));
    }
    if(action==='configure') {
      const debt=store.state.debts.find(d=>d.id==='jep-card');
      this.open('Registrar diferido de JEP','<p>Completa las condiciones confirmadas por JEP. Se conserva el historial anterior. Esto no descuenta dinero ni registra un pago.</p>'+
        field('Saldo pendiente confirmado, incluyendo cargos financiados (USD)','balance','number',D.remaining(store.money.state,debt)/100,'required min="0.01" max="1000000000" step="0.01"')+
        field('Valor de la cuota mensual (USD)','installment','number','','required min="0.01" max="1000000000" step="0.01"')+
        field('Número de cuotas','count','number','','required min="1" max="600" step="1"')+
        field('Vencimiento de la primera cuota','firstDue','date','2026-11-04','required')+
        '<p>La cuota puede incluir intereses futuros: no se restará íntegra del capital salvo que así lo confirme JEP. El saldo confirmado sustituye únicamente el saldo pendiente de esta deuda.</p>',
        data=>store.configure({...data,balance:M.cents(data.balance),installment:M.cents(data.installment),count:Number(data.count)}));
    }
  }
}
