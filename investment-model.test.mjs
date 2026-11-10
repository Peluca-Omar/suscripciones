import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,importStatement,projection} from './investment-model.mjs';

const csv=`Statement,Header,Nombre del campo,Valor del campo
Statement,Data,Title,Informe de actividad
Statement,Data,Period,"Enero 1, 2026 - Noviembre 9, 2026"
Información sobre la cuenta,Data,Nombre,PERSONA PRIVADA
Información sobre la cuenta,Data,Cuenta,NUMERO PRIVADO
Información sobre la cuenta,Data,Divisa base,USD
Valor liquidativo,Data,Efectivo,0,0.5,0,0.5,0.5
Valor liquidativo,Data,Total,0,100.5,0,100.5,100.5
Valor liquidativo,Header,Tasa de rendimiento ponderada por tiempo
Valor liquidativo,Data,-10.12%
Cambio en NAV,Data,Depósitos y retiradas,110
Cambio en NAV,Data,Comisiones,-1
Posiciones abiertas,Header,DataDiscriminator,Categoría de activo,Divisa,Símbolo,Abierto,Cantidad,Mult.,Precio de coste,Base de coste,Precio de cierre,Valor,PyG no realizadas,Código
Posiciones abiertas,Data,Summary,Acciones,USD,TEST,-,0.5,1,220,110,200,100,-10,
Posiciones abiertas,Data,Lot,Acciones,USD,TEST,-,0.5,1,220,110,200,100,-10,
`;
test('importa solo campos permitidos y no guarda identidad ni duplica lotes',()=>{
  const s=importStatement(csv);
  assert.equal(s.date,'2026-11-09');assert.equal(s.value,100.5);assert.equal(s.cash,0.5);assert.equal(s.rate,-10.12);
  assert.equal(s.netDeposits,110);assert.equal(s.positions.length,1);assert.equal(s.positions[0].profit,-10);
  assert.doesNotMatch(JSON.stringify(s),/PERSONA PRIVADA|NUMERO PRIVADO/);
});
test('acepta comillas y filas con columnas vacías; rechaza CSV dañado',()=>{
  assert.deepEqual(parseCSV('a,"b,b","c""d",\r\n'),[['a','b,b','c"d','']]);
  assert.throws(()=>parseCSV('a,"sin cerrar'),/comilla/);
  assert.throws(()=>importStatement(csv.replace('Divisa base,USD','Divisa base,EUR')),/USD/);
  assert.throws(()=>importStatement(csv.replace('100.5,100.5','incorrecto,100.5')),/valor total/);
});
test('calcula proyección con aportes al final del mes y valida límites',()=>{
  const points=projection(100,10,0,2);assert.equal(points.at(-1).balance,340);assert.equal(points.at(-1).contributed,340);
  assert.ok(projection(100,0,12,1).at(-1).balance>111.99);
  assert.throws(()=>projection(1,2,3,51));assert.throws(()=>projection(1,-1,3,5));
});
test('PortfolioAnalyst importa valores mensuales sin identidad ni secciones ajenas',()=>{
  const report=`Introduction,Header,Name,Account,Alias,BaseCurrency
Introduction,Data,PRIVATE_NAME,PRIVATE_ACCOUNT,PRIVATE_ALIAS,USD
Key Statistics,MetaInfo,Analysis Period,"September 22, 2026 - November 9, 2026"
Key Statistics,Header,EndingNAV,CumulativeReturn,Deposits & Withdrawals,Fees & Commissions
Key Statistics,Data,90,-10,100,-1
Open Position Summary,Header,Date,FinancialInstrument,Currency,Symbol,Quantity,ClosePrice,Value,UnrealizedP&L
Open Position Summary,Data,11/09/2026,Stocks,USD,TEST,1,80,80,-10
Open Position Summary,Data,11/09/2026,Cash,USD,USD,10,1,10, 
Allocation by Asset Class,Header,Date,Equities,Cash,NAV
Allocation by Asset Class,Data,202609,50,50,100
Allocation by Asset Class,Data,202610,85,10,95
Allocation by Asset Class,Data,202611,80,10,90
Notes and Disclosure,Data,General,"Una nota con "comillas" sin escapar"
`;
  const result=importStatement(report);
  assert.deepEqual(result.history,[{date:'2026-09-30',value:100},{date:'2026-10-31',value:95},{date:'2026-11-09',value:90}]);
  assert.equal(result.cash,10);assert.equal(result.positions.length,1);assert.equal(result.rate,-10);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  assert.throws(()=>importStatement(report.replace('PRIVATE_ALIAS,USD','PRIVATE_ALIAS,EUR')),/USD/);
  assert.throws(()=>importStatement(report.replace('202611,80,10,90','202611,80,10,91')),/no coincide/);
});
