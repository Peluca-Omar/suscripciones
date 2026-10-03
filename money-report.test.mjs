import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,readState,saveMovement,balance} from './money-model.mjs';
import {monthlyReport,reportCSV,reportHTML} from './money-report.mjs';

function accounts() {
  const state=initialState();
  saveMovement(state,{type:'opening',description:'Capital',date:'2024-12-01',amount:100000});
  saveMovement(state,{type:'income',description:'Salario',date:'2025-01-01',amount:200000});
  saveMovement(state,{type:'fixed',description:'Alquiler',date:'2025-01-02',amount:30000,subscriptionId:'rent',period:'2025-01'});
  saveMovement(state,{type:'variable',description:'Comida',date:'2025-01-03',amount:20000,categoryId:'category-0'});
  saveMovement(state,{type:'income',description:'Ingreso posterior',date:'2025-02-01',amount:40000});
  return state;
}

test('el informe histórico excluye movimientos posteriores y concilia el cierre',()=>{
  const report=monthlyReport(accounts(),'2025-01','Cuenta','2025-03-01');
  assert.equal(report.previous,100000);
  assert.equal(report.income,200000);
  assert.equal(report.spent,50000);
  assert.equal(report.net,150000);
  assert.equal(report.closing,250000);
  assert.equal(report.closing,report.previous+report.opening+report.net);
  assert.equal(report.count,3);
  assert.equal(report.cutoff,'2025-01-31');
  assert.equal(report.status,'Histórico');
  assert.notEqual(report.closing,balance(accounts()));
});

test('el capital inicial en el mes se muestra aparte y nunca infla los ingresos',()=>{
  const state=accounts();state.movements.find(m=>m.type==='opening').date='2025-01-01';
  const report=monthlyReport(state,'2025-01','Cuenta','2025-01-20');
  assert.equal(report.previous,0);
  assert.equal(report.opening,100000);
  assert.equal(report.income,200000);
  assert.equal(report.closing,report.previous+report.opening+report.net);
  assert.equal(report.status,'Provisional');
  assert.equal(report.cutoff,'2025-01-20');
  assert.match(reportHTML(report,'money-report.css'),/Saldo inicial registrado en el mes/);
});

test('un mes vacío conserva el saldo anterior, y un mes futuro no declara un cierre definitivo',()=>{
  const report=monthlyReport(accounts(),'2025-04','Cuenta','2025-03-01');
  assert.equal(report.count,0);
  assert.equal(report.income,0);
  assert.equal(report.spent,0);
  assert.equal(report.previous,290000);
  assert.equal(report.closing,290000);
  assert.equal(report.status,'Mes futuro');
  assert.equal(report.cutoff,'');
  assert.match(reportHTML(report,'money-report.css'),/No hay movimientos registrados/);
  assert.match(reportHTML(report,'money-report.css'),/todavía no existe un cierre mensual/);
});

test('CSV estable con importes numéricos, negativos, decimales y ceros',()=>{
  const state=accounts();state.movements.find(m=>m.type==='income').amount=1234;
  const csv=reportCSV(monthlyReport(state,'2025-01','','2025-03-01'));
  assert.equal(csv.charCodeAt(0),0xfeff);
  const parse=line=>line.split(',').map(value=>value.replace(/^"|"$/g,''));
  const [headers,values]=csv.slice(1).trim().split('\r\n').map(parse);
  assert.equal(headers.length,15);assert.equal(values.length,15);
  const data=Object.fromEntries(headers.map((key,i)=>[key,values[i]]));
  assert.equal(data.mes,'2025-01');assert.equal(data.moneda,'USD');
  assert.equal(data.ingresos,'12.34');assert.equal(data.resultado_del_mes,'-487.66');
  assert.equal(data.saldo_inicial_del_mes,'0.00');assert.equal(data.saldo_al_cierre,'512.34');
  assert.equal(headers.join(','),parse(reportCSV(monthlyReport(state,'2025-04')).slice(1).split('\r\n')[0]).join(','));
});

test('se conserva el histórico presupuestario al leer el estado guardado',()=>{
  const state=accounts();state.budgets={'2025-01':{'category-0':25000},'2025-02':{'category-0':30000}};
  const restored=readState(JSON.parse(JSON.stringify(state)));
  restored.budgets['2025-02']['category-0']=35000;
  assert.equal(restored.budgets['2025-01']['category-0'],25000);
  assert.equal(state.budgets['2025-02']['category-0'],30000);
  assert.equal(restored.budgets['2025-03'],undefined);
});

test('el informe escapa el titular y rechaza meses inválidos; el corte respeta años bisiestos',()=>{
  const html=reportHTML(monthlyReport(accounts(),'2024-02','<script>alert(1)</script>','2025-03-01'),'money-report.css');
  assert.ok(!html.includes('<script>'));
  assert.match(html,/&lt;script&gt;/);
  assert.equal(monthlyReport(accounts(),'2024-02','','2025-03-01').cutoff,'2024-02-29');
  assert.throws(()=>monthlyReport(accounts(),'2025-13'),/mes válido/);
});
