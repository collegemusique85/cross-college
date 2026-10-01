// =============================================================================
//  Cross du collège — socle commun à toutes les pages
//  Stockage (Firebase Realtime Database ou mode local), file de synchro,
//  moteur de calcul des tours, import Excel, export Excel.
// =============================================================================
import CONFIG from './config.js';

export const VERSION = '1.1';
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
    '0':{off:true},   // ancienne course unique du lycée, remplacée par les six courses ci-dessous
    // Lycée : deux départs par niveau (filles puis garçons), classement à l'arrivée, avant le collège.
    'L1':{nom:'2de - CAP1 filles',niveaux:'2,CAPC1,CAPE1,3PM',sexe:'F',type:'arrivee',duree:0,ordre:.1,debut:null,fin:null},
    'L2':{nom:'2de - CAP1 garçons',niveaux:'2,CAPC1,CAPE1,3PM',sexe:'G',type:'arrivee',duree:0,ordre:.2,debut:null,fin:null},
    'L3':{nom:'1re - CAP2 filles',niveaux:'1,CAPC2,CAPE2',sexe:'F',type:'arrivee',duree:0,ordre:.3,debut:null,fin:null},
    'L4':{nom:'1re - CAP2 garçons',niveaux:'1,CAPC2,CAPE2',sexe:'G',type:'arrivee',duree:0,ordre:.4,debut:null,fin:null},
    'L5':{nom:'Terminales filles',niveaux:'T',sexe:'F',type:'arrivee',duree:0,ordre:.5,debut:null,fin:null},
    'L6':{nom:'Terminales garçons',niveaux:'T',sexe:'G',type:'arrivee',duree:0,ordre:.6,debut:null,fin:null},
    '1':{nom:'Course 1',niveaux:'6,5',type:'tours',duree:45,debut:null,fin:null},
    '2':{nom:'Course 2',niveaux:'4,3',type:'tours',duree:45,debut:null,fin:null}
  }
};
export function readCfg(raw){
  raw=raw||{};
  const c={...DEFAULT_CFG,...raw};
  c.courses={};
  for(const id of new Set([...Object.keys(DEFAULT_CFG.courses),...Object.keys(raw.courses||{})]))
    { const o={...(DEFAULT_CFG.courses[id]||{nom:'Course '+id,niveaux:'',type:'tours'}),...((raw.courses||{})[id]||{})};
      o.duree=Math.max(0,+o.duree||0);
      if(!o.off) c.courses[id]=o; }   // off:true = course supprimée
  for(const k of ['absence','plafond','boucle','delai']) c[k]=+c[k]||0;
  if(!c.absence) c.absence=60;
  if(!c.boucle) c.boucle=0.8;
  if(!c.plafond) c.plafond=15;
  // Ordre d'affichage des courses : champ « ordre », sinon le numéro (le lycée passe avant le collège).
  c.ordre=Object.keys(c.courses).sort((a,b)=>rangCourse(c.courses[a],a)-rangCourse(c.courses[b],b)||a.localeCompare(b));
  return c;
}
const rangCourse=(co,id)=>co.ordre!=null&&co.ordre!==''?+co.ordre:(isNaN(+id)?50:+id);
export const coursesOrdonnees = cfg => (cfg.ordre||Object.keys(cfg.courses)).map(id=>[id,cfg.courses[id]]);
export const idsLycee = cfg => (cfg.ordre||Object.keys(cfg.courses)).filter(id=>estArrivee(cfg.courses[id]));
// Niveau = premier caractère de la classe : 601 → 6, 3PM → 3, TG1 → T, 2NDE3 → 2.
export function niveauDe(classe){ const s=String(classe||'').trim().toUpperCase(); return s?s[0]:'?'; }
export function libNiveau(n){ return n==='1'?'1<sup>re</sup>':/^\d$/.test(n)?n+'<sup>e</sup>':(n==='T'?'Term.':n); }
export function niveauxDe(course){ return String(course&&course.niveaux||'').split(/[\s,;]+/).filter(Boolean); }
// Une classe appartient à une course si elle commence par l'un de ses « niveaux » (ou si la course accepte « * »).
export function classeDansCourse(course,classe){
  const n=niveauxDe(course), c=String(classe||'').toUpperCase();
  if(n.includes('*')) return true;
  return n.some(x=>c.startsWith(String(x).toUpperCase()));
}
export function courseDeClasse(cfg,classe,sexe){
  // Si plusieurs courses conviennent, la plus précise gagne : « 3PM » (lycée) l'emporte sur « 3 » (collège).
  const c=String(classe||'').toUpperCase(); let best=null, lg=-1;
  for(const id in cfg.courses){ const co=cfg.courses[id];
    if(sexe!==undefined&&co.sexe&&co.sexe!==sexe) continue;   // course réservée aux filles ou aux garçons
    for(const x of niveauxDe(co)){ const X=String(x).toUpperCase(), l=X==='*'?0:(c.startsWith(X)?X.length:-1);
      if(l>lg){ lg=l; best=id; } } }
  return best;
}
// Course d'un élève : tient compte du filtre filles/garçons éventuel.
export const courseDe=(cfg,p)=>p?courseDeClasse(cfg,p.c,p.s||''):null;
// Niveaux réellement présents dans une course, dans l'ordre de ses réglages.
export function niveauxPresents(cfg,id,classes){
  const ordre=niveauxDe(cfg.courses[id]), vus=[...new Set(classes.filter(c=>c.course===id).map(c=>c.niv))];
  const rang=n=>{ const i=ordre.findIndex(o=>o!=='*'&&n.startsWith(o.toUpperCase()[0])); return i<0?99:i; };
  return vus.sort((a,b)=>rang(a)-rang(b)||a.localeCompare(b));
}
export const estArrivee = c => c && c.type==='arrivee';
// Élève du lycée (course « classement à l'arrivée ») : dossards à partir de 1001.
export function estLyceeClasse(cfg,classe){ const id=courseDeClasse(cfg,classe); return !!(id&&estArrivee(cfg.courses[id])); }
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
    if(p&&!p.a){ const c=courseDe(cfg,p); return c?[c]:[]; }
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
    // Scanné pendant la course d'un autre groupe : non compté, mais signalé (élèves seulement).
    let mauvaise=null; const p0=P[d];
    if(p0&&!p0.a) for(const s of hors){ const autre=Object.keys(win).find(id=>!ids.includes(id)&&s.t>=win[id].a&&s.t<=win[id].b);
      if(autre){ mauvaise={course:autre,t:s.t,v:s.v||''}; break; } }
    R[d]={laps,first,last,nScans:list.length,hors:hors.length,mauvaise};
  }
  const estAd=d=>{ const p=P[d]; return p?!!p.a:estAdulteNum(+d); };
  const corr={};
  for(const k in C){ const c=C[k]; if(c&&c.d!=null) corr[c.d]=(corr[c.d]||0)+(+c.delta||0); }

  const lignes={};
  for(const d of new Set([...Object.keys(P),...Object.keys(R)])){
    const r=R[d]||{laps:[],first:null,last:null,nScans:0,hors:0,mauvaise:null}, p=P[d]||null;
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
  // Moyenne = tours des élèves ÷ élèves ayant couru. Les tours des adultes comptent dans le total
  // (et les km) de la classe, mais pas dans sa moyenne : un adulte qui fait peu de tours ne la pénalise pas.
  const classes=Object.values(cls).map(o=>({...o,total:o.te+o.ta,
    moy:o.coureurs?o.te/o.coureurs:0, km:(o.te+o.ta)*cfg.boucle}))
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
  const A={plafond:[],manquants:[],inconnus:[],adultesLibres:[],dispenses:[],zero:[],hors:0,mauvaise:[]};
  for(const d in lignes){
    const L=lignes[d], p=L.p;
    if(L.tours>cfg.plafond-1&&L.tours>0) A.plafond.push(L);
    if(!p&&L.nScans&&!estAdulteNum(+d)) A.inconnus.push(L);
    if(!p&&L.nScans&&estAdulteNum(+d)) A.adultesLibres.push(L);
    if(p&&p.st&&L.laps.length) A.dispenses.push(L);
    if(p&&!p.a&&!p.st){ const cid=courseDe(cfg,p); if(cid&&win[cid]&&L.tours===0) A.zero.push(L); }
    A.hors+=L.hors;
    if(L.mauvaise) A.mauvaise.push(L);
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

  // Défi « qui battra les profs ? » : moyenne des adultes, course par course
  const profs={}, meilleurs={};
  for(const id in cfg.courses){
    let n=0,total=0,bestA=null,bestE=null;
    for(const d in lignes){ const L=lignes[d];
      if(estAd(d)){ if(L.p&&L.p.st) continue;
        const lp=win[id]?L.laps.filter(t=>t>=win[id].a&&t<=win[id].b):[];
        if(lp.length>0){ n++; total+=lp.length; }
        for(let i=1;i<lp.length;i++){ const v=lp[i]-lp[i-1]; if(!bestA||v<bestA.v) bestA={v,L}; }
      } else if(L.p&&!L.p.st&&courseDe(cfg,L.p)===id&&L.best!=null&&(!bestE||L.best<bestE.v)) bestE={v:L.best,L};
    }
    profs[id]={n,total,moy:n?total/n:0};
    meilleurs[id]={adulte:bestA,eleve:bestE};
  }

  // Courses « à l'arrivée » : premier passage après le départ = arrivée
  const arrivees={};
  for(const id in cfg.courses){
    const co=cfg.courses[id]; if(!estArrivee(co)) continue;
    const L=Object.values(lignes).filter(x=>x.p&&!x.p.a&&!x.p.st&&courseDe(cfg,x.p)===id);
    const arr=L.filter(x=>x.first!=null).sort((a,b)=>a.first-b.first);
    const parSexe={F:0,G:0};
    arr.forEach((x,i)=>{ x.rang=i+1; x.temps=co.debut?x.first-co.debut:null;
      if(x.p.s) x.rangSexe=++parSexe[x.p.s]; });
    arrivees[id]={inscrits:L.length,arrives:arr};
  }

  const totaux={passages:0};
  for(const d in lignes) totaux.passages+=lignes[d].tours;
  totaux.km=totaux.passages*cfg.boucle;
  return {cfg,lignes,classes,groupes,A,compte,totaux,win,profs,arrivees,meilleurs};
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
  const E=[], W=[], parts={}, noms={}, keep={};
  const ordre={'6':0,'5':1,'4':2,'3':3,'2':4,'1':5,'T':6};
  // Collège et lycée s'importent ensemble ou séparément : un fichier qui ne contient que
  // des classes du lycée ne remplace que le lycée, et inversement.
  const lyc=c=>estLyceeClasse(cfg,c);
  const aL=rows.some(r=>lyc(r.classe)), aC=rows.some(r=>r.classe&&!lyc(r.classe));
  const pris={};
  for(const [d,p] of Object.entries(existing||{})) if(p&&!p.a&&(lyc(p.c)?!aL:!aC)){ keep[d]=p; pris[d]='liste déjà publiée'; }
  const nk=Object.keys(keep).length;
  if(nk) W.push(nk+' élève'+(nk>1?'s':'')+' '+(aL?'du collège':'du lycée')+' déjà publié'+(nk>1?'s':'')+' : conservé'+(nk>1?'s':'')+' tel'+(nk>1?'s':'')+' quel'+(nk>1?'s':'')+'.');
  const sans=rows.filter(r=>!String(r.dossard).trim());
  let maxC=0, maxL=1000;
  for(const d of [...rows.map(r=>parseInt(r.dossard,10)),...Object.keys(keep).map(Number)]){
    if(d>0&&d<901) maxC=Math.max(maxC,d); if(d>1000) maxL=Math.max(maxL,d); }
  if(sans.length){
    const rg=c=>lyc(c)?10+ORDRE_LYCEE.indexOf(niveauLycee(c)):(ordre[niveauDe(c)]??9);
    sans.sort((a,b)=>rg(a.classe)-rg(b.classe)
      ||a.classe.localeCompare(b.classe)||a.nom.localeCompare(b.nom)||a.prenom.localeCompare(b.prenom));
    for(const r of sans){ r.dossard=String(lyc(r.classe)?++maxL:++maxC); r.auto=true; }
    W.push(sans.length+' dossard'+(sans.length>1?'s':'')+' numéroté'+(sans.length>1?'s':'')+' automatiquement (colonne vide)'+(aL?' ; lycée à partir de 1001':'')+'.');
    if(maxC>900) E.push('La numérotation automatique du collège dépasse 900 : elle empiète sur les dossards réservés aux adultes (901 à 950).');
  }
  const vus={...pris};
  for(const r of rows){
    const d=parseInt(r.dossard,10), ou=r.feuille+' ligne '+r.ligne;
    if(!(d>=1&&d<=9999)||String(d)!==String(r.dossard).trim()){ E.push(ou+' : dossard « '+r.dossard+' » invalide.'); continue; }
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
  const sansSexeL=Object.values(parts).filter(p=>!p.s&&lyc(p.c)).length;
  if(sansSexeL) W.push(sansSexeL+' lycéen'+(sansSexeL>1?'s':'')+' sans sexe renseigné : ils ne seront rattachés à aucune course (les départs du lycée sont séparés filles / garçons).');
  const sansSexe=Object.values(parts).filter(p=>!p.s&&!lyc(p.c)).length;
  if(sansSexe) W.push(sansSexe+' élève'+(sansSexe>1?'s':'')+' sans sexe renseigné : les groupes concernés seront classés « mixtes ».');
  const sansGrp={};
  for(const d in parts) if(!parts[d].g&&!lyc(parts[d].c)) sansGrp[parts[d].c]=(sansGrp[parts[d].c]||0)+1;
  const nsg=Object.values(sansGrp).reduce((a,b)=>a+b,0);
  if(nsg&&Object.values(cfg.courses).some(c=>!estArrivee(c))) W.push(nsg+' élève'+(nsg>1?'s':'')+' sans groupe ('+Object.entries(sansGrp).map(([c,n])=>c+' : '+n).join(', ')+'). Ils comptent pour leur classe, pas pour un podium de groupe.');
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
  return {parts,noms,keep,E,W,stats:{eleves:Object.keys(parts).length,classes:nCl,groupes:Object.keys(grp).length,lycee:aL,college:aC}};
}

// ---------------------------------------------------------------- classements individuels
// Plus de tours d'abord ; à égalité, le tour moyen le plus rapide, puis le meilleur tour.
export function trierIndiv(L){
  const v=x=>x==null?Infinity:x;
  return L.slice().sort((a,b)=>b.tours-a.tours||v(a.moy)-v(b.moy)||v(a.best)-v(b.best)||a.d-b.d);
}
export function rangsIndiv(L){ let r=0,prev=null; return L.map((x,i)=>{ const k=x.tours+'|'+(x.moy==null?'':Math.floor(x.moy/1000));
  if(k!==prev){ r=i+1; prev=k; } return r; }); }
export const mmss = ms => ms==null?'':fmtChrono(ms);
// « Pas dans la bonne course » : libellé pour les tableaux et les exports.
export const libMauvaise = (cfg,L) => L&&L.mauvaise?'pas dans la bonne course (scanné pendant « '+((cfg.courses[L.mauvaise.course]||{}).nom||'?')+' » à '+fmtHeure(L.mauvaise.t)+')':'';

// ---------------------------------------------------------------- lycée : classements à l'arrivée
export const NIV_LYCEE={'2':'2de','1':'1re','T':'Tle','3PM':'3PM'};
export const libNivLycee = n => NIV_LYCEE[n]||n;
// Niveau au lycée : 3PM à part ; CAP 1re année (CAPC1, CAPE1) avec les 2de, 2e année (CAPC2, CAPE2) avec les 1re.
export function niveauLycee(classe){ const c=String(classe||'').trim().toUpperCase();
  if(c.startsWith('3PM')) return '3PM';
  if(c.startsWith('CAP')){ const m=c.match(/(\d)\s*$/); return m&&m[1]==='2'?'1':'2'; }
  return c[0]||'?'; }
export const ORDRE_LYCEE=['2','1','T','3PM'];
// Rangs général, par sexe, par niveau et sexe, par classe et sexe (ordre des premiers passages).
// La 3PM compte dans le classement général du lycée et a aussi son propre classement (son « niveau »).
export function classementLycee(res,ids){
  ids=[].concat(ids||idsLycee(res.cfg));
  // Plusieurs départs : on classe au temps de course ; à égalité, à l'heure d'arrivée.
  const v=x=>x==null?Infinity:x;
  const A=ids.flatMap(id=>(res.arrivees[id]||{arrives:[]}).arrives.map(x=>({...x,course:id}))).sort((a,b)=>v(a.temps)-v(b.temps)||a.first-b.first), cpt={};
  const inc=k=>cpt[k]=(cpt[k]||0)+1;
  // rangCourse : le classement officiel (une course = un départ) ; les autres rangs servent aux exports.
  return A.map(x=>{ const s=x.p.s||'?', n=niveauLycee(x.p.c);
    return {...x,niv:n,rangCourse:inc('k'+x.course),rang:inc('g'),rangSexe:x.p.s?inc('s'+s):null,rangNiv:x.p.s?inc('n'+n+s):null,rangClasse:x.p.s?inc('c'+x.p.c+s):null}; });
}
export function statsLycee(L){
  const st=T=>{ const t=T.map(x=>x.temps).filter(v=>v!=null); return {n:T.length,best:t.length?Math.min(...t):null,moy:t.length?t.reduce((a,b)=>a+b,0)/t.length:null}; };
  return {F:st(L.filter(x=>x.p.s==='F')),G:st(L.filter(x=>x.p.s==='G')),T:st(L)};
}
export function exportLyceeCSV(res,noms,ids){
  ids=[].concat(ids||idsLycee(res.cfg));
  const cfg=res.cfg, L=classementLycee(res,ids), vu=new Set(L.map(x=>x.d));
  const q=v=>{ v=v==null?'':String(v); return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  // Fichier « tout le lycée » : trié au temps, avec le rang dans sa course et les rangs sur tout le lycée.
  const lig=[['Course','Rang dans la course','Rang lycée (tous)','Rang lycée filles/garçons','Rang niveau (même sexe)','Rang classe (même sexe)','Dossard','Nom','Prénom','Classe','Niveau','Sexe','Temps','Heure d\'arrivée','Statut']];
  for(const x of L){ const n=noms[x.d]||{};
    lig.push([cfg.courses[x.course].nom,x.rangCourse,x.rang,x.rangSexe||'',x.rangNiv||'',x.rangClasse||'',x.d,n.nom||'',n.prenom||'',x.p.c,libNivLycee(x.niv),x.p.s||'',x.temps!=null?fmtChrono(x.temps):'',fmtHeure(x.first),'arrivé']); }
  const autres=Object.entries(res.lignes).map(([d,x])=>x).filter(x=>x.p&&!x.p.a&&ids.includes(courseDe(cfg,x.p))&&!vu.has(x.d))
    .sort((a,b)=>a.p.c.localeCompare(b.p.c,'fr',{numeric:true})||a.d-b.d);
  for(const x of autres){ const n=noms[x.d]||{}, co=cfg.courses[courseDe(cfg,x.p)];
    lig.push([co?co.nom:'','','','','','',x.d,n.nom||'',n.prenom||'',x.p.c,libNivLycee(niveauLycee(x.p.c)),x.p.s||'','','',x.p.st?(x.p.st==='dispense'?'dispensé':'absent'):x.mauvaise?libMauvaise(cfg,x):'non arrivé']); }
  const d=new Date();
  download('cross-lycee-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.csv',lig.map(r=>r.map(q).join(';')).join('\r\n'));
}

// Lycée : une feuille par classe (dont CAP et 3PM), pour transmettre à chaque collègue.
export function exportLyceeParClasse(res,noms,ids){
  ids=[].concat(ids||idsLycee(res.cfg));
  const cfg=res.cfg, wb=XLSX.utils.book_new(), L=classementLycee(res,ids);
  const El=Object.values(res.lignes).filter(x=>x.p&&!x.p.a&&ids.includes(courseDe(cfg,x.p)));
  const cls=[...new Set(El.map(x=>x.p.c))].sort((a,b)=>ORDRE_LYCEE.indexOf(niveauLycee(a))-ORDRE_LYCEE.indexOf(niveauLycee(b))||a.localeCompare(b,'fr',{numeric:true}));
  const syn=[['Classe','Niveau','Inscrits','Arrivés','Filles arrivées','Garçons arrivés','Meilleur temps filles','Meilleur temps garçons','Temps moyen']];
  for(const c of cls){
    const A=L.filter(x=>x.p.c===c), S=statsLycee(A), ins=El.filter(x=>x.p.c===c&&!x.p.st).length;
    syn.push([c,libNivLycee(niveauLycee(c)),ins,A.length,S.F.n,S.G.n,S.F.best!=null?fmtChrono(S.F.best):'',S.G.best!=null?fmtChrono(S.G.best):'',S.T.moy!=null?fmtChrono(S.T.moy):'']);
    const rows=[['Classe '+c+' — '+(cfg.titre||'Cross')+' (classement à l\'arrivée)'],[],
      ['Course','Rang dans la course','Rang dans la classe (même sexe)','Dossard','Nom','Prénom','Sexe','Temps','Heure d\'arrivée']];
    for(const x of A){ const n=noms[x.d]||{}; rows.push([cfg.courses[x.course].nom,x.rangCourse,x.rangClasse||'',x.d,n.nom||'',n.prenom||'',x.p.s||'',x.temps!=null?fmtChrono(x.temps):'',fmtHeure(x.first)]); }
    const vus=new Set(A.map(x=>x.d)), reste=El.filter(x=>x.p.c===c&&!vus.has(x.d));
    if(reste.length){ rows.push([],['Non classés : non arrivés, pas dans la bonne course, absents ou dispensés']);
      reste.forEach(x=>{ const n=noms[x.d]||{}; rows.push(['','','',x.d,n.nom||'',n.prenom||'',x.p.s||'',x.p.st?(x.p.st==='dispense'?'dispensé':'absent'):x.mauvaise?libMauvaise(cfg,x):'non arrivé']); }); }
    const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[20,10,14,8,20,14,6,9,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,ws,String(c).replace(/[:\\\/?*\[\]]/g,' ').slice(0,31));
  }
  const ws=XLSX.utils.aoa_to_sheet(syn); ws['!cols']=[10,8,9,9,14,15,20,22,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,'Synthèse'); wb.SheetNames.unshift(wb.SheetNames.pop());
  const d=new Date();
  XLSX.writeFile(wb,'cross-lycee-par-classe-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.xlsx');
}

// ---------------------------------------------------------------- export par classe (pour les collègues d'EPS)
export function exportParClasse(res,noms){
  const cfg=res.cfg, wb=XLSX.utils.book_new();
  const El=Object.values(res.lignes).filter(x=>x.p&&!x.p.a&&!estLyceeClasse(cfg,x.p.c));   // le lycée a son export CSV
  const cls=[...new Set(El.map(x=>x.p.c))].sort((a,b)=>'6543'.indexOf(niveauDe(a))-'6543'.indexOf(niveauDe(b))||a.localeCompare(b,'fr',{numeric:true}));
  const rangCl={}; for(const id in cfg.courses) for(const n of niveauxPresents(cfg,id,res.classes))
    res.classes.filter(c=>c.course===id&&c.niv===n).forEach((c,i,arr)=>rangCl[c.c]=(i+1)+' / '+arr.length);
  const rangCo={}; for(const id in cfg.courses) res.classes.filter(c=>c.course===id).forEach((c,i,arr)=>rangCo[c.c]=(i+1)+' / '+arr.length);
  const syn=[['Classe','Rang dans le niveau','Rang dans la course','Moyenne (tours / élève)','Tours élèves','Tours adultes','Élèves ayant couru','Inscrits','Km','Meilleur tour de la classe']];
  for(const c of cls){
    const C=res.classes.find(x=>x.c===c)||{moy:0,te:0,ta:0,coureurs:0,inscrits:0,km:0};
    const L=trierIndiv(El.filter(x=>x.p.c===c&&!x.p.st&&!(x.mauvaise&&!x.tours))), R=rangsIndiv(L);
    const best=L.filter(x=>x.best!=null).sort((a,b)=>a.best-b.best)[0];
    syn.push([c,rangCl[c]||'',rangCo[c]||'',Math.round(C.moy*100)/100,C.te,C.ta,C.coureurs,C.inscrits,Math.round(C.km*10)/10,best?mmss(best.best)+' ('+(nomDe(noms,best)||'n° '+best.d)+')':'']);
    const rows=[['Classe '+c+' — '+(cfg.titre||'Cross')],
      ['Moyenne de la classe',Math.round(C.moy*100)/100,'tours par élève','Rang dans le niveau',rangCl[c]||'','Rang dans la course',rangCo[c]||''],[],
      ['Rang','Dossard','Nom','Prénom','Sexe','Groupe','Type de groupe','Tours','Km','Meilleur tour','Tour moyen','Premier passage','Dernier passage']];
    L.forEach((x,i)=>{ const n=noms[x.d]||{};
      rows.push([R[i],x.d,n.nom||'',n.prenom||'',x.p.s||'',x.p.g||'',x.p.ty?TYPES[x.p.ty]:'',x.tours,Math.round(x.tours*cfg.boucle*100)/100,
        mmss(x.best),mmss(x.moy),fmtHeure(x.first),fmtHeure(x.last)]); });
    const st=El.filter(x=>x.p.c===c&&(x.p.st||(x.mauvaise&&!x.tours)));
    if(st.length){ rows.push([],['Non classés : absents, dispensés ou pas dans la bonne course']);
      st.forEach(x=>{ const n=noms[x.d]||{}; rows.push(['',x.d,n.nom||'',n.prenom||'',x.p.s||'',x.p.g||'',x.p.st?(x.p.st==='dispense'?'dispensé':'absent'):libMauvaise(cfg,x)]); }); }
    const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[6,8,20,14,6,8,12,7,7,12,11,14,14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,ws,String(c).replace(/[:\\\/?*\[\]]/g,' ').slice(0,31));
  }
  const ws=XLSX.utils.aoa_to_sheet(syn); ws['!cols']=[8,18,18,20,12,12,16,8,8,30].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,'Synthèse');
  wb.SheetNames.unshift(wb.SheetNames.pop());          // la synthèse en premier
  const d=new Date();
  XLSX.writeFile(wb,'cross-par-classe-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.xlsx');
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
      x.p.st||libMauvaise(cfg,x),x.tours,Math.round(x.tours*cfg.boucle*100)/100,fmtHeure(x.first),fmtHeure(x.last),min(x.span),
      min(x.best),min(x.moy),x.corr||''])),[8,24,8,6,8,12,10,7,7,12,12,14,12,12,10]);

  const cl=[['Course','Niveau','Rang','Classe','Moyenne (tours / élève)','Tours élèves','Tours adultes','Total','Élèves ayant couru','Inscrits','Km']];
  for(const id in cfg.courses){ if(estArrivee(cfg.courses[id])) continue; for(const n of niveauxPresents(cfg,id,res.classes)){
    res.classes.filter(c=>c.course===id&&c.niv===n).forEach((c,i)=>cl.push([cfg.courses[id].nom,/\d/.test(n)?n+'e':n,i+1,c.c,
      Math.round(c.moy*100)/100,c.te,c.ta,c.total,c.coureurs,c.inscrits,Math.round(c.km*10)/10]));
  } }
  for(const id in res.profs){ const pr=res.profs[id]; if(pr.n) cl.push([cfg.courses[id].nom,'—','défi','Les profs',
    Math.round(pr.moy*100)/100,'',pr.total,pr.total,pr.n+' adulte(s)','','']); }
  add('Classes',cl,[12,8,6,8,20,12,12,8,16,8,8]);

  const gr=[['Niveau','Catégorie','Rang','Classe','Groupe','Moyenne','Membres ayant couru','Membres']];
  for(const n of [...new Set(res.groupes.map(g=>g.niv))].sort((a,b)=>'6543'.indexOf(a)-'6543'.indexOf(b)||a.localeCompare(b))) for(const ty of ['F','G','M']){
    res.groupes.filter(g=>g.niv===n&&g.ty===ty).forEach((g,i)=>gr.push([n+'e',TYPES[ty],i+1,g.c,g.g,
      Math.round(g.moy*100)/100,g.coureurs,g.membres.map(m=>(nomDe(noms,m)||m.d)+' ('+m.tours+')').join(', ')]));
  }
  add('Groupes',gr,[8,10,6,8,8,10,18,70]);

  for(const id in res.arrivees){
    const A2=res.arrivees[id];
    add(('Arrivée '+id+' '+cfg.courses[id].nom).replace(/[:\\\/?*\[\]]/g,' ').slice(0,31),[['Rang','Rang F/G','Dossard','Nom','Classe','Sexe','Temps','Heure d\'arrivée']].concat(
      A2.arrives.map(x=>[x.rang,x.rangSexe?x.rangSexe+(x.p.s==='F'?' F':' G'):'',x.d,nomDe(noms,x),x.p.c,x.p.s||'',fmtChrono(x.temps),fmtHeure(x.first)])),[6,9,8,24,8,6,10,14]);
  }
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
  A.mauvaise.forEach(x=>ct.push(['Scanné pendant une autre course',x.d,(x.p&&x.p.c||'')+' — '+libMauvaise(cfg,x)]));
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

// ---------------------------------------------------------------- menu commun
export const PAGES=[['index.html','Accueil'],['scan.html','Tablettes'],['scan.html?mode=absents','Absents'],['direct.html','Direct'],
  ['resultats.html','Podiums'],['admin.html','Organisation'],['dossards.html','Dossards']];
export function navBar(actif,dark){
  const n=document.createElement('nav'); n.className='topnav'+(dark?' dark':'');
  n.innerHTML='<b>Cross</b>'+PAGES.map(([h,l])=>'<a href="'+h+'"'+(h===actif?' class="on" aria-current="page"':'')+'>'+l+'</a>').join('');
  document.body.prepend(n);
  return n;
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
