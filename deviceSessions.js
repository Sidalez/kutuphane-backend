const {randomBytes,createHash}=require('node:crypto');
const fail=(status,message)=>Object.assign(new Error(message),{status});
function createDeviceSessionService({db,auth,readBody,json}){
 const enabled=process.env.SECURE_SESSIONS_REQUIRED==='true';
 async function verify(req,register=false){
  if(!db||!auth)throw fail(503,'Güvenli oturum sunucusu yapılandırılmamış.');
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];if(!token)throw fail(401,'Giriş yapmalısın.');
  let decoded;try{decoded=await auth.verifyIdToken(token,true)}catch{throw fail(401,'Oturumun geçersiz. Tekrar giriş yap.');}
  if(decoded.sessionId){const snapshot=await db.collection('users').doc(decoded.uid).get();const session=snapshot.data()?.deviceSessions?.[decoded.sessionId];if(!session||session.revokedAt)throw fail(401,'Bu cihazın oturumu kapatıldı.');}
  else if(enabled&&!register)throw fail(401,'Güvenli oturum için tekrar giriş yap.');
  if(register&&!decoded.sessionId&&Date.now()/1000-decoded.auth_time>300)throw fail(401,'Cihaz kaydı için tekrar giriş yap.');
  return decoded;
 }
 async function handle(req,res,path){
  if(!path.startsWith('/api/sessions'))return false;
  try{
   if(path==='/api/sessions/config'&&req.method==='GET'){json(res,200,{enabled,ready:Boolean(db&&auth)});return true;}
   const decoded=await verify(req,path==='/api/sessions/register'),uid=decoded.uid,ref=db.collection('users').doc(uid);
   if(path==='/api/sessions/register'&&req.method==='POST'){
    if(!enabled)throw fail(409,'Güvenli oturum geçişi henüz etkinleştirilmedi.');
    const body=await readBody(req);let id=decoded.sessionId||randomBytes(24).toString('hex');const now=Date.now();const deviceKey=typeof body.deviceKey==='string'&&/^[A-Za-z0-9-]{16,80}$/.test(body.deviceKey)?createHash('sha256').update(body.deviceKey).digest('hex'):null;
    if(!decoded.sessionId)await db.runTransaction(async tx=>{const snap=await tx.get(ref);const sessions=snap.data()?.deviceSessions||{};const existing=deviceKey&&Object.values(sessions).find(item=>item.deviceKey===deviceKey&&!item.revokedAt);if(existing){id=existing.id;return;}if(Object.values(sessions).filter(item=>!item.revokedAt).length>=50)throw fail(409,'Açık cihaz sınırına ulaştın. Önce eski oturumları kapat.');tx.set(ref,{deviceSessions:{[id]:{id,deviceKey,device:String(body.device||'Cihaz').slice(0,60),browser:String(body.browser||'Tarayıcı').slice(0,40),createdAt:now,lastActiveAt:now,revokedAt:null}}},{merge:true});});
    const token=await auth.createCustomToken(uid,{sessionId:id});json(res,200,{id,token});return true;
   }
   if(!decoded.sessionId)throw fail(401,'Güvenli cihaz oturumu gerekli.');
   if(path==='/api/sessions/heartbeat'&&req.method==='POST'){await ref.update({[`deviceSessions.${decoded.sessionId}.lastActiveAt`]:Date.now()});json(res,200,{success:true});return true;}
   if(path==='/api/sessions/revoke'&&req.method==='POST'){
    const body=await readBody(req);if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>50||body.ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(id)))throw fail(400,'Geçersiz cihaz seçimi.');
    await db.runTransaction(async tx=>{const snap=await tx.get(ref),sessions=snap.data()?.deviceSessions||{},patch={};for(const id of body.ids)if(sessions[id])patch[`deviceSessions.${id}.revokedAt`]=Date.now();if(Object.keys(patch).length)tx.update(ref,patch);});json(res,200,{success:true});return true;
   }
   throw fail(404,'Oturum işlemi bulunamadı.');
  }catch(error){json(res,error.status||500,{message:error.status?error.message:'Oturum işlemi tamamlanamadı.'});return true;}
 }
 return {verify,handle,enabled};
}
module.exports={createDeviceSessionService};
