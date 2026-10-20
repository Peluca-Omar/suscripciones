import {doc,onSnapshot,runTransaction} from './backend.js';
import * as D from './debt-model.mjs';
import {readState} from './money-model.mjs';

export class DebtStore {
  constructor(moneyStore) {
    this.money=moneyStore;this.ref=doc(moneyStore.db,'users',moneyStore.uid,'money','debts');
    this.ready=false;this.active=true;this.state=null;this.error='';
  }
  start(onChange) {
    this.onChange=onChange;
    this.unsubscribe=onSnapshot(this.ref,snapshot=>{
      if(!this.active)return;
      try {this.state=D.readDebts(snapshot.data());this.ready=true;this.error='';}
      catch(error){this.ready=false;this.error=error.message;}
      onChange();
    },error=>{if(this.active){this.ready=false;this.error=error.message;onChange();}});
  }
  stop() {this.active=false;this.unsubscribe?.();}
  async initialize() {
    if(!this.active)throw new Error('Inicia sesión nuevamente.');
    await runTransaction(this.money.db,async tx=>{
      const snapshot=await tx.get(this.ref);
      if(snapshot.exists()){D.readDebts(snapshot.data());return;}
      tx.set(this.ref,D.initialDebts());
    });
  }
  async pay(id,data) {
    if(!this.active)throw new Error('Inicia sesión nuevamente.');
    await this.money.change(async(tx,money)=>{
      const state=D.readDebts((await tx.get(this.ref)).data());
      const debt=state?.debts.find(d=>d.id===id);
      if(!debt)throw new Error('Primero registra tus deudas iniciales.');
      D.registerPayment(money,debt,data);
    });
  }
  async undo(id) {
    if(!this.active)throw new Error('Inicia sesión nuevamente.');
    // La eliminación existente devuelve el dinero a su cuenta y el saldo de la
    // deuda se recalcula desde el mismo historial, sin un segundo registro.
    const movement=this.money.state.movements.find(m=>m.id===id && m.debtId);
    if(!movement)throw new Error('El pago ya no existe.');
    await this.money.deleteMovement(id);
  }
  async configure(data) {
    if(!this.active)throw new Error('Inicia sesión nuevamente.');
    // Solo cambia el documento de deudas; no reescribe Mi Dinero.
    await runTransaction(this.money.db,async tx=>{
      const debtSnapshot=await tx.get(this.ref),moneySnapshot=await tx.get(this.money.ref);
      const state=D.readDebts(debtSnapshot.data());
      if(!state)throw new Error('Primero registra tus deudas iniciales.');
      D.configureJep(state,readState(moneySnapshot.data()),data);
      state.revision++;tx.set(this.ref,state);
    });
  }
}
