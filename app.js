// =============================================================================
//  Cross du collège — socle commun à toutes les pages
//  Stockage (Firebase Realtime Database ou mode local), file de synchro,
//  moteur de calcul des tours, import Excel, export Excel.
// =============================================================================
import CONFIG from './config.js';

export const VERSION = '1.0';
const FIREBASE_V = '12.19.0';

// ---------------------------------------------------------------- utilitaires
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
export function fmtHeure(ms){ if(ms==null) return ''; const d=new Date(ms);
  return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
export function fmtDuree(ms){ if(ms==null||!isFinite(ms)) return ''; const s=Math.round(ms/1000);
  const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60;
  return h ? h+' h '+pad(m)+' min' : m+' min '+pad(x)+' s'; }
export function fmtChrono(ms){ if(ms==null||ms<0) return '0:00'; const s=Math.floor(ms/1000);
  const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60;
  return h ? h+':'+pad(m)+':'+pad(x) : m+':'+pad(x); }
export const fr1 = n => (Math.round(n*10)/10).toLocaleString('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1});
export function uid(){ if(crypto.randomUUID) return crypto.randomUUID().replace(/-/g,'');
  return Date.now().toString(36)+Math.random().toString(36).slice(2,12); }
export const safeKey = s => String(s||'').trim().replace(/[.#$\[\]\/]/g,'-').slice(0,40);
const LS = {
  get(k,def){ try{ const v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
export { LS };

// ---------------------------------------------------------------- clé d'événement
export function eventKey(){
  const u=new URLSearchParams(location.search).get('cle');
  if(u){ LS.set('cross.cle', u.trim()); return u.trim(); }
  return LS.get('cross.cle','') || '';
}
export function setEventKey(k){ LS.set('cross.cle', String(k||'').trim()); }
export const firebaseConfigured = () =>
  !!(CONFIG.firebase && CONFIG.firebase.apiKey && CONFIG.firebase.databaseURL);

// Ouvre le stockage. Renvoie null si une clé est nécessaire et absente
// (la page affiche alors la fenêtre de saisie).
export async function openStore(){
  if(!firebaseConfigured()) return localStore(eventKey() || 'local');
  const key=eventKey();
  if(!key) return null;
  return fbStore(key);
}

// ---------------------------------------------------------------- Firebase
async function fbStore(key){
  const base='https://www.gstatic.com/firebasejs/'+FIREBASE_V+'/';
  const A=await import(base+'firebase-app.js');
  const D=await import(base+'firebase-database.js');
  const app=A.initializeApp(CONFIG.firebase);
  const db=D.getDatabase(app);
  const R=p=>D.ref(db,'events/'+key+(p?'/'+p:''));
  let offset=0, connected=false;
  const connCbs=[], errCbs=[];
  D.onValue(D.ref(db,'.info/serverTimeOffset'),s=>{ offset=s.val()||0; });
  D.onValue(D.ref(db,'.info/connected'),s=>{ connected=!!s.val(); connCbs.forEach(f=>f(connected)); });
  const onErr=e=>errCbs.forEach(f=>f(e));
  return {
    mode:'firebase', key,
    now:()=>Date.now()+offset,
    onConnected(cb){ connCbs.push(cb); cb(connected); },
    onError(cb){ errCbs.push(cb); },
    onValue(path,cb){ D.onValue(R(path),s=>cb(s.val()||{}),onErr); },
    onScanAdded(cb){ D.onChildAdded(R('scans'),s=>cb({...s.val(),id:s.key}),onErr); },
    update(obj){ return D.update(R(''),obj); },
    set(path,val){ return D.set(R(path),val); },
    remove(path){ return D.remove(R(path)); },
    get(path){ return D.get(R(path)).then(s=>s.val()); }
  };
}

// ---------------------------------------------------------------- mode local
// Même interface que Firebase, stockée dans le navigateur. Les onglets d'un
// même appareil se tiennent au courant entre eux ; rien ne sort de l'appareil.
function localStore(key){
  const P='cross.local.'+key+'/';
  const subs={}, addSubs=new Set(), known=new Set();
  const load=top=>LS.get(P+top,{})||{};
  const save=(top,obj)=>{ if(!LS.set(P+top,obj)) alert('Stockage local plein.'); };
  function emit(top){
    const v=load(top);
    (subs[top]||[]).forEach(cb=>cb(v));
    if(top==='scans') for(const id in v) if(!known.has(id)){ known.add(id); addSubs.forEach(cb=>cb({...v[id],id})); }
  }
  addEventListener('storage',e=>{ if(e.key&&e.key.startsWith(P)) emit(e.key.slice(P.length)); });
  function apply(path,val){
    const parts=path.split('/').filter(Boolean), top=parts.shift();
    let obj=load(top);
    if(!parts.length) obj=(val==null)?{}:val;
    else{
      let o=obj;
      for(let i=0;i<parts.length-1;i++){
        if(!o[parts[i]]||typeof o[parts[i]]!=='object') o[parts[i]]={};
        o=o[parts[i]];
      }
      if(val==null) delete o[parts[parts.length-1]]; else o[parts[parts.length-1]]=val;
    }
    save(top,obj); return top;
  }
  return {
    mode:'local', key,
    now:()=>Date.now(),
    onConnected(cb){ cb(true); },
    onError(){},
    onValue(top,cb){ (subs[top]=subs[top]||new Set()).add(cb); cb(load(top)); },
    onScanAdded(cb){ addSubs.add(cb); const v=load('scans'); for(const id in v){ known.add(id); cb({...v[id],id}); } },
    update(obj){ const t=new Set(); for(const p in obj) t.add(apply(p,obj[p])); t.forEach(emit); return Promise.resolve(); },
    set(path,val){ emit(apply(path,val)); return Promise.resolve(); },
    remove(path){ emit(apply(path,null)); return Promise.resolve(); },
    get(path){ const parts=path.split('/').filter(Boolean); let o=load(parts.shift());
      for(const p of parts){ o=o&&o[p]; } return Promise.resolve(o??null); }
  };
}

// ---------------------------------------------------------------- réglages
export const DEFAULT_CFG = {
  titre:'Cross du collège',
  absence:60,      // s : un nouveau tour n'est compté qu'après cette absence
  plafond:15,      // tours au-delà desquels on alerte
  boucle:0.8,      // km par tour
  delai:0,         // s : passages ignorés juste après le départ
  courant:'1',
  courses:{
    '1':{nom:'Course 1',niveaux:'6,5',debut:null,fin:null},
    '2':{nom:'Course 2',niveaux:'4,3',debut:null,fin:null}
  }
};
export function readCfg(raw){
  raw=raw||{};
  const c={...DEFAULT_CFG,...raw};
  c.courses={};
  for(const id of new Set([...Object.keys(DEFAULT_CFG.courses),...Object.keys(raw.courses||{})]))
    c.courses[id]={...(DEFAULT_CFG.courses[id]||{nom:'Course '+id,niveaux:''}),...((raw.courses||{})[id]||{})};
  for(const k of ['absence','plafond','boucle','delai']) c[k]=+c[k]||0;
  if(!c.absence) c.absence=60;
  if(!c.boucle) c.boucle=0.8;
  if(!c.plafond) c.plafond=15;
  return c;
}
export function niveauDe(classe){ const m=String(classe||'').match(/\d/); return m?m[0]:'?'; }
export function niveauxDe(course){ return String(course&&course.niveaux||'').split(/[\s,;]+/).filter(Boolean); }
export function courseDeClasse(cfg,classe){
  const n=niveauDe(classe);
  for(const id in cfg.courses) if(niveauxDe(cfg.courses[id]).includes(n)) return id;
  return null;
}
export const estAdulteNum = d => d>=901 && d<=950;
export const TYPES = {F:'Filles',G:'Garçons',M:'Mixte'};

// ---------------------------------------------------------------- moteur de calcul
// state = {participants, scans (objet id -> scan), corrections, config}
export function compute(state){
  const cfg=readCfg(state.config), P=state.participants||{}, C=state.corrections||{};
  const win={};
  for(const id in cfg.courses){ const c=cfg.courses[id];
    if(c.debut) win[id]={a:c.debut+cfg.delai*1000, b:c.fin||Infinity}; }
  const started=Object.keys(win);
  const coursesDe=d=>{
    const p=P[d];
    if(p&&!p.a){ const c=courseDeClasse(cfg,p.c); return c?[c]:[]; }
    if(p&&p.a&&p.cr){ const c=courseDeClasse(cfg,p.cr); return c?[c]:started; }
    return started;
  };
  const dans=(t,ids)=>ids.some(id=>win[id]&&t>=win[id].a&&t<=win[id].b);

  const par={};
  for(const s of Object.values(state.scans||{})){
    if(!s||s.d==null||!s.t) continue;
    (par[s.d]=par[s.d]||[]).push(s);
  }
  const ABS=cfg.absence*1000, R={}, compte=new Set();
  for(const d in par){
    const list=par[d].sort((a,b)=>a.t-b.t), ids=coursesDe(d);
    let dernier=-Infinity, first=null, last=null; const laps=[], hors=[];
    for(const s of list){
      if(!dans(s.t,ids)){ hors.push(s); continue; }
      if(first===null) first=s.t; last=s.t;
      if(s.t-dernier>ABS){ laps.push(s.t); compte.add(s.id); }
      dernier=s.t;
    }
    R[d]={laps,first,last,nScans:list.length,hors:hors.length};
  }
  const corr={};
  for(const k in C){ const c=C[k]; if(c&&c.d!=null) corr[c.d]=(corr[c.d]||0)+(+c.delta||0); }

  const lignes={};
  for(const d of new Set([...Object.keys(P),...Object.keys(R)])){
    const r=R[d]||{laps:[],first:null,last:null,nScans:0,hors:0}, p=P[d]||null;
    const iv=[]; for(let i=1;i<r.laps.length;i++) iv.push(r.laps[i]-r.laps[i-1]);
    const c=corr[d]||0;
    lignes[d]={ d:+d, p, ...r, iv, corr:c, tours:Math.max(0,r.laps.length+c),
      best:iv.length?Math.min(...iv):null,
      moy:iv.length?iv.reduce((a,b)=>a+b,0)/iv.length:null,
      span:(r.first!=null&&r.last!=null&&r.last>r.first)?r.last-r.first:null };
  }

  // classes : (tours élèves + tours adultes crédités) / élèves ayant au moins 1 tour
  const cls={};
  const classe=c=>cls[c]||(cls[c]={c,niv:niveauDe(c),course:courseDeClasse(cfg,c),
    inscrits:0,coureurs:0,te:0,ta:0,adultes:0});
  for(const d in lignes){
    const L=lignes[d], p=L.p; if(!p||p.st) continue;
    if(!p.a){ const o=classe(p.c); o.inscrits++; if(L.tours>0){ o.coureurs++; o.te+=L.tours; } }
    else if(p.cr){ const o=classe(p.cr); o.ta+=L.tours; if(L.tours>0) o.adultes++; }
  }
  const classes=Object.values(cls).map(o=>({...o,total:o.te+o.ta,
    moy:o.coureurs?(o.te+o.ta)/o.coureurs:0, km:(o.te+o.ta)*cfg.boucle}))
    .sort((a,b)=>b.moy-a.moy||b.total-a.total||a.c.localeCompare(b.c));

  // groupes : moyenne des tours des membres ayant au moins 1 tour
  const grp={};
  for(const d in lignes){
    const L=lignes[d], p=L.p; if(!p||p.a||!p.g) continue;
    const k=p.c+'|'+(p.ty||'')+'|'+p.g;
    (grp[k]=grp[k]||{c:p.c,g:p.g,tyDecl:p.ty||'',membres:[]}).membres.push(L);
  }
  const groupes=Object.values(grp).map(G=>{
    const sx=new Set(G.membres.map(m=>m.p.s).filter(Boolean));
    const ty=G.tyDecl||(sx.size===1?[...sx][0]:'M');
    const actifs=G.membres.filter(m=>!m.p.st);
    const pos=actifs.filter(m=>m.tours>0);
    return {...G,ty,niv:niveauDe(G.c),course:courseDeClasse(cfg,G.c),
      moy:pos.length?pos.reduce((a,m)=>a+m.tours,0)/pos.length:0,
      coureurs:pos.length,total:pos.reduce((a,m)=>a+m.tours,0)};
  }).sort((a,b)=>b.moy-a.moy||b.total-a.total);

  // contrôle
  const A={plafond:[],manquants:[],inconnus:[],adultesLibres:[],dispenses:[],zero:[],hors:0};
  for(const d in lignes){
    const L=lignes[d], p=L.p;
    if(L.tours>cfg.plafond-1&&L.tours>0) A.plafond.push(L);
    if(!p&&L.nScans&&!estAdulteNum(+d)) A.inconnus.push(L);
    if(!p&&L.nScans&&estAdulteNum(+d)) A.adultesLibres.push(L);
    if(p&&p.st&&L.laps.length) A.dispenses.push(L);
    if(p&&!p.a&&!p.st){ const cid=courseDeClasse(cfg,p.c); if(cid&&win[cid]&&L.tours===0) A.zero.push(L); }
    A.hors+=L.hors;
    if(L.laps.length>=5){
      const s=[...L.iv].sort((a,b)=>a-b), med=s[Math.floor(s.length/2)];
      L.iv.forEach((v,i)=>{
        if(v>1.7*med){
          const key='m_'+d+'_'+L.laps[i];
          if(!C[key]) A.manquants.push({key,L,de:L.laps[i],a:L.laps[i+1],v,med,k:Math.max(1,Math.round(v/med)-1)});
        }
      });
    }
  }
  A.plafond.sort((a,b)=>b.tours-a.tours);

  const totaux={passages:0};
  for(const d in lignes) totaux.passages+=lignes[d].tours;
  totaux.km=totaux.passages*cfg.boucle;
  return {cfg,lignes,classes,groupes,A,compte,totaux,win};
}

// ---------------------------------------------------------------- noms (restent sur l'appareil)
export const nomsKey = k => 'cross.noms.'+k;
export function getNoms(k){ return LS.get(nomsKey(k),{})||{}; }
export function setNoms(k,obj){ return LS.set(nomsKey(k),obj); }
export function nomDe(noms,L){
  const p=L.p;
  if(p&&p.a) return p.n||'Adulte '+L.d;
  const n=noms[L.d]; return n?((n.prenom||'')+' '+(n.nom||'')).trim():'';
}

// ---------------------------------------------------------------- import Excel
const norm = s => String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
function headerMap(row){
  const m={};
  row.forEach((v,i)=>{
    const h=norm(v).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    if(m.dossard==null&&/^(dossard|n|no|num|numero)( de dossard)?$/.test(h)) m.dossard=i;
    else if(m.nom==null&&/^nom( de famille)?$/.test(h)) m.nom=i;
    else if(m.prenom==null&&/^prenom/.test(h)) m.prenom=i;
    else if(m.classe==null&&/^classe/.test(h)) m.classe=i;
    else if(m.sexe==null&&/^(sexe|genre|f g|f m)$/.test(h)) m.sexe=i;
    else if(m.type==null&&/^type/.test(h)) m.type=i;
    else if(m.groupe==null&&/^(groupe|grp|equipe)/.test(h)) m.groupe=i;
  });
  return m;
}
export function normSexe(v){ const s=norm(v);
  if(/^(f|fille|feminin|femme)/.test(s)) return 'F';
  if(/^(g|m|h|garcon|masculin|homme)/.test(s)) return 'G';
  return ''; }
export function normType(v){ const s=norm(v);
  if(!s) return '';
  if(/^(mixte|mx|m$)/.test(s)) return 'M';
  if(/^(f|fille)/.test(s)) return 'F';
  if(/^(g|garcon)/.test(s)) return 'G';
  return ''; }
export function normGroupe(v){ const s=norm(v).replace(/groupe|grp|equipe/g,'').replace(/\s+/g,'').toUpperCase();
  if(!s) return '';
  if(/^\d+$/.test(s)) return 'G'+(+s);
  return s.replace(/[.#$\[\]\/]/g,'-'); }

export function parseWorkbook(wb){
  const rows=[], notes=[];
  for(const sn of wb.SheetNames){
    const data=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});
    let h=-1, map=null;
    for(let i=0;i<Math.min(data.length,15);i++){
      const m=headerMap(data[i]||[]);
      if(m.classe!=null&&(m.nom!=null||m.dossard!=null)){ h=i; map=m; break; }
    }
    if(h<0) continue;
    let n=0;
    for(let i=h+1;i<data.length;i++){
      const r=data[i]||[]; const g=k=>map[k]==null?'':String(r[map[k]]??'').trim();
      const classe=g('classe').toUpperCase().replace(/\s+/g,'');
      if(!classe&&!g('nom')&&!g('dossard')) continue;
      rows.push({feuille:sn,ligne:i+1,dossard:g('dossard'),nom:g('nom'),prenom:g('prenom'),
        classe,sexe:normSexe(g('sexe')),groupe:normGroupe(g('groupe')),type:normType(g('type'))});
      n++;
    }
    notes.push(sn+' : '+n+' ligne'+(n>1?'s':''));
  }
  return {rows,notes};
}

// Transforme les lignes lues en participants, avec toutes les vérifications.
export function prepareImport(rows,cfg,existing){
  const E=[], W=[], parts={}, noms={};
  const ordre={'6':0,'5':1,'4':2,'3':3};
  const sans=rows.filter(r=>!String(r.dossard).trim());
  let max=0;
  for(const r of rows){ const n=parseInt(r.dossard,10); if(n>0&&n<901) max=Math.max(max,n); }
  if(sans.length){
    sans.sort((a,b)=>(ordre[niveauDe(a.classe)]??9)-(ordre[niveauDe(b.classe)]??9)
      ||a.classe.localeCompare(b.classe)||a.nom.localeCompare(b.nom)||a.prenom.localeCompare(b.prenom));
    for(const r of sans){ r.dossard=String(++max); r.auto=true; }
    W.push(sans.length+' dossard'+(sans.length>1?'s':'')+' numéroté'+(sans.length>1?'s':'')+' automatiquement (colonne vide).');
    if(max>900) E.push('La numérotation automatique dépasse 900 : elle empiète sur les dossards réservés aux adultes (901 à 950).');
  }
  const vus={};
  for(const r of rows){
    const d=parseInt(r.dossard,10), ou=r.feuille+' ligne '+r.ligne;
    if(!(d>=1&&d<=999)||String(d)!==String(r.dossard).trim()){ E.push(ou+' : dossard « '+r.dossard+' » invalide.'); continue; }
    if(estAdulteNum(d)){ E.push(ou+' : le dossard '+d+' est réservé aux adultes (901 à 950).'); continue; }
    if(vus[d]){ E.push('Dossard '+d+' en double ('+vus[d]+' et '+ou+').'); continue; }
    vus[d]=ou;
    if(!r.classe){ E.push(ou+' : classe manquante.'); continue; }
    const p={c:r.classe};
    if(r.sexe) p.s=r.sexe;
    if(r.groupe) p.g=r.groupe;
    if(r.type) p.ty=r.type;
    const old=existing&&existing[d];
    if(old&&old.st) p.st=old.st;
    parts[d]=p;
    noms[d]={nom:r.nom,prenom:r.prenom};
  }
  const sansSexe=Object.values(parts).filter(p=>!p.s).length;
  if(sansSexe) W.push(sansSexe+' élève'+(sansSexe>1?'s':'')+' sans sexe renseigné : les groupes concernés seront classés « mixtes ».');
  const sansGrp={};
  for(const d in parts) if(!parts[d].g) sansGrp[parts[d].c]=(sansGrp[parts[d].c]||0)+1;
  const nsg=Object.values(sansGrp).reduce((a,b)=>a+b,0);
  if(nsg) W.push(nsg+' élève'+(nsg>1?'s':'')+' sans groupe ('+Object.entries(sansGrp).map(([c,n])=>c+' : '+n).join(', ')+'). Ils comptent pour leur classe, pas pour un podium de groupe.');
  const grp={};
  for(const d in parts){ const p=parts[d]; if(!p.g) continue;
    const k=p.c+'|'+(p.ty||'')+'|'+p.g; (grp[k]=grp[k]||[]).push({d,p}); }
  for(const k in grp){
    const [c,ty,g]=k.split('|'), m=grp[k];
    const nom=c+' '+(ty?TYPES[ty]+' ':'')+g;
    if(m.length>5) W.push('Groupe '+nom+' : '+m.length+' membres (5 maximum).');
    if(ty==='F'&&m.some(x=>x.p.s==='G')) W.push('Groupe '+nom+' déclaré « Filles » mais contient un garçon.');
    if(ty==='G'&&m.some(x=>x.p.s==='F')) W.push('Groupe '+nom+' déclaré « Garçons » mais contient une fille.');
  }
  const horsCourse=[...new Set(Object.values(parts).map(p=>p.c).filter(c=>!courseDeClasse(cfg,c)))];
  if(horsCourse.length) W.push('Classes rattachées à aucune course : '+horsCourse.join(', ')+'. Vérifiez les niveaux des courses.');
  const nCl=new Set(Object.values(parts).map(p=>p.c)).size;
  return {parts,noms,E,W,stats:{eleves:Object.keys(parts).length,classes:nCl,groupes:Object.keys(grp).length}};
}

// ---------------------------------------------------------------- export Excel
export function exportWorkbook(res,state,noms){
  const cfg=res.cfg, L=Object.values(res.lignes).sort((a,b)=>a.d-b.d);
  const wb=XLSX.utils.book_new();
  const add=(nom,aoa,cols)=>{ const ws=XLSX.utils.aoa_to_sheet(aoa); if(cols) ws['!cols']=cols.map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,ws,nom); };
  const min = ms => ms==null?'':Math.round(ms/1000/60*100)/100;

  add('Par élève',[['Dossard','Nom','Classe','Sexe','Groupe','Type de groupe','Statut','Tours','Km',
    'Premier passage','Dernier passage','Du premier au dernier passage (min)','Meilleur tour (min)','Tour moyen (min)','Correction']]
    .concat(L.filter(x=>x.p&&!x.p.a).map(x=>[x.d,nomDe(noms,x),x.p.c,x.p.s||'',x.p.g||'',x.p.ty?TYPES[x.p.ty]:'',
      x.p.st||'',x.tours,Math.round(x.tours*cfg.boucle*100)/100,fmtHeure(x.first),fmtHeure(x.last),min(x.span),
      min(x.best),min(x.moy),x.corr||''])),[8,24,8,6,8,12,10,7,7,12,12,14,12,12,10]);

  const cl=[['Course','Niveau','Rang','Classe','Moyenne (tours / élève)','Tours élèves','Tours adultes','Total','Élèves ayant couru','Inscrits','Km']];
  for(const id in cfg.courses) for(const n of niveauxDe(cfg.courses[id])){
    res.classes.filter(c=>c.course===id&&c.niv===n).forEach((c,i)=>cl.push([cfg.courses[id].nom,n+'e',i+1,c.c,
      Math.round(c.moy*100)/100,c.te,c.ta,c.total,c.coureurs,c.inscrits,Math.round(c.km*10)/10]));
  }
  add('Classes',cl,[12,8,6,8,20,12,12,8,16,8,8]);

  const gr=[['Niveau','Catégorie','Rang','Classe','Groupe','Moyenne','Membres ayant couru','Membres']];
  for(const n of ['6','5','4','3']) for(const ty of ['F','G','M']){
    res.groupes.filter(g=>g.niv===n&&g.ty===ty).forEach((g,i)=>gr.push([n+'e',TYPES[ty],i+1,g.c,g.g,
      Math.round(g.moy*100)/100,g.coureurs,g.membres.map(m=>(nomDe(noms,m)||m.d)+' ('+m.tours+')').join(', ')]));
  }
  add('Groupes',gr,[8,10,6,8,8,10,18,70]);

  add('Adultes',[['Dossard','Nom','Classe créditée','Tours','Km']].concat(
    L.filter(x=>x.p&&x.p.a).map(x=>[x.d,x.p.n||'',x.p.cr||'(aucune)',x.tours,Math.round(x.tours*cfg.boucle*100)/100])),[8,24,14,8,8]);

  const sc=Object.values(state.scans||{}).sort((a,b)=>a.t-b.t);
  add('Journal',[['Heure','Dossard','Tablette','Mode','Compté comme tour']].concat(
    sc.map(s=>[fmtHeure(s.t),s.d,s.v||'',s.m==='k'?'clavier':'caméra',res.compte.has(s.id)?'oui':''])),[10,8,18,8,16]);

  const A=res.A, ct=[['Type','Dossard','Détail']];
  A.plafond.forEach(x=>ct.push(['Nombre de tours élevé',x.d,x.tours+' tours']));
  A.manquants.forEach(m=>ct.push(['Tour manquant probable',m.L.d,'Intervalle de '+fmtDuree(m.v)+' entre '+fmtHeure(m.de)+' et '+fmtHeure(m.a)+' (tour habituel '+fmtDuree(m.med)+')']));
  A.inconnus.forEach(x=>ct.push(['Numéro inconnu scanné',x.d,x.nScans+' lecture(s)']));
  A.adultesLibres.forEach(x=>ct.push(['Dossard adulte non attribué',x.d,x.tours+' tour(s)']));
  A.dispenses.forEach(x=>ct.push(['Dispensé ou absent scanné',x.d,x.laps.length+' passage(s)']));
  A.zero.forEach(x=>ct.push(['Aucun tour',x.d,(x.p&&x.p.c)||'']));
  Object.values(state.corrections||{}).forEach(c=>{ if(c&&c.delta) ct.push(['Correction manuelle',c.d,(c.delta>0?'+':'')+c.delta+' — '+(c.raison||'')+' ('+fmtHeure(c.t)+')']); });
  add('Contrôle',ct,[26,8,70]);

  const d=new Date();
  XLSX.writeFile(wb,'cross-resultats-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+'.xlsx');
}

// ---------------------------------------------------------------- éléments d'interface communs
// Fenêtre de saisie de la clé (mode Firebase uniquement).
export function askKey(msg){
  const w=document.createElement('div');
  w.className='keygate';
  w.innerHTML='<div class="keybox"><h2>Clé de l\'événement</h2><p>'+esc(msg||'Saisissez la clé communiquée par l\'organisateur.')+
    '</p><input id="kg-in" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="kg-ok" class="btn primary">Valider</button></div>';
  document.body.appendChild(w);
  const go=()=>{ const v=document.getElementById('kg-in').value.trim(); if(!v) return; setEventKey(v);
    const u=new URL(location.href); u.searchParams.delete('cle'); location.href=u.toString(); };
  document.getElementById('kg-ok').onclick=go;
  document.getElementById('kg-in').onkeydown=e=>{ if(e.key==='Enter') go(); };
  setTimeout(()=>document.getElementById('kg-in').focus(),50);
}

// Ouvre le stockage et gère les cas « clé absente », « clé refusée », « mode local ».
export async function boot(){
  let store;
  try{ store=await openStore(); }
  catch(e){
    document.body.insertAdjacentHTML('afterbegin','<div class="banner err">Impossible de joindre Firebase ('+esc(e.message||e)+'). Vérifiez la connexion, puis rechargez la page.</div>');
    throw e;
  }
  if(!store){ askKey(); throw new Error('clé'); }
  store.onError(e=>{
    if(String(e&&(e.code||e.message)).toLowerCase().includes('permission')){
      LS.del('cross.cle'); askKey('Cette clé est refusée. Vérifiez-la auprès de l\'organisateur.');
    }
  });
  if(store.mode==='local')
    document.body.insertAdjacentHTML('afterbegin','<div class="banner warn">Mode local : les données restent sur cet appareil. Renseignez config.js pour synchroniser les tablettes.</div>');
  store.onValue('config',c=>{
    const r=c&&c.resetAt;
    if(boot._reset!==undefined&&r&&r!==boot._reset) location.reload();
    boot._reset=r||null;
  });
  return store;
}

// ---------------------------------------------------------------- file d'envoi des scans
// Chaque scan est d'abord écrit sur l'appareil, puis envoyé par lots. Un scan
// renvoyé plusieurs fois ne crée jamais de doublon (même identifiant).
export class ScanQueue{
  constructor(store){
    this.store=store; this.k='cross.journal.'+store.key;
    this.list=LS.get(this.k,[])||[]; this.busy=false; this.lastOk=0; this.lastErr=0; this.cbs=[];
    setInterval(()=>this.flush(),2500);
    addEventListener('online',()=>this.flush());
  }
  onChange(cb){ this.cbs.push(cb); cb(this.stat()); }
  stat(){ return {total:this.list.length,pending:this.list.filter(s=>!s.ok).length,lastOk:this.lastOk,lastErr:this.lastErr}; }
  notify(){ const s=this.stat(); this.cbs.forEach(f=>f(s)); }
  save(){ if(!LS.set(this.k,this.list)){ this.list=this.list.filter(s=>!s.ok||s.t>Date.now()-6*3600e3); LS.set(this.k,this.list); } }
  add(s){ this.list.push({...s,ok:0}); this.save(); this.notify(); this.flush(); }
  flush(){
    if(this.busy) return;
    const batch=this.list.filter(s=>!s.ok).slice(0,300);
    if(!batch.length) return;
    this.busy=true;
    const obj={};
    for(const s of batch){ const {id,ok,...v}=s; obj['scans/'+id]=v; }
    const t=new Promise((_,rej)=>setTimeout(()=>rej(new Error('délai')),20000));
    Promise.race([this.store.update(obj),t]).then(()=>{
      const ids=new Set(batch.map(s=>s.id));
      this.list.forEach(s=>{ if(ids.has(s.id)) s.ok=1; });
      this.lastOk=Date.now(); this.save();
    },()=>{ this.lastErr=Date.now(); }).finally(()=>{ this.busy=false; this.notify(); });
  }
  csv(dev){
    return 'id;heure;dossard;tablette;mode;horodatage_ms\n'+
      this.list.map(s=>[s.id,fmtHeure(s.t),s.d,s.v||dev||'',s.m||'c',s.t].join(';')).join('\n');
  }
}

// Téléchargement d'un fichier texte (CSV) — fonctionne sur iPad (Fichiers).
export function download(name,text,type){
  const blob=new Blob(['﻿'+text],{type:type||'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; a.style.display='none'; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },2000);
}
