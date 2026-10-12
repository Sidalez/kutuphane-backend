const test=require('node:test');
test('Firestore enforces device revocation, account isolation and server-owned session registry',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
 const {doc,setDoc,getDoc,updateDoc}=require('firebase/firestore');
 const env=await initializeTestEnvironment({projectId:'demo-kutuphane',firestore:{rules:require('node:fs').readFileSync('firestore.rules','utf8')}});
 try{
 await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await setDoc(doc(db,'users','u'),{deviceSessions:{a:{revokedAt:null},b:{revokedAt:null}}});await setDoc(doc(db,'users','v'),{deviceSessions:{v:{revokedAt:null}}});await setDoc(doc(db,'books','book'),{userId:'u',title:'Kitap'});});
 const a=env.authenticatedContext('u',{sessionId:'a'}).firestore(),b=env.authenticatedContext('u',{sessionId:'b'}).firestore(),other=env.authenticatedContext('v',{sessionId:'v'}).firestore();
 await assertSucceeds(getDoc(doc(a,'books','book')));await assertFails(getDoc(doc(other,'books','book')));await assertFails(updateDoc(doc(a,'users','u'),{'deviceSessions.a.revokedAt':null}));
 await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'users','u'),{'deviceSessions.a.revokedAt':Date.now()}));
 await assertFails(getDoc(doc(a,'books','book')));await assertFails(updateDoc(doc(a,'books','book'),{title:'Forbidden'}));await assertFails(getDoc(doc(a,'users','u')));await assertSucceeds(getDoc(doc(b,'books','book')));
 await assertFails(getDoc(doc(env.authenticatedContext('u').firestore(),'books','book')));
 }finally{await env.cleanup()}
});
