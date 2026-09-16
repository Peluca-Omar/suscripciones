import {doc,onSnapshot,runTransaction} from './backend.js';
import * as M from './money-model.mjs';

export class MoneyStore {
  constructor(db,uid) {
    this.db=db;
    this.uid=uid;
    this.ref=doc(db,'users',uid,'money','state');
    this.state=M.initialState();
    this.ready=false;
    this.active=true;
    this.error='';
  }
  subscription(id) {return doc(this.db,'users',this.uid,'subscriptions',id);}
  accept(state) {
    if(!this.active || state.revision<this.state.revision)return;
    this.state=state;this.ready=true;this.error='';this.onChange?.();
  }
  start(onChange,onError) {
    this.onChange=onChange;
    this.unsubscribe=onSnapshot(this.ref,snapshot=>{
      if(!this.active)return;
      try {this.accept(M.readState(snapshot.data()));}
      catch(error){this.ready=false;this.error=error.message;onError(error);}
    },error=>{if(this.active){this.ready=false;this.error=error.message;onError(error);}});
  }
  stop() {this.active=false;this.unsubscribe?.();}
  async change(callback) {
    if(!this.active)throw new Error('Inicia sesión nuevamente.');
    // El pago y su movimiento se confirman juntos; no queda un saldo a medias.
    const outcome=await runTransaction(this.db,async tx=>{
      const snapshot=await tx.get(this.ref), state=M.readState(snapshot.data());
      const result=await callback(tx,state);
      if(!result?.unchanged){state.revision++;tx.set(this.ref,state);}
      return {state,value:result?.value};
    });
    this.accept(outcome.state);
    return outcome.value;
  }
  isPaid(item,period) {
    return !!M.payment(this.state,item.id,period) || (!this.state.legacy[M.legacyKey(item)] && item.paidMonth===period);
  }
  paidTotal(period) {return this.state.movements.filter(m=>m.type==='fixed' && m.period===period).reduce((sum,m)=>sum+m.amount,0);}
  async importExistingPayments(items) {
    const candidates=items.filter(item=>M.validMonth(item.paidMonth) && !this.state.legacy[M.legacyKey(item)]);
    if(!candidates.length || !this.active)return;
    await this.change(async(tx,state)=>{
      const snapshots=await Promise.all(candidates.map(item=>tx.get(this.subscription(item.id))));
      let changed=false;
      snapshots.forEach((snapshot,i)=>{if(snapshot.exists())changed=M.importLegacyPayment(state,{...snapshot.data(),id:candidates[i].id}) || changed;});
      return {unchanged:!changed};
    });
  }
  async setPaid(id,paid) {
    await this.change(async(tx,state)=>{
      const ref=this.subscription(id), snapshot=await tx.get(ref);
      if(!snapshot.exists())throw new Error('El gasto ya no existe.');
      const item={...snapshot.data(),id};
      M.importLegacyPayment(state,item);
      const period=M.monthKey(), existing=M.payment(state,id,period);
      if(paid) {
        if(!existing)M.saveMovement(state,{type:'fixed',description:item.name,amount:M.cents(item.price),date:M.today(),period,subscriptionId:id,category:item.category});
        state.legacy[`${id}:${period}`]=true;
        tx.update(ref,{paidMonth:period,paidAt:new Date().toISOString()});
      } else {
        if(existing)M.deleteMovement(state,existing.id);
        state.legacy[`${id}:${period}`]=true;
        if(item.paidMonth===period)tx.update(ref,{paidMonth:null,paidAt:null});
      }
    });
  }
  async deleteExpense(id) {
    await this.change(async(tx,state)=>{
      const ref=this.subscription(id), snapshot=await tx.get(ref);
      if(!snapshot.exists())throw new Error('El gasto ya no existe.');
      M.importLegacyPayment(state,{...snapshot.data(),id});
      tx.delete(ref);
      // Los pagos son independientes del documento eliminado.
    });
  }
  async saveMovement(data,id) {
    await this.change(async(tx,state)=>{
      const existing=id?state.movements.find(m=>m.id===id):null;
      let ref,snapshot;
      if(existing?.type==='fixed'){ref=this.subscription(existing.subscriptionId);snapshot=await tx.get(ref);}
      const result=M.saveMovement(state,data,id);
      if(ref && snapshot.exists() && snapshot.data().paidMonth===result.period)tx.update(ref,{paidAt:result.date+'T12:00:00.000Z'});
    });
  }
  async deleteMovement(id) {
    await this.change(async(tx,state)=>{
      const existing=state.movements.find(m=>m.id===id);
      if(!existing)throw new Error('El movimiento ya no existe.');
      let ref,snapshot;
      if(existing.type==='fixed'){ref=this.subscription(existing.subscriptionId);snapshot=await tx.get(ref);}
      M.deleteMovement(state,id);
      if(ref){
        state.legacy[`${existing.subscriptionId}:${existing.period}`]=true;
        if(snapshot.exists() && snapshot.data().paidMonth===existing.period)tx.update(ref,{paidMonth:null,paidAt:null});
      }
    });
  }
  async category(id,name) {return this.change((tx,state)=>({value:M.renameCategory(state,id,name)}));}
  async budget(month,id,limit) {
    if(!M.validMonth(month) || !Number.isSafeInteger(limit) || limit<0)throw new Error('Revisa el mes y el límite.');
    await this.change((tx,state)=>{
      if(!state.categories.some(c=>c.id===id))throw new Error('Selecciona una categoría válida.');
      state.budgets[month] ||= {};
      if(limit)state.budgets[month][id]=limit;
      else delete state.budgets[month][id];
    });
  }
}
