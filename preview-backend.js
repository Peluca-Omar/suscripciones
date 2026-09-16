// Adaptador local para probar los mismos flujos sin escribir en Firebase.
const KEY = 'gastos-nueva-version-preview-v1';
const listeners = new Set(), authListeners = new Set();
const user = { uid:'preview', displayName:'Prueba local', email:'Datos de ejemplo', photoURL:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38"><rect width="38" height="38" fill="#1c2540"/><text x="19" y="26" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#9df3bf">L</text></svg>') };
let activeUser = sessionStorage.getItem('gastos-preview-signed-out') ? null : user;
function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  const result = {};
  const rows = [
    ['OpenCode Go',10,17,'Trabajo','⌘'], ['Gimnasio',20,29,'Salud','✦'],
    ['iCloud',3,16,'Almacenamiento','I'], ['Gmail',1,2,'Almacenamiento','G'],
    ['ABACUS IA',20,4,'Trabajo','A'], ['ChatGPT Plus',20,1,'Trabajo','C'],
  ];
  rows.forEach(([name,price,day,category,icon],i) => {
    const path=`users/preview/subscriptions/demo-${i}`;
    result[path]={name,price,day,category,icon,color:'#8bb8ff',paidMonth:null,createdAt:new Date().toISOString()};
    result[path+'/priceHistory/initial']={price,changedAt:new Date().toISOString()};
  });
  localStorage.setItem(KEY,JSON.stringify(result));
  return result;
}
const reference=(base,parts,kind)=>({path:[base?.path,...parts].filter(Boolean).join('/'),kind});
export const initializeApp=()=>({});
export const getFirestore=()=>({});
export const getAuth=()=>({});
export class GoogleAuthProvider {}
export function onAuthStateChanged(auth,callback) { authListeners.add(callback); queueMicrotask(()=>callback(activeUser)); return ()=>authListeners.delete(callback); }
export async function signInWithPopup() { activeUser=user;sessionStorage.removeItem('gastos-preview-signed-out');authListeners.forEach(fn=>fn(user));return {user}; }
export async function signOut() { activeUser=null;sessionStorage.setItem('gastos-preview-signed-out','1');authListeners.forEach(fn=>fn(null)); }
export const doc=(base,...parts)=>reference(base,parts,'doc');
export const collection=(base,...parts)=>reference(base,parts,'collection');
export const orderBy=(field,direction)=>({field,direction});
export const query=(ref,sort)=>({...ref,sort});
function documentSnapshot(path,data) { return {id:path.split('/').pop(),exists:()=>data!==undefined,data:()=>data===undefined?undefined:structuredClone(data)}; }
function snapshot(ref,data) {
  if (ref.kind==='doc') return documentSnapshot(ref.path,data[ref.path]);
  let docs=Object.entries(data).filter(([path])=>path.startsWith(ref.path+'/') && path.split('/').length===ref.path.split('/').length+1).map(([path,value])=>documentSnapshot(path,value));
  if(ref.sort) docs.sort((a,b)=>String(a.data()[ref.sort.field]).localeCompare(String(b.data()[ref.sort.field]))*(ref.sort.direction==='desc'?-1:1));
  return {docs,empty:!docs.length};
}
function emit() { for(const listener of listeners){try{listener.callback(snapshot(listener.ref,load()));}catch(error){listener.error?.(error);}} }
export function onSnapshot(ref,callback,error) { const listener={ref,callback,error};listeners.add(listener);queueMicrotask(()=>{if(listeners.has(listener)){try{callback(snapshot(ref,load()));}catch(e){error?.(e);}}});return ()=>listeners.delete(listener); }
export async function getDocs(ref) {return snapshot(ref,load());}
export async function runTransaction(db,callback) {
  return navigator.locks.request(KEY,async()=>{
    const draft=structuredClone(load());let changed=false;
    const tx={
      get:async ref=>snapshot(ref,draft),
      set:(ref,data)=>{draft[ref.path]=structuredClone(data);changed=true;},
      update:(ref,data)=>{if(!draft[ref.path])throw new Error('El gasto ya no existe.');Object.assign(draft[ref.path],structuredClone(data));changed=true;},
      delete:ref=>{delete draft[ref.path];changed=true;},
    };
    const result=await callback(tx);
    if(changed){localStorage.setItem(KEY,JSON.stringify(draft));queueMicrotask(emit);}
    return result;
  });
}
export async function addDoc(ref,data) {const created=doc(ref,crypto.randomUUID());await runTransaction(null,tx=>tx.set(created,data));return created;}
export const updateDoc=(ref,data)=>runTransaction(null,tx=>tx.update(ref,data));
export const deleteDoc=ref=>runTransaction(null,tx=>tx.delete(ref));
window.addEventListener('storage',event=>{if(event.key===KEY)emit();});
