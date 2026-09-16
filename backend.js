// Firebase en la aplicación publicada; almacenamiento aislado para la prueba local.
export const isLocalPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const sdk = isLocalPreview
  ? await import('./preview-backend.js')
  : Object.assign({}, ...await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]));
export const {
  initializeApp, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
  addDoc, collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot,
  orderBy, query, updateDoc, runTransaction,
} = sdk;
