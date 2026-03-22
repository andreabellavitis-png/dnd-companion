import { useState, useEffect, useCallback } from "react";
import { db, auth } from "./firebase";
import { doc, setDoc, getDoc, getDocs, collection, query, where, deleteDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATS = ["STR","DEX","CON","INT","WIS","CHA"];
const STAT_IT = { STR:"FOR", DEX:"DES", CON:"COS", INT:"INT", WIS:"SAG", CHA:"CAR" };
const CONDITIONS_EN = ["Blinded","Charmed","Deafened","Exhausted","Frightened","Grappled","Incapacitated","Invisible","Paralyzed","Petrified","Poisoned","Prone","Restrained","Stunned","Unconscious"];
const CONDITIONS_IT = ["Accecato","Affascinato","Assordato","Esausto","Spaventato","Afferrato","Incapacitato","Invisibile","Paralizzato","Pietrificato","Avvelenato","Prono","Trattenuto","Stordito","Privo di sensi"];
const SPELL_SLOTS = [1,2,3,4,5,6,7,8,9];
const ACTION_TYPES_EN = ["Action","Bonus Action","Reaction","Free Action","Movement"];
const ACTION_TYPES_IT = ["Azione","Azione Bonus","Reazione","Azione Gratuita","Movimento"];
const ACTION_KEYS = ["action","bonusAction","reaction","freeAction","movement"];
const ACTION_COLORS = {
  action:      {bg:"rgba(200,150,62,0.12)", border:"rgba(200,150,62,0.5)", text:"#c8963e"},
  bonusAction: {bg:"rgba(123,94,167,0.12)", border:"rgba(123,94,167,0.5)", text:"#9b7be0"},
  reaction:    {bg:"rgba(52,152,219,0.12)", border:"rgba(52,152,219,0.5)", text:"#5dade2"},
  freeAction:  {bg:"rgba(39,174,96,0.12)",  border:"rgba(39,174,96,0.5)",  text:"#2ecc71"},
  movement:    {bg:"rgba(230,126,34,0.12)", border:"rgba(230,126,34,0.5)", text:"#e67e22"},
};
const SKILLS = [
  {key:"acrobatics",   en:"Acrobatics",      it:"Acrobazia",         stat:"DEX"},
  {key:"animalH",      en:"Animal Handling",  it:"Addestrare Animali",stat:"WIS"},
  {key:"arcana",       en:"Arcana",           it:"Arcano",            stat:"INT"},
  {key:"athletics",    en:"Athletics",        it:"Atletica",          stat:"STR"},
  {key:"deception",    en:"Deception",        it:"Inganno",           stat:"CHA"},
  {key:"history",      en:"History",          it:"Storia",            stat:"INT"},
  {key:"insight",      en:"Insight",          it:"Intuizione",        stat:"WIS"},
  {key:"intimidation", en:"Intimidation",     it:"Intimidire",        stat:"CHA"},
  {key:"investigation",en:"Investigation",    it:"Investigare",       stat:"INT"},
  {key:"medicine",     en:"Medicine",         it:"Medicina",          stat:"WIS"},
  {key:"nature",       en:"Nature",           it:"Natura",            stat:"INT"},
  {key:"perception",   en:"Perception",       it:"Percezione",        stat:"WIS"},
  {key:"performance",  en:"Performance",      it:"Esibizione",        stat:"CHA"},
  {key:"persuasion",   en:"Persuasion",       it:"Persuasione",       stat:"CHA"},
  {key:"religion",     en:"Religion",         it:"Religione",         stat:"INT"},
  {key:"sleightOfHand",en:"Sleight of Hand",  it:"Rapidità di Mano",  stat:"DEX"},
  {key:"stealth",      en:"Stealth",          it:"Furtività",         stat:"DEX"},
  {key:"survival",     en:"Survival",         it:"Sopravvivenza",     stat:"WIS"},
];

const profBonus    = (l) => Math.ceil(l/4)+1;
const mod          = (s) => Math.floor((s-10)/2);
const modStr       = (n) => n>=0?`+${n}`:`${n}`;
const genId        = ()  => Math.random().toString(36).slice(2,9);
const genInvCode   = ()  => Math.random().toString(36).slice(2,8).toUpperCase();

const DEFAULT_CHAR = {
  id:"", name:"Hero", class:"Fighter", race:"Human", level:1,
  stats:{STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10},
  hp:{current:10,max:10,temp:0}, ac:10, speed:30, initiative:0,
  spellSlots:{1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0},
  spellSlotsUsed:{1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0},
  skillProfs:{}, savingThrowProfs:{}, spellcastingStat:"INT", attackBonusExtra:0,
  inventory:[], abilities:[], spells:[], conditions:[], concentration:false, notes:"",
  actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false},
  role:"player", partyId:null,
};

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
const saveCharToDb    = async(id,data) => { await setDoc(doc(db,"characters",id),data); };
const loadCharFromDb  = async(id)      => { const s=await getDoc(doc(db,"characters",id)); return s.exists()?s.data():null; };
const saveUserProfile = async(id,data) => { await setDoc(doc(db,"users",id),data); };
const loadUserProfile = async(id)      => { const s=await getDoc(doc(db,"users",id)); return s.exists()?s.data():null; };

// Party
const createParty = async(dmUid,name) => {
  const id=genId(); const inviteCode=genInvCode();
  const p={id,name,dmUid,inviteCode,members:[],combatMonsters:[],createdAt:Date.now()};
  await setDoc(doc(db,"parties",id),p); return p;
};
const loadParty        = async(id)     => { const s=await getDoc(doc(db,"parties",id)); return s.exists()?s.data():null; };
const saveParty        = async(p)      => { await setDoc(doc(db,"parties",p.id),p); };
const loadDmParties    = async(dmUid)  => { const q=query(collection(db,"parties"),where("dmUid","==",dmUid)); const s=await getDocs(q); return s.docs.map(d=>d.data()); };
const findPartyByCode  = async(code)   => { const q=query(collection(db,"parties"),where("inviteCode","==",code.toUpperCase())); const s=await getDocs(q); return s.empty?null:s.docs[0].data(); };
const loadPartyMembers = async(uids)   => { if(!uids||!uids.length) return []; return (await Promise.all(uids.map(u=>loadCharFromDb(u)))).filter(Boolean); };

// Monsters
const saveMonsterToDb    = async(m)    => { await setDoc(doc(db,"monsters",m.id),m); };
const loadDmMonsters     = async(uid)  => { const q=query(collection(db,"monsters"),where("dmUid","==",uid)); const s=await getDocs(q); return s.docs.map(d=>d.data()); };
const deleteMonsterFromDb= async(id)   => { await deleteDoc(doc(db,"monsters",id)); };

// ─── COMPUTED BONUSES ─────────────────────────────────────────────────────────
const getSkillBonus  = (c,k) => { const s=SKILLS.find(x=>x.key===k); if(!s) return 0; return mod(c.stats[s.stat]||10)+(c.skillProfs?.[k]?profBonus(c.level||1):0); };
const getSaveBonus   = (c,s) => mod(c.stats[s]||10)+(c.savingThrowProfs?.[s]?profBonus(c.level||1):0);
const getSpellSaveDC = (c)   => 8+profBonus(c.level||1)+mod(c.stats[c.spellcastingStat||"INT"]||10);
const getAttackBonus = (c)   => profBonus(c.level||1)+mod(c.stats[c.spellcastingStat||"INT"]||10)+(c.attackBonusExtra||0);

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Lato:wght@300;400;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#0f1117;--surface:#1a1d27;--surface2:#22263a;--border:#2e3452;
    --accent:#c8963e;--accent2:#7b5ea7;--red:#c0392b;--green:#27ae60;
    --text:#e8e0d0;--muted:#7a7a9a;--radius:12px;--shadow:0 4px 24px rgba(0,0,0,0.5);
  }
  body{background:var(--bg);color:var(--text);font-family:'Lato',sans-serif;min-height:100vh;}
  h1,h2,h3{font-family:'Cinzel',serif;}
  .app{min-height:100vh;display:flex;flex-direction:column;}
  .auth-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:radial-gradient(ellipse at 50% 0%,#1e1630 0%,#0f1117 60%);}
  .auth-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:40px;width:100%;max-width:400px;box-shadow:var(--shadow);}
  .auth-box h1{font-size:2rem;color:var(--accent);text-align:center;margin-bottom:8px;letter-spacing:2px;}
  .auth-box p{color:var(--muted);text-align:center;margin-bottom:32px;font-size:0.85rem;}
  .field{margin-bottom:18px;}
  .field label{display:block;font-size:0.8rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;}
  .field input,.field select,.field textarea{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:10px 14px;border-radius:8px;font-family:'Lato',sans-serif;font-size:0.95rem;outline:none;transition:border 0.2s;}
  .field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent);}
  .field select option{background:var(--bg);}
  .field textarea{resize:vertical;min-height:70px;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-family:'Lato',sans-serif;font-weight:700;font-size:0.9rem;transition:all 0.2s;}
  .btn-primary{background:var(--accent);color:#1a1000;} .btn-primary:hover{filter:brightness(1.15);}
  .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);} .btn-ghost:hover{border-color:var(--accent);color:var(--accent);}
  .btn-danger{background:var(--red);color:#fff;} .btn-green{background:var(--green);color:#fff;}
  .btn-full{width:100%;} .btn-sm{padding:6px 12px;font-size:0.8rem;}
  .auth-switch{text-align:center;margin-top:18px;color:var(--muted);font-size:0.85rem;}
  .auth-switch span{color:var(--accent);cursor:pointer;}
  .nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:12px;height:56px;position:sticky;top:0;z-index:100;flex-wrap:wrap;}
  .nav-brand{font-family:'Cinzel',serif;font-size:1.1rem;color:var(--accent);font-weight:700;letter-spacing:1px;flex:1;white-space:nowrap;}
  .nav-tabs{display:flex;gap:4px;flex-wrap:wrap;}
  .nav-tab{background:transparent;border:none;color:var(--muted);padding:6px 12px;border-radius:6px;cursor:pointer;font-family:'Lato',sans-serif;font-size:0.82rem;font-weight:700;transition:all 0.2s;text-transform:uppercase;letter-spacing:0.5px;}
  .nav-tab.active,.nav-tab:hover{background:var(--surface2);color:var(--accent);}
  .lang-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700;transition:all 0.2s;}
  .lang-btn:hover{border-color:var(--accent);color:var(--accent);}
  .main{flex:1;padding:24px 20px;max-width:960px;margin:0 auto;width:100%;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px;}
  .card-title{font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;font-family:'Cinzel',serif;}
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .section-title{font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;font-family:'Cinzel',serif;}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .sep{height:1px;background:var(--border);margin:16px 0;}
  .stat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;}
  .stat-box{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center;cursor:pointer;transition:border 0.2s;}
  .stat-box:hover{border-color:var(--accent);}
  .stat-label{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}
  .stat-mod{font-size:1.4rem;font-weight:700;color:var(--accent);font-family:'Cinzel',serif;}
  .stat-score{font-size:0.75rem;color:var(--muted);margin-top:2px;}
  .quick-stats{display:flex;gap:12px;flex-wrap:wrap;}
  .quick-stat-box{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;text-align:center;flex:1;min-width:80px;}
  .quick-stat-val{font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;line-height:1;}
  .quick-stat-val.green{color:var(--green);} .quick-stat-val.blue{color:#5dade2;} .quick-stat-val.purple{color:#9b7be0;}
  .quick-stat-label{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
  .hp-bar{height:12px;background:var(--bg);border-radius:99px;overflow:hidden;margin-bottom:6px;border:1px solid var(--border);}
  .hp-fill{height:100%;border-radius:99px;transition:width 0.4s;}
  .hp-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px;}
  .hp-nums{font-size:1.3rem;font-weight:700;font-family:'Cinzel',serif;}
  .quick-hp{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  .quick-hp input{width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:6px;font-size:0.9rem;text-align:center;}
  .badges{display:flex;flex-wrap:wrap;gap:6px;}
  .badge{padding:4px 10px;border-radius:99px;font-size:0.75rem;font-weight:700;}
  .badge-red{background:rgba(192,57,43,0.15);color:#e74c3c;border:1px solid rgba(192,57,43,0.3);}
  .badge-purple{background:rgba(123,94,167,0.15);color:#9b7be0;border:1px solid rgba(123,94,167,0.3);}
  .badge-green{background:rgba(39,174,96,0.15);color:#2ecc71;border:1px solid rgba(39,174,96,0.3);}
  .skill-list{display:flex;flex-direction:column;gap:2px;}
  .skill-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;cursor:pointer;transition:background 0.15s;user-select:none;}
  .skill-row:hover{background:var(--surface2);}
  .skill-prof-dot{width:11px;height:11px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;transition:all 0.2s;}
  .skill-prof-dot.active{background:var(--accent);border-color:var(--accent);}
  .skill-name{flex:1;font-size:0.85rem;} .skill-stat{font-size:0.7rem;color:var(--muted);width:28px;text-align:right;}
  .skill-bonus{font-family:'Cinzel',serif;font-size:0.9rem;font-weight:700;width:30px;text-align:right;}
  .skill-bonus.prof{color:var(--accent);}
  .action-row{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
  .action-btn{padding:12px 6px;border-radius:10px;border:2px solid;background:transparent;cursor:pointer;text-align:center;transition:all 0.25s;font-family:'Cinzel',serif;font-size:0.68rem;line-height:1.3;}
  .action-btn.consumed{background:#1a1a1a!important;border-color:#333!important;color:#444!important;filter:grayscale(1);}
  .action-btn.consumed .action-label{text-decoration:line-through;text-decoration-color:#555;color:#484848;}
  .action-btn.consumed .action-dot{background:#333!important;}
  .action-dot{width:8px;height:8px;border-radius:50%;margin:0 auto 6px;}
  .action-status{font-size:0.6rem;margin-top:3px;}
  .ability-list{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
  .ability-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:12px;}
  .ability-card-info{flex:1;min-width:0;} .ability-card-name{font-weight:700;font-size:0.95rem;margin-bottom:3px;}
  .ability-card-desc{font-size:0.82rem;color:var(--muted);line-height:1.5;}
  .ability-card-meta{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;}
  .action-tag{padding:3px 9px;border-radius:99px;font-size:0.7rem;font-weight:700;white-space:nowrap;border:1px solid;}
  .combat-ability{background:var(--bg);border:2px solid var(--border);border-radius:10px;padding:12px 14px;cursor:pointer;transition:all 0.18s;}
  .combat-ability:hover:not(.depleted){transform:translateY(-1px);filter:brightness(1.1);}
  .combat-ability.depleted{opacity:0.4;cursor:not-allowed;}
  .combat-ability-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;}
  .combat-ability-name{font-weight:700;font-size:0.92rem;flex:1;}
  .combat-ability-desc{font-size:0.8rem;color:var(--muted);line-height:1.4;}
  .spell-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;}
  .spell-slot{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;}
  .spell-slot-label{font-size:0.7rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;}
  .spell-pips{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}
  .pip{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--border);cursor:pointer;transition:all 0.2s;}
  .pip.full{background:var(--accent2);border-color:var(--accent2);}
  .slot-controls{display:flex;gap:4px;align-items:center;}
  .slot-btn{background:var(--surface2);border:none;color:var(--text);width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;}
  .inv-list{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}
  .inv-item{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;}
  .inv-item span{flex:1;font-size:0.9rem;} .inv-item button{background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem;}
  .inv-input-row{display:flex;gap:8px;}
  .inv-input{flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-family:'Lato',sans-serif;font-size:0.9rem;}
  .inv-input:focus{outline:none;border-color:var(--accent);}
  .cond-grid{display:flex;flex-wrap:wrap;gap:6px;}
  .cond-chip{padding:4px 10px;border-radius:99px;font-size:0.75rem;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--muted);transition:all 0.2s;}
  .cond-chip.active{background:rgba(192,57,43,0.15);color:#e74c3c;border-color:rgba(192,57,43,0.4);}
  .notes-area{width:100%;min-height:100px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:12px;border-radius:8px;font-family:'Lato',sans-serif;font-size:0.9rem;resize:vertical;}
  .notes-area:focus{outline:none;border-color:var(--accent);}
  .init-list{display:flex;flex-direction:column;gap:8px;}
  .init-item{display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;flex-wrap:wrap;}
  .init-num{font-family:'Cinzel',serif;font-size:1.2rem;color:var(--accent);width:36px;text-align:center;}
  .init-name{flex:1;font-weight:700;min-width:80px;}
  .char-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:12px;}
  .char-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;}
  .char-card-name{font-family:'Cinzel',serif;font-size:1rem;color:var(--accent);margin-bottom:4px;}
  .char-card-sub{font-size:0.8rem;color:var(--muted);margin-bottom:10px;}
  .char-card-stats{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;}
  .char-card-stat{text-align:center;} .char-card-stat-val{font-size:1.1rem;font-weight:700;}
  .char-card-stat-label{font-size:0.65rem;color:var(--muted);}
  .char-card-clickable{cursor:pointer;transition:border 0.2s,transform 0.15s;}
  .char-card-clickable:hover{border-color:var(--accent);transform:translateY(-2px);}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px;}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;width:100%;max-width:480px;box-shadow:var(--shadow);max-height:90vh;overflow-y:auto;}
  .modal h3{font-family:'Cinzel',serif;color:var(--accent);margin-bottom:16px;}
  .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;}
  .slot-option{display:flex;align-items:center;justify-content:space-between;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;cursor:pointer;transition:border 0.2s;}
  .slot-option:hover{border-color:var(--accent2);}
  .slot-option.selected{border-color:var(--accent2);background:rgba(123,94,167,0.1);}
  .char-header{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;}
  .char-info{flex:1;min-width:200px;}
  .char-name{font-family:'Cinzel',serif;font-size:1.8rem;color:var(--accent);cursor:pointer;}
  .char-name:hover{text-decoration:underline dotted;}
  .char-sub{color:var(--muted);font-size:0.9rem;margin-top:4px;}
  .meta-grid{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;}
  .meta-item{text-align:center;} .meta-label{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
  .conc-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;}
  .toggle{width:40px;height:22px;border-radius:99px;border:2px solid var(--border);background:var(--bg);position:relative;transition:all 0.2s;}
  .toggle.on{background:var(--accent2);border-color:var(--accent2);}
  .toggle::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left 0.2s;}
  .toggle.on::after{left:20px;}
  .warn-box{background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.35);border-radius:8px;padding:10px 14px;color:#e74c3c;font-size:0.85rem;font-weight:700;margin-bottom:14px;}
  .no-char{text-align:center;padding:60px 20px;}
  .no-char h2{font-family:'Cinzel',serif;color:var(--accent);margin-bottom:12px;}
  .loading{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg);font-family:'Cinzel',serif;color:var(--accent);font-size:1.2rem;}
  .dm-banner{background:rgba(123,94,167,0.15);border:1px solid rgba(123,94,167,0.4);border-radius:10px;padding:12px 16px;color:#9b7be0;font-size:0.85rem;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .dm-back-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:8px;cursor:pointer;font-family:'Cinzel',serif;font-size:0.8rem;font-weight:700;transition:all 0.2s;white-space:nowrap;}
  .dm-back-btn:hover{border-color:var(--accent2);color:var(--accent2);}
  .party-list{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}
  .party-item{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:border 0.2s;}
  .party-item:hover{border-color:var(--accent);}
  .party-item.active-party{border-color:var(--accent);background:rgba(200,150,62,0.06);}
  .party-item-name{font-family:'Cinzel',serif;font-size:1rem;color:var(--accent);flex:1;}
  .party-item-meta{font-size:0.78rem;color:var(--muted);}
  .invite-code-box{background:var(--bg);border:2px dashed var(--accent2);border-radius:10px;padding:16px;text-align:center;margin:12px 0;}
  .invite-code{font-family:'Cinzel',serif;font-size:2rem;font-weight:700;color:var(--accent2);letter-spacing:8px;}
  .invite-hint{font-size:0.78rem;color:var(--muted);margin-top:6px;}
  .member-list{display:flex;flex-direction:column;gap:6px;}
  .member-row{display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;flex-wrap:wrap;}
  .member-name{flex:1;font-size:0.9rem;font-weight:700;min-width:120px;}
  .member-class{font-size:0.78rem;color:var(--muted);}
  .monster-card{background:var(--bg);border:1px solid rgba(192,57,43,0.4);border-radius:10px;padding:14px;}
  .monster-card-name{font-family:'Cinzel',serif;font-size:1rem;color:#e74c3c;margin-bottom:2px;}
  .monster-card-sub{font-size:0.78rem;color:var(--muted);margin-bottom:8px;}
  .monster-banner{background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.4);border-radius:10px;padding:12px 16px;color:#e74c3c;font-size:0.85rem;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .instance-row{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid rgba(192,57,43,0.3);border-radius:8px;padding:8px 12px;margin-bottom:6px;flex-wrap:wrap;}
  .instance-name{font-size:0.9rem;font-weight:700;color:#e74c3c;min-width:100px;}
  .vis-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.75rem;color:var(--muted);white-space:nowrap;user-select:none;}
  .avatar-portrait{width:120px;height:120px;border-radius:12px;object-fit:cover;border:2px solid var(--border);flex-shrink:0;}
  .avatar-portrait-monster{width:120px;height:120px;border-radius:12px;object-fit:cover;border:2px solid rgba(192,57,43,0.5);flex-shrink:0;}
  .avatar-placeholder{width:120px;height:120px;border-radius:12px;border:2px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:6px;flex-shrink:0;transition:border 0.2s;background:var(--bg);}
  .avatar-placeholder:hover{border-color:var(--accent);}
  .avatar-placeholder-icon{font-size:2rem;opacity:0.3;}
  .avatar-placeholder-text{font-size:0.65rem;color:var(--muted);text-align:center;padding:0 8px;}
  .token{width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border);flex-shrink:0;}
  .token-monster{width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(192,57,43,0.6);flex-shrink:0;}
  .token-placeholder{width:36px;height:36px;border-radius:50%;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;background:var(--bg);}
  .img-picker-wrap{display:flex;flex-direction:column;gap:8px;}
  .img-picker-tabs{display:flex;gap:6px;}
  .img-picker-tab{background:var(--bg);border:1px solid var(--border);color:var(--muted);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:700;}
  .img-picker-tab.active{border-color:var(--accent);color:var(--accent);}
  .img-picker-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
  @media(max-width:640px){
    .stat-grid{grid-template-columns:repeat(3,1fr);}
    .action-row{grid-template-columns:repeat(3,1fr);}
    .two-col{grid-template-columns:1fr;}
    .char-name{font-size:1.3rem;}
  }
`;

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const T = {
  en:{
    appName:"D&D Companion", login:"Sign In", register:"Create Account",
    email:"Email", password:"Password", role:"Role", player:"Player", dm:"Dungeon Master",
    logout:"Logout", sheet:"Sheet", combat:"Combat", parties:"Parties", currentParty:"Your Party",
    initiative:"Initiative", conditions:"Conditions", concentration:"Concentration",
    resetTurn:"Reset Turn", hp:"Hit Points", temp:"Temp HP", ac:"AC", speed:"Speed",
    spellSlots:"Spell Slots", inventory:"Inventory", notes:"Notes", addItem:"Add item...",
    save:"Save", cancel:"Cancel", heal:"Heal", damage:"Damage", amount:"Amount",
    dmView:"DM Overview", allChars:"All Characters", orderInit:"Combat Order", noChars:"No characters yet.",
    charName:"Character Name", class:"Class", race:"Race", level:"Level",
    createChar:"Create Character", editChar:"Edit Character",
    used:"Used", available:"Available", conc:"Concentrating",
    abilities:"Special Abilities", spells:"Spells",
    addAbility:"Add Ability", addSpell:"Add Spell", editAbility:"Edit Ability", editSpell:"Edit Spell",
    abilityName:"Ability Name", spellName:"Spell Name", description:"Description",
    actionRequired:"Action Required", spellLevel:"Spell Level",
    useAbility:"Use Ability", useSpell:"Cast Spell",
    actionUsed:"Action already used — it will be marked again!", slotUsed:"Choose spell slot:",
    slotAvailable:"available", noSlots:"No slots available.",
    confirm:"Confirm", noAbilities:"No abilities added yet.", noSpells:"No spells added yet.",
    cantUse:"No slots!", reactivateTitle:"Reactivate Action?",
    reactivateMsg:"This action is marked as used. Mark it as available again?", reactivate:"Reactivate",
    skills:"Skills", savingThrows:"Saving Throws",
    proficiencyBonus:"Proficiency Bonus", attackBonus:"Attack Bonus",
    spellSaveDC:"Spell Save DC", spellcastingStat:"Spellcasting Ability",
    attackBonusExtra:"Extra Attack Bonus", displayName:"Display Name",
    backToDm:"← Back to DM", inspecting:"Inspecting:", dmEditBanner:"Editing as DM — changes save immediately.",
    myParties:"My Parties", createParty:"Create Party", partyName:"Party Name",
    noParties:"No parties yet. Create your first one!",
    inviteCode:"Invite Code", copyCode:"Copy", codeCopied:"Copied!",
    members:"Members", noMembers:"No players yet. Share the invite code!",
    kickPlayer:"Remove", deleteParty:"Delete Party", confirmDeleteParty:"Delete this party?",
    joinParty:"Join a Party", joinBtn:"Join", joinError:"Code not found. Try again.",
    leaveParty:"Leave Party", confirmLeave:"Leave this party?", partyMembers:"Party Members",
    noParty:"You are not in any party.", useInCombat:"Use in Combat ⚔",
    monsters:"Monsters", myMonsters:"My Monsters", createMonster:"Create Monster",
    editMonster:"Edit Monster", monsterName:"Monster Name", monsterType:"Type (e.g. Humanoid)",
    noMonsters:"No monsters yet. Create your first one!",
    addToCombat:"+ Add to Combat", removeFromCombat:"Remove from Combat",
    combatInstances:"Active in Combat", showHp:"Show HP", hideHp:"HP Hidden", hpVisible:"HP Visible",
    monsterSheet:"Monster Sheet", monsterLib:"Monster Library",
  },
  it:{
    appName:"D&D Companion", login:"Accedi", register:"Crea Account",
    email:"Email", password:"Password", role:"Ruolo", player:"Giocatore", dm:"Dungeon Master",
    logout:"Esci", sheet:"Scheda", combat:"Combattimento", parties:"Party", currentParty:"Il Tuo Party",
    initiative:"Iniziativa", conditions:"Condizioni", concentration:"Concentrazione",
    resetTurn:"Reset Turno", hp:"Punti Ferita", temp:"PF Temp", ac:"CA", speed:"Velocità",
    spellSlots:"Slot Incantesimo", inventory:"Inventario", notes:"Note", addItem:"Aggiungi oggetto...",
    save:"Salva", cancel:"Annulla", heal:"Cura", damage:"Danno", amount:"Quantità",
    dmView:"Vista DM", allChars:"Tutti i Personaggi", orderInit:"Ordine Iniziativa", noChars:"Nessun personaggio.",
    charName:"Nome Personaggio", class:"Classe", race:"Razza", level:"Livello",
    createChar:"Crea Personaggio", editChar:"Modifica Personaggio",
    used:"Usata", available:"Disponibile", conc:"Concentrazione",
    abilities:"Abilità Speciali", spells:"Incantesimi",
    addAbility:"Aggiungi Abilità", addSpell:"Aggiungi Incantesimo", editAbility:"Modifica Abilità", editSpell:"Modifica Incantesimo",
    abilityName:"Nome Abilità", spellName:"Nome Incantesimo", description:"Descrizione",
    actionRequired:"Azione Richiesta", spellLevel:"Livello Incantesimo",
    useAbility:"Usa Abilità", useSpell:"Lancia Incantesimo",
    actionUsed:"Azione già usata — verrà segnata di nuovo!", slotUsed:"Scegli lo slot:",
    slotAvailable:"disponibili", noSlots:"Nessuno slot disponibile.",
    confirm:"Conferma", noAbilities:"Nessuna abilità aggiunta.", noSpells:"Nessun incantesimo aggiunto.",
    cantUse:"Slot esauriti!", reactivateTitle:"Riattivare Azione?",
    reactivateMsg:"Questa azione è già stata usata. Segnarla di nuovo come disponibile?", reactivate:"Riattiva",
    skills:"Abilità", savingThrows:"Tiri Salvezza",
    proficiencyBonus:"Bonus Competenza", attackBonus:"Bonus Attacco",
    spellSaveDC:"CD Incantesimi", spellcastingStat:"Caratteristica Magia",
    attackBonusExtra:"Bonus Attacco Extra", displayName:"Nome da mostrare",
    backToDm:"← Torna al DM", inspecting:"Stai guardando:", dmEditBanner:"Modifica come DM — le modifiche vengono salvate immediatamente.",
    myParties:"I Miei Party", createParty:"Crea Party", partyName:"Nome Party",
    noParties:"Nessun party ancora. Creane uno!",
    inviteCode:"Codice Invito", copyCode:"Copia", codeCopied:"Copiato!",
    members:"Giocatori", noMembers:"Nessun giocatore. Condividi il codice invito!",
    kickPlayer:"Rimuovi", deleteParty:"Elimina Party", confirmDeleteParty:"Eliminare questo party?",
    joinParty:"Unisciti a un Party", joinBtn:"Entra", joinError:"Codice non trovato. Riprova.",
    leaveParty:"Lascia Party", confirmLeave:"Vuoi lasciare questo party?", partyMembers:"Membri del Party",
    noParty:"Non sei in nessun party.", useInCombat:"Usa in Combattimento ⚔",
    monsters:"Mostri", myMonsters:"I Miei Mostri", createMonster:"Crea Mostro",
    editMonster:"Modifica Mostro", monsterName:"Nome Mostro", monsterType:"Tipo (es. Umanoide)",
    noMonsters:"Nessun mostro ancora. Creane uno!",
    addToCombat:"+ Aggiungi al Combattimento", removeFromCombat:"Rimuovi dal Combattimento",
    combatInstances:"Attivi in Combattimento", showHp:"Mostra HP", hideHp:"HP Nascosti", hpVisible:"HP Visibili",
    monsterSheet:"Scheda Mostro", monsterLib:"Libreria Mostri",
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const actionLabel = (key,lang) => { const i=ACTION_KEYS.indexOf(key); return i>=0?(lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]):key; };
const actionColor = (key) => ACTION_COLORS[key]||{bg:"rgba(255,255,255,0.05)",border:"#444",text:"#aaa"};
const numInput = (val,onChange,extra={}) => (
  <input type="number" value={val} onChange={e=>onChange(+e.target.value)}
    style={{background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",
      padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1.4rem",
      textAlign:"center",fontWeight:700,outline:"none",width:60,...extra.style}}/>
);

function ActionTag({actionKey,lang}){
  const c=actionColor(actionKey);
  return <span className="action-tag" style={{background:c.bg,borderColor:c.border,color:c.text}}>{actionLabel(actionKey,lang)}</span>;
}
function HpBar({current,max}){
  const pct=max>0?Math.max(0,Math.min(100,(current/max)*100)):0;
  const color=pct>50?"#27ae60":pct>25?"#f39c12":"#c0392b";
  return <div className="hp-bar"><div className="hp-fill" style={{width:`${pct}%`,background:color}}/></div>;
}
function StatBox({stat,value,lang,onClick}){
  return(
    <div className="stat-box" onClick={()=>onClick&&onClick(stat)}>
      <div className="stat-label">{lang==="it"?STAT_IT[stat]:stat}</div>
      <div className="stat-mod">{modStr(mod(value||10))}</div>
      <div className="stat-score">{value||10}</div>
    </div>
  );
}
function SkillsSection({char,lang,onToggle}){
  const pb=profBonus(char.level||1);
  return(
    <div className="card">
      <div className="card-title">{T[lang].skills} <span style={{float:"right",color:"var(--muted)",fontFamily:"Lato,sans-serif",fontWeight:400,fontSize:"0.7rem",textTransform:"none",letterSpacing:0}}>+{pb}</span></div>
      <div className="skill-list">
        {SKILLS.map(s=>{
          const isProf=!!(char.skillProfs?.[s.key]);
          return(
            <div key={s.key} className="skill-row" onClick={()=>onToggle(s.key)}>
              <div className={`skill-prof-dot ${isProf?"active":""}`}/>
              <span className="skill-name">{lang==="it"?s.it:s.en}</span>
              <span className="skill-stat">{lang==="it"?STAT_IT[s.stat]:s.stat}</span>
              <span className={`skill-bonus ${isProf?"prof":""}`}>{modStr(getSkillBonus(char,s.key))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function SavingThrowsSection({char,lang,onToggle}){
  const pb=profBonus(char.level||1);
  return(
    <div className="card">
      <div className="card-title">{T[lang].savingThrows} <span style={{float:"right",color:"var(--muted)",fontFamily:"Lato,sans-serif",fontWeight:400,fontSize:"0.7rem",textTransform:"none",letterSpacing:0}}>+{pb}</span></div>
      <div className="skill-list">
        {STATS.map(stat=>{
          const isProf=!!(char.savingThrowProfs?.[stat]);
          return(
            <div key={stat} className="skill-row" onClick={()=>onToggle(stat)}>
              <div className={`skill-prof-dot ${isProf?"active":""}`}/>
              <span className="skill-name">{lang==="it"?STAT_IT[stat]:stat}</span>
              <span className={`skill-bonus ${isProf?"prof":""}`}>{modStr(getSaveBonus(char,stat))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function EditStatModal({stat,value,lang,onSave,onClose}){
  const [val,setVal]=useState(value);
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{lang==="it"?STAT_IT[stat]:stat}</h3>
        <div className="field"><label>Score</label><input type="number" min={1} max={30} value={val} onChange={e=>setVal(+e.target.value)} autoFocus/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{T[lang].cancel}</button>
          <button className="btn btn-primary" onClick={()=>onSave(val)}>{T[lang].save}</button>
        </div>
      </div>
    </div>
  );
}
function CreateCharModal({lang,char,onSave,onClose}){
  const t=T[lang];
  const [form,setForm]=useState({name:char?.name||"",class:char?.class||"Fighter",race:char?.race||"Human",level:char?.level||1,hpMax:char?.hp?.max||10});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{char?.name?t.editChar:t.createChar}</h3>
        <div className="field"><label>{t.charName}</label><input value={form.name} onChange={e=>set("name",e.target.value)} autoFocus/></div>
        <div className="field"><label>{t.class}</label><input value={form.class} onChange={e=>set("class",e.target.value)}/></div>
        <div className="field"><label>{t.race}</label><input value={form.race} onChange={e=>set("race",e.target.value)}/></div>
        <div className="field"><label>{t.level}</label><input type="number" min={1} max={20} value={form.level} onChange={e=>set("level",+e.target.value)}/></div>
        <div className="field"><label>Max HP</label><input type="number" min={1} value={form.hpMax} onChange={e=>set("hpMax",+e.target.value)}/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-primary" onClick={()=>form.name&&onSave(form)}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}
function AbilityModal({lang,type,onSave,onClose,existing}){
  const t=T[lang]; const isSpell=type==="spell"; const isEdit=!!existing;
  const [form,setForm]=useState(existing
    ?{name:existing.name||"",desc:existing.desc||"",actionType:existing.actionType||"action",spellLevel:existing.spellLevel??1}
    :{name:"",desc:"",actionType:"action",spellLevel:1}
  );
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{isEdit?(isSpell?t.editSpell:t.editAbility):(isSpell?t.addSpell:t.addAbility)}</h3>
        <div className="field"><label>{isSpell?t.spellName:t.abilityName}</label><input value={form.name} onChange={e=>set("name",e.target.value)} placeholder={isSpell?"Fireball":"Second Wind"} autoFocus/></div>
        <div className="field"><label>{t.description}</label><textarea value={form.desc} onChange={e=>set("desc",e.target.value)}/></div>
        <div className="field"><label>{t.actionRequired}</label>
          <select value={form.actionType} onChange={e=>set("actionType",e.target.value)}>
            {ACTION_KEYS.map((k,i)=><option key={k} value={k}>{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</option>)}
          </select>
        </div>
        {isSpell&&<div className="field"><label>{t.spellLevel}</label>
          <select value={form.spellLevel} onChange={e=>set("spellLevel",+e.target.value)}>
            <option value={0}>{lang==="it"?"Trucchetto (Lv 0)":"Cantrip (Lv 0)"}</option>
            {SPELL_SLOTS.map(l=><option key={l} value={l}>{lang==="it"?`Livello ${l}`:`Level ${l}`}</option>)}
          </select>
        </div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-primary" onClick={()=>form.name&&onSave({...form,id:existing?.id||genId(),spellLevel:Number(form.spellLevel)})}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}
function UseModal({lang,item,type,char,onConfirm,onClose}){
  const t=T[lang]; const isSpell=type==="spell";
  const spellLv=Number(item.spellLevel??0); const needsSlot=isSpell&&spellLv>0;
  const [chosenSlot,setChosenSlot]=useState(null);
  const c=actionColor(item.actionType);
  const slots=char.spellSlots||{}; const used=char.spellSlotsUsed||{};
  const avail=needsSlot?SPELL_SLOTS.filter(lv=>lv>=spellLv&&((Number(slots[lv])||0)-(Number(used[lv])||0))>0):[];
  const canConfirm=!needsSlot||(avail.length>0&&chosenSlot!==null);
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{isSpell?t.useSpell:t.useAbility}</h3>
        <div style={{background:"var(--bg)",border:`1px solid ${c.border}`,borderRadius:10,padding:14,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:"1rem",marginBottom:6}}>{item.name}</div>
          {item.desc&&<div style={{fontSize:"0.85rem",color:"var(--muted)",lineHeight:1.5,marginBottom:10}}>{item.desc}</div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <ActionTag actionKey={item.actionType} lang={lang}/>
            {isSpell&&spellLv>0&&<span style={{fontSize:"0.75rem",color:"var(--accent2)",fontWeight:700,background:"rgba(123,94,167,0.12)",padding:"3px 9px",borderRadius:99,border:"1px solid rgba(123,94,167,0.3)"}}>{lang==="it"?`Livello ${spellLv}`:`Level ${spellLv}`}</span>}
          </div>
        </div>
        {char.actions?.[item.actionType]&&<div className="warn-box">⚠ {t.actionUsed}</div>}
        {needsSlot&&<div>
          <div style={{fontSize:"0.78rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>{t.slotUsed}</div>
          {avail.length===0
            ?<div style={{color:"#e74c3c",fontSize:"0.9rem",marginBottom:8}}>{t.noSlots}</div>
            :avail.map(lv=>{
              const n=(Number(slots[lv])||0)-(Number(used[lv])||0);
              return <div key={lv} className={`slot-option ${chosenSlot===lv?"selected":""}`} onClick={()=>setChosenSlot(lv)}>
                <span style={{fontFamily:"Cinzel,serif",fontWeight:700}}>{lang==="it"?`Livello ${lv}`:`Level ${lv}`}</span>
                <span style={{fontSize:"0.8rem",color:"var(--muted)"}}>{n} {t.slotAvailable}</span>
              </div>;
            })
          }
        </div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-primary" style={!canConfirm?{opacity:0.4,cursor:"not-allowed"}:{}} onClick={()=>canConfirm&&onConfirm(chosenSlot)}>{t.confirm}</button>
        </div>
      </div>
    </div>
  );
}
function MonsterFormModal({lang,existing,onSave,onClose}){
  const t=T[lang]; const isEdit=!!existing;
  const [form,setForm]=useState(existing
    ?{name:existing.name||"",type:existing.type||"",hpMax:existing.hp?.max||10,ac:existing.ac||10,speed:existing.speed||30,initiative:existing.initiative||0,stats:{...existing.stats},notes:existing.notes||""}
    :{name:"",type:"",hpMax:10,ac:10,speed:30,initiative:0,stats:{STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10},notes:""}
  );
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const setStat=(s,v)=>setForm(f=>({...f,stats:{...f.stats,[s]:v}}));
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3 style={{color:"#e74c3c"}}>{isEdit?t.editMonster:t.createMonster}</h3>
        <div className="field"><label>{t.monsterName}</label><input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Goblin" autoFocus/></div>
        <div className="field"><label>{t.monsterType}</label><input value={form.type} onChange={e=>set("type",e.target.value)} placeholder={lang==="it"?"Umanoide":"Humanoid"}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <div className="field"><label>Max HP</label><input type="number" min={1} value={form.hpMax} onChange={e=>set("hpMax",+e.target.value)}/></div>
          <div className="field"><label>{t.ac}</label><input type="number" min={0} value={form.ac} onChange={e=>set("ac",+e.target.value)}/></div>
          <div className="field"><label>{t.speed}</label><input type="number" min={0} value={form.speed} onChange={e=>set("speed",+e.target.value)}/></div>
        </div>
        <div className="field"><label>{t.initiative}</label><input type="number" value={form.initiative} onChange={e=>set("initiative",+e.target.value)}/></div>
        <div className="field">
          <label>{lang==="it"?"Caratteristiche":"Ability Scores"}</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginTop:4}}>
            {STATS.map(s=>(
              <div key={s} style={{textAlign:"center"}}>
                <div style={{fontSize:"0.65rem",color:"var(--muted)",marginBottom:2}}>{lang==="it"?STAT_IT[s]:s}</div>
                <input type="number" min={1} max={30} value={form.stats[s]} onChange={e=>setStat(s,+e.target.value)}
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 2px",borderRadius:6,textAlign:"center",fontSize:"0.9rem",outline:"none"}}/>
              </div>
            ))}
          </div>
        </div>
        <div className="field"><label>{t.notes}</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)}/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-danger" onClick={()=>form.name&&onSave(form)}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PARTY MANAGER (DM) ───────────────────────────────────────────────────────
function DmPartyManager({lang,currentUser,activePartyId,onSelectParty}){
  const t=T[lang];
  const [parties,setParties]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showCreate,setShowCreate]=useState(false);
  const [newName,setNewName]=useState("");
  const [selected,setSelected]=useState(null);
  const [members,setMembers]=useState([]);
  const [copied,setCopied]=useState(false);

  const refresh=useCallback(async()=>{
    const ps=await loadDmParties(currentUser.uid);
    ps.sort((a,b)=>b.createdAt-a.createdAt);
    setParties(ps); setLoading(false);
  },[currentUser.uid]);

  useEffect(()=>{ refresh(); },[refresh]);
  useEffect(()=>{ if(!selected) return; loadPartyMembers(selected.members||[]).then(setMembers); },[selected]);

  const handleCreate=async()=>{
    if(!newName.trim()) return;
    const p=await createParty(currentUser.uid,newName.trim());
    setNewName(""); setShowCreate(false); await refresh(); setSelected(p);
  };
  const handleKick=async(uid)=>{
    const upd={...selected,members:(selected.members||[]).filter(m=>m!==uid)};
    await saveParty(upd);
    const c=await loadCharFromDb(uid); if(c) await saveCharToDb(uid,{...c,partyId:null});
    setSelected(upd); setMembers(prev=>prev.filter(m=>m.id!==uid));
  };
  const handleDelete=async()=>{
    if(!window.confirm(t.confirmDeleteParty)) return;
    for(const uid of (selected.members||[])){ const c=await loadCharFromDb(uid); if(c) await saveCharToDb(uid,{...c,partyId:null}); }
    await deleteDoc(doc(db,"parties",selected.id));
    setSelected(null); setMembers([]); refresh();
  };

  if(loading) return <div style={{color:"var(--muted)",padding:20}}>...</div>;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <h2 style={{fontFamily:"Cinzel,serif",color:"var(--accent)",fontSize:"1.1rem"}}>{t.myParties}</h2>
        <button className="btn btn-primary btn-sm" onClick={()=>setShowCreate(true)}>+ {t.createParty}</button>
      </div>
      {showCreate&&(
        <div className="card" style={{marginBottom:12}}>
          <div className="field" style={{marginBottom:10}}>
            <label>{t.partyName}</label>
            <input value={newName} onChange={e=>setNewName(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&handleCreate()}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setShowCreate(false);setNewName("");}}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>{t.createParty}</button>
          </div>
        </div>
      )}
      {parties.length===0&&!showCreate&&<p style={{color:"var(--muted)",fontSize:"0.9rem",marginBottom:16}}>{t.noParties}</p>}
      <div className="party-list">
        {parties.map(p=>(
          <div key={p.id} className={`party-item ${selected?.id===p.id?"active-party":""}`} onClick={()=>setSelected(p)}>
            <div style={{flex:1}}>
              <div className="party-item-name">{p.name}</div>
              <div className="party-item-meta">{(p.members||[]).length} {lang==="it"?"giocatori":"players"} · <strong style={{color:"var(--accent2)"}}>{p.inviteCode}</strong></div>
            </div>
            {activePartyId===p.id&&<span className="badge badge-green">{lang==="it"?"Attivo":"Active"}</span>}
          </div>
        ))}
      </div>
      {selected&&(
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:8}}>
            <h3 style={{fontFamily:"Cinzel,serif",color:"var(--accent)"}}>{selected.name}</h3>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="btn btn-primary btn-sm" onClick={()=>onSelectParty(selected)}>{t.useInCombat}</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>{t.deleteParty}</button>
            </div>
          </div>
          <div className="invite-code-box">
            <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.inviteCode}</div>
            <div className="invite-code">{selected.inviteCode}</div>
            <div className="invite-hint">{lang==="it"?"Condividi con i tuoi giocatori":"Share with your players"}</div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:10}} onClick={()=>{navigator.clipboard.writeText(selected.inviteCode);setCopied(true);setTimeout(()=>setCopied(false),2000);}}>
              {copied?t.codeCopied:t.copyCode}
            </button>
          </div>
          <div style={{marginTop:16}}>
            <div style={{fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>{t.members}</div>
            {members.length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noMembers}</p>:(
              <div className="member-list">
                {members.map(m=>(
                  <div key={m.id} className="member-row">
                    <div style={{flex:1}}><div className="member-name">{m.name}</div><div className="member-class">{m.race} · {m.class} · Lv {m.level}</div></div>
                    <div style={{width:80}}><HpBar current={m.hp?.current||0} max={m.hp?.max||1}/></div>
                    <span style={{fontSize:"0.8rem",color:"var(--muted)",minWidth:50,textAlign:"center"}}>{m.hp?.current||0}/{m.hp?.max||0}</span>
                    <button className="btn btn-danger btn-sm" onClick={()=>handleKick(m.id)}>{t.kickPlayer}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PLAYER PARTY PANEL ───────────────────────────────────────────────────────
function PlayerPartyPanel({lang,currentUser,char,onCharUpdate}){
  const t=T[lang];
  const [code,setCode]=useState(""); const [err,setErr]=useState(""); const [joining,setJoining]=useState(false);
  const [party,setParty]=useState(null); const [members,setMembers]=useState([]); const [loading,setLoading]=useState(true);

  const refresh=useCallback(async()=>{
    if(char?.partyId){ const p=await loadParty(char.partyId); setParty(p||null); if(p){ const ms=await loadPartyMembers(p.members||[]); setMembers(ms); } }
    else{ setParty(null); setMembers([]); }
    setLoading(false);
  },[char?.partyId]);

  useEffect(()=>{ refresh(); },[refresh]);

  const handleJoin=async()=>{
    if(!code.trim()) return; setJoining(true); setErr("");
    const found=await findPartyByCode(code.trim());
    if(!found){ setErr(t.joinError); setJoining(false); return; }
    const upd={...found,members:[...new Set([...(found.members||[]),currentUser.uid])]};
    await saveParty(upd);
    const nc={...char,partyId:found.id}; await saveCharToDb(currentUser.uid,nc); onCharUpdate(nc);
    setCode(""); setJoining(false); refresh();
  };
  const handleLeave=async()=>{
    if(!window.confirm(t.confirmLeave)) return;
    if(party){ await saveParty({...party,members:(party.members||[]).filter(m=>m!==currentUser.uid)}); }
    const nc={...char,partyId:null}; await saveCharToDb(currentUser.uid,nc); onCharUpdate(nc);
    setParty(null); setMembers([]);
  };

  if(loading) return <div style={{color:"var(--muted)",padding:20}}>...</div>;
  if(!party) return(
    <div className="card">
      <div className="card-title">{t.joinParty}</div>
      <p style={{color:"var(--muted)",fontSize:"0.85rem",marginBottom:16}}>{t.noParty}</p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input style={{flex:1,minWidth:140,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"10px 14px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.95rem",outline:"none",textTransform:"uppercase",letterSpacing:4,fontWeight:700}}
          value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ABCDEF" maxLength={6} onKeyDown={e=>e.key==="Enter"&&handleJoin()}/>
        <button className="btn btn-primary" onClick={handleJoin} style={{opacity:joining?0.6:1}}>⚔ {t.joinBtn}</button>
      </div>
      {err&&<div style={{color:"#e74c3c",fontSize:"0.85rem",marginTop:8}}>{err}</div>}
    </div>
  );
  return(
    <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div className="card-title" style={{marginBottom:2}}>{t.currentParty}</div><div style={{fontFamily:"Cinzel,serif",fontSize:"1.2rem",color:"var(--accent)"}}>{party.name}</div></div>
        <button className="btn btn-ghost btn-sm" onClick={handleLeave}>{t.leaveParty}</button>
      </div>
      <div style={{fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>{t.partyMembers}</div>
      <div className="member-list">
        {members.map(m=>(
          <div key={m.id} className="member-row">
            <div style={{flex:1}}><div className="member-name">{m.name}{m.id===currentUser.uid&&<span style={{fontSize:"0.7rem",color:"var(--muted)",marginLeft:6}}>(tu)</span>}</div><div className="member-class">{m.race} · {m.class} · Lv {m.level}</div></div>
            <div style={{width:80}}><HpBar current={m.hp?.current||0} max={m.hp?.max||1}/></div>
            <span style={{fontSize:"0.8rem",color:"var(--muted)",minWidth:50,textAlign:"center"}}>{m.hp?.current||0}/{m.hp?.max||0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MONSTER LIBRARY (DM) ─────────────────────────────────────────────────────
function DmMonsterLibrary({lang,currentUser,activeParty,onSetActiveParty,onOpenInstance}){
  const t=T[lang];
  const [monsters,setMonsters]=useState([]); const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false); const [editing,setEditing]=useState(null);

  const refresh=useCallback(async()=>{
    const ms=await loadDmMonsters(currentUser.uid); ms.sort((a,b)=>a.name.localeCompare(b.name));
    setMonsters(ms); setLoading(false);
  },[currentUser.uid]);

  useEffect(()=>{ refresh(); },[refresh]);

  const handleSave=async(form)=>{
    const id=editing?.id||genId();
    const m={id,dmUid:currentUser.uid,name:form.name,type:form.type,hp:{max:form.hpMax},
      ac:form.ac,speed:form.speed,initiative:form.initiative,stats:form.stats,
      abilities:editing?.abilities||[],notes:form.notes,
      portrait:editing?.portrait||"", token:editing?.token||"",
      createdAt:editing?.createdAt||Date.now()};
    await saveMonsterToDb(m); setShowForm(false); setEditing(null); refresh();
  };
  const handleDelete=async(m)=>{
    if(!window.confirm(`${lang==="it"?"Eliminare":"Delete"} ${m.name}?`)) return;
    await deleteMonsterFromDb(m.id); refresh();
  };
  const handleAddToCombat=async(m)=>{
    if(!activeParty){ alert(lang==="it"?"Prima seleziona un party attivo dalla scheda Party!":"First select an active party from the Parties tab!"); return; }
    const inst={
      instanceId:genId(), monsterId:m.id, name:m.name, type:m.type||"",
      hp:{current:m.hp.max,max:m.hp.max}, ac:m.ac, speed:m.speed||30,
      initiative:m.initiative||0, stats:{...m.stats}, abilities:[...(m.abilities||[])],
      conditions:[], visibleHp:false, notes:m.notes||"",
      portrait:m.portrait||"", token:m.token||"",
    };
    const upd={...activeParty,combatMonsters:[...(activeParty.combatMonsters||[]),inst]};
    await saveParty(upd); onSetActiveParty(upd);
    alert(`${m.name} ${lang==="it"?"aggiunto al combattimento!":"added to combat!"}`);
  };

  if(loading) return <div style={{color:"var(--muted)",padding:20}}>...</div>;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <h2 style={{fontFamily:"Cinzel,serif",color:"#e74c3c",fontSize:"1.1rem"}}>☠ {t.monsterLib}</h2>
        <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={()=>{setEditing(null);setShowForm(true);}}>+ {t.createMonster}</button>
      </div>
      {monsters.length===0&&<p style={{color:"var(--muted)",fontSize:"0.9rem",marginBottom:16}}>{t.noMonsters}</p>}
      <div className="char-cards">
        {monsters.map(m=>(
          <div key={m.id} className="monster-card">
            {m.portrait&&<img src={m.portrait} alt={m.name} style={{width:"100%",height:100,objectFit:"cover",borderRadius:8,marginBottom:8}}/>}
            <div className="monster-card-name">{m.name}</div>
            <div className="monster-card-sub">{m.type||"—"} · {m.hp.max} HP · CA {m.ac}</div>
            <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
              <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff",fontSize:"0.75rem"}} onClick={()=>handleAddToCombat(m)}>{t.addToCombat}</button>
              <button className="btn btn-ghost btn-sm" style={{fontSize:"0.75rem"}} onClick={()=>{setEditing(m);setShowForm(true);}}>✎</button>
              <button className="btn btn-ghost btn-sm" style={{fontSize:"0.75rem",color:"var(--red)"}} onClick={()=>handleDelete(m)}>×</button>
            </div>
            <div style={{marginTop:10,display:"flex",gap:12,flexWrap:"wrap"}}>
              <ImagePicker lang={lang} value={m.portrait||""} isMonster={true}
                label={t.portrait}
                onChange={async v=>{ const upd={...m,portrait:v}; await saveMonsterToDb(upd); refresh(); }}/>
              <ImagePicker lang={lang} value={m.token||""} isToken={true} isMonster={true}
                label={t.token}
                onChange={async v=>{ const upd={...m,token:v}; await saveMonsterToDb(upd); refresh(); }}/>
            </div>
          </div>
        ))}
      </div>
      {/* Active combat instances */}
      {activeParty&&(activeParty.combatMonsters||[]).length>0&&(
        <div className="card">
          <div className="card-title">☠ {t.combatInstances} — {activeParty.name}</div>
          {(activeParty.combatMonsters||[]).map(inst=>(
            <div key={inst.instanceId} className="instance-row">
              <div style={{flex:1}}>
                <div className="instance-name">{inst.name}</div>
                <div style={{fontSize:"0.75rem",color:"var(--muted)"}}>{inst.hp.current}/{inst.hp.max} HP · CA {inst.ac} · Init {inst.initiative>=0?"+":""}{inst.initiative}</div>
                {inst.conditions?.length>0&&<div className="badges" style={{marginTop:4}}>{inst.conditions.map(c=><span key={c} className="badge badge-red" style={{fontSize:"0.65rem",padding:"2px 6px"}}>{lang==="it"?CONDITIONS_IT[CONDITIONS_EN.indexOf(c)]:c}</span>)}</div>}
              </div>
              <div style={{width:80}}><HpBar current={inst.hp.current} max={inst.hp.max}/></div>
              <div className="vis-toggle" onClick={async()=>{
                const updInst={...inst,visibleHp:!inst.visibleHp};
                const upd={...activeParty,combatMonsters:(activeParty.combatMonsters||[]).map(m=>m.instanceId===inst.instanceId?updInst:m)};
                await saveParty(upd); onSetActiveParty(upd);
              }}>
                <div className="toggle" style={{width:28,height:16,flexShrink:0,...(inst.visibleHp?{background:"var(--accent2)",borderColor:"var(--accent2)"}:{})}}/>
                <span>{inst.visibleHp?t.hpVisible:t.hideHp}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={()=>onOpenInstance(inst)}>⚔</button>
              <button className="btn btn-danger btn-sm" onClick={async()=>{
                const upd={...activeParty,combatMonsters:(activeParty.combatMonsters||[]).filter(m=>m.instanceId!==inst.instanceId)};
                await saveParty(upd); onSetActiveParty(upd);
              }}>×</button>
            </div>
          ))}
        </div>
      )}
      {showForm&&<MonsterFormModal lang={lang} existing={editing} onSave={handleSave} onClose={()=>{setShowForm(false);setEditing(null);}}/>}
    </div>
  );
}


// ─── IMAGE HELPERS ────────────────────────────────────────────────────────────
// Compress an image file to base64, max dimension 600px, quality 0.75
const compressImage = (file, maxDim=600, quality=0.75) => new Promise((resolve,reject)=>{
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w=img.width, h=img.height;
      if(w>h&&w>maxDim){ h=Math.round(h*maxDim/w); w=maxDim; }
      else if(h>maxDim){ w=Math.round(w*maxDim/h); h=maxDim; }
      canvas.width=w; canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL("image/jpeg",quality));
    };
    img.onerror=reject;
    img.src=e.target.result;
  };
  reader.onerror=reject;
  reader.readAsDataURL(file);
});

// Token compressor — smaller, square crop for initiative token
const compressToken = (file) => compressImage(file, 200, 0.7);

// ImagePicker: shows current image + lets user pick via upload or URL
function ImagePicker({lang, value, onChange, label, isToken=false, isMonster=false}){
  const t=T[lang];
  const [tab,setTab]=useState("upload"); // "upload" | "url"
  const [urlInput,setUrlInput]=useState("");
  const [loading,setLoading]=useState(false);
  const fileRef=useState(null);
  const inputId=useState(()=>"img-"+Math.random().toString(36).slice(2,7))[0];

  const handleFile=async(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    setLoading(true);
    try{
      const b64 = isToken ? await compressToken(file) : await compressImage(file);
      onChange(b64);
    } catch(err){ alert("Image error: "+err.message); }
    setLoading(false);
    e.target.value="";
  };
  const handleUrl=()=>{
    if(!urlInput.trim()) return;
    onChange(urlInput.trim()); setUrlInput("");
  };
  const imgClass = isToken ? (isMonster?"token-monster":"token") : (isMonster?"avatar-portrait-monster":"avatar-portrait");
  const phClass  = isToken ? "token-placeholder" : "avatar-placeholder";

  return(
    <div className="img-picker-wrap">
      <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{label}</div>
      <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
        {/* Preview */}
        <div>
          {value
            ?<img src={value} alt={label} className={imgClass} style={isToken?{cursor:"pointer"}:{}}/>
            :<div className={phClass} style={isToken?{cursor:"default"}:{}} onClick={isToken?undefined:()=>document.getElementById(inputId)?.click()}>
              {isToken
                ?<span style={{fontSize:"1rem",opacity:0.3}}>?</span>
                :<><span className="avatar-placeholder-icon">🖼</span><span className="avatar-placeholder-text">{t.imgUpload}</span></>
              }
            </div>
          }
        </div>
        {/* Controls */}
        <div style={{flex:1,minWidth:160}}>
          <div className="img-picker-tabs">
            <div className={`img-picker-tab ${tab==="upload"?"active":""}`} onClick={()=>setTab("upload")}>{t.imgUpload}</div>
            <div className={`img-picker-tab ${tab==="url"?"active":""}`} onClick={()=>setTab("url")}>URL</div>
          </div>
          <div style={{marginTop:8}}>
            {tab==="upload"&&(
              <div className="img-picker-actions">
                <input id={inputId} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
                <button className="btn btn-ghost btn-sm" onClick={()=>document.getElementById(inputId)?.click()} style={{opacity:loading?0.5:1}}>
                  {loading?(lang==="it"?"...":"..."):`📂 ${value?t.imgChange:t.imgUpload}`}
                </button>
                {value&&<button className="btn btn-ghost btn-sm" style={{color:"var(--red)"}} onClick={()=>onChange("")}>× {t.imgRemove}</button>}
              </div>
            )}
            {tab==="url"&&(
              <div className="img-picker-actions">
                <input style={{flex:1,minWidth:120,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"6px 10px",borderRadius:6,fontFamily:"Lato,sans-serif",fontSize:"0.85rem",outline:"none"}}
                  value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder={t.imgUrlPlaceholder} onKeyDown={e=>e.key==="Enter"&&handleUrl()}/>
                <button className="btn btn-primary btn-sm" onClick={handleUrl}>{t.save}</button>
                {value&&<button className="btn btn-ghost btn-sm" style={{color:"var(--red)"}} onClick={()=>onChange("")}>× {t.imgRemove}</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SHARED CHARACTER SHEET (used by player and DM-view) ──────────────────────
function CharSheet({lang,char,isDmView,onSave,onBack,hpInput,setHpInput,invInput,setInvInput}){
  const t=T[lang];
  const [editStat,setEditStat]=useState(null);
  const [showAdd,setShowAdd]=useState(false);
  const [editAbility,setEditAbility]=useState(null);
  const [useModal,setUseModal]=useState(null);
  const [reactivate,setReactivate]=useState(null);
  const pb=profBonus(char.level||1);
  const atk=getAttackBonus(char); const dc=getSpellSaveDC(char);
  const condArr=lang==="it"?CONDITIONS_IT:CONDITIONS_EN;

  const save=(updated)=>onSave(updated);
  const updateStat=(stat,val)=>{ save({...char,stats:{...char.stats,[stat]:val}}); setEditStat(null); };
  const updateHp=(mode)=>{
    const amt=parseInt(hpInput)||0; if(!amt) return;
    let u={...char};
    if(mode==="heal") u.hp={...char.hp,current:Math.min(char.hp.max,char.hp.current+amt)};
    else { let d=amt,tmp=Math.min(char.hp.temp||0,d); d-=tmp; u.hp={...char.hp,temp:(char.hp.temp||0)-tmp,current:Math.max(0,char.hp.current-d)}; }
    setHpInput(""); save(u);
  };
  const toggleAction=(act)=>{ if(char.actions?.[act]) setReactivate(act); else save({...char,actions:{...char.actions,[act]:true}}); };
  const resetTurn=()=>save({...char,actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false}});
  const toggleCondition=(cond)=>{ const cs=char.conditions.includes(cond)?char.conditions.filter(x=>x!==cond):[...char.conditions,cond]; save({...char,conditions:cs}); };
  const addInv=()=>{ if(!invInput.trim()) return; save({...char,inventory:[...(char.inventory||[]),invInput.trim()]}); setInvInput(""); };
  const removeInv=(i)=>{ const inv=[...char.inventory]; inv.splice(i,1); save({...char,inventory:inv}); };
  const addEntry=(type,item)=>{
    const s=type==="spell"?{...item,spellLevel:Number(item.spellLevel??0)}:item;
    if(type==="ability") save({...char,abilities:[...(char.abilities||[]),s]});
    else save({...char,spells:[...(char.spells||[]),s]});
    setShowAdd(false);
  };
  const editEntry=(type,item)=>{
    if(type==="ability") save({...char,abilities:(char.abilities||[]).map(a=>a.id===item.id?item:a)});
    else save({...char,spells:(char.spells||[]).map(s=>s.id===item.id?item:s)});
    setEditAbility(null);
  };
  const removeEntry=(type,id)=>{
    if(type==="ability") save({...char,abilities:(char.abilities||[]).filter(a=>a.id!==id)});
    else save({...char,spells:(char.spells||[]).filter(s=>s.id!==id)});
  };
  const updateSpellSlot=(lv,used)=>save({...char,spellSlotsUsed:{...char.spellSlotsUsed,[lv]:Math.max(0,Math.min(char.spellSlots[lv],used))}});
  const handleUseConfirm=(item,type,slot)=>{
    let u={...char}; u.actions={...u.actions,[item.actionType]:true};
    if(type==="spell"&&item.spellLevel>0&&slot!=null) u.spellSlotsUsed={...u.spellSlotsUsed,[slot]:(u.spellSlotsUsed[slot]||0)+1};
    save(u); setUseModal(null);
  };

  return(
    <>
      {isDmView&&onBack&&(
        <div className="dm-banner">
          <span style={{flex:1}}>👁 {t.inspecting} <strong>{char.name}</strong> — {t.dmEditBanner}</span>
          <button className="dm-back-btn" onClick={onBack}>{t.backToDm}</button>
        </div>
      )}
      {/* Header */}
      <div className="card">
        <div className="char-header">
          {/* Portrait */}
          {char.portrait
            ?<img src={char.portrait} alt={char.name} className="avatar-portrait"/>
            :<div className="avatar-placeholder" onClick={()=>{}} style={{cursor:"default",opacity:0.4}}><span className="avatar-placeholder-icon">🧙</span></div>
          }
          <div className="char-info">
            <div className="char-name" onClick={isDmView?undefined:()=>{}}>{char.name}</div>
            <div className="char-sub">{char.race} · {char.class} · Lv {char.level}</div>
            {(char.conditions?.length>0||char.concentration)&&(
              <div className="badges" style={{marginTop:8}}>
                {char.conditions.map(c=><span key={c} className="badge badge-red">{c}</span>)}
                {char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
              </div>
            )}
          </div>
          <div className="meta-grid">
            {[["ac",t.ac],["speed",t.speed],["initiative",t.initiative]].map(([k,lbl])=>(
              <div key={k} className="meta-item">
                <input type="number" value={char[k]||0} onChange={e=>save({...char,[k]:+e.target.value})}
                  style={{width:60,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1.4rem",textAlign:"center",fontWeight:700,outline:"none"}}/>
                <div className="meta-label">{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Image pickers — only show for player on their own sheet or DM viewing */}
      <div className="card">
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <ImagePicker lang={lang} value={char.portrait||""} onChange={v=>save({...char,portrait:v})} label={t.portrait}/>
          <ImagePicker lang={lang} value={char.token||""} onChange={v=>save({...char,token:v})} label={t.token} isToken={true}/>
        </div>
      </div>
      {/* Stats */}
      <div className="card">
        <div className="card-title">{lang==="it"?"Caratteristiche":"Ability Scores"}</div>
        <div className="stat-grid">{STATS.map(s=><StatBox key={s} stat={s} value={char.stats[s]} lang={lang} onClick={()=>setEditStat(s)}/>)}</div>
      </div>
      {/* Quick bonuses */}
      <div className="card">
        <div className="card-title">{lang==="it"?"Bonus Rapidi":"Quick Bonuses"}</div>
        <div className="quick-stats">
          <div className="quick-stat-box"><div className="quick-stat-val green">{modStr(pb)}</div><div className="quick-stat-label">{t.proficiencyBonus}</div></div>
          <div className="quick-stat-box"><div className="quick-stat-val blue">{modStr(atk)}</div><div className="quick-stat-label">{t.attackBonus}</div></div>
          <div className="quick-stat-box"><div className="quick-stat-val purple">{dc}</div><div className="quick-stat-label">{t.spellSaveDC}</div></div>
        </div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:16}}>
          <div style={{flex:1,minWidth:140}}>
            <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.spellcastingStat}</div>
            <select value={char.spellcastingStat||"INT"} onChange={e=>save({...char,spellcastingStat:e.target.value})} style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}>
              {STATS.map(s=><option key={s} value={s}>{lang==="it"?STAT_IT[s]:s}</option>)}
            </select>
          </div>
          <div style={{flex:1,minWidth:140}}>
            <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.attackBonusExtra}</div>
            <input type="number" value={char.attackBonusExtra||0} onChange={e=>save({...char,attackBonusExtra:+e.target.value})} style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}/>
          </div>
        </div>
      </div>
      {/* Skills + Saves */}
      <div className="two-col">
        <SkillsSection char={char} lang={lang} onToggle={key=>save({...char,skillProfs:{...char.skillProfs,[key]:!char.skillProfs?.[key]}})}/>
        <SavingThrowsSection char={char} lang={lang} onToggle={stat=>save({...char,savingThrowProfs:{...char.savingThrowProfs,[stat]:!char.savingThrowProfs?.[stat]}})}/>
      </div>
      {/* HP */}
      <div className="card">
        <div className="card-title">{t.hp}</div>
        <HpBar current={char.hp.current} max={char.hp.max}/>
        <div className="hp-row">
          <div className="hp-nums" style={{color:char.hp.current===0?"#e74c3c":char.hp.current<char.hp.max/4?"#f39c12":"var(--text)"}}>{char.hp.current}/{char.hp.max}{char.hp.temp>0&&<span style={{fontSize:"0.9rem",color:"#9b7be0",marginLeft:8}}>+{char.hp.temp} {t.temp}</span>}</div>
          <div className="quick-hp">
            <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>e.key==="Enter"&&updateHp("damage")}/>
            <button className="btn btn-green btn-sm" onClick={()=>updateHp("heal")}>{t.heal}</button>
            <button className="btn btn-danger btn-sm" onClick={()=>updateHp("damage")}>{t.damage}</button>
          </div>
        </div>
        <div className="sep"/>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>Max HP</div><input type="number" min={1} value={char.hp.max} onChange={e=>save({...char,hp:{...char.hp,max:+e.target.value}})} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}}/></div>
          <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>{t.temp}</div><input type="number" min={0} value={char.hp.temp||0} onChange={e=>save({...char,hp:{...char.hp,temp:+e.target.value}})} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}}/></div>
        </div>
      </div>
      {/* Combat actions */}
      <div className="card">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <span style={{fontFamily:"Cinzel,serif",fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1.5px"}}>{lang==="it"?"Turno":"Combat Turn"}</span>
          <button className="btn btn-ghost btn-sm" onClick={resetTurn}>{t.resetTurn}</button>
        </div>
        <div className="action-row">
          {ACTION_KEYS.map((key,i)=>{
            const used=char.actions?.[key]||false; const c=actionColor(key);
            return(
              <div key={key} className={`action-btn${used?" consumed":""}`} style={!used?{borderColor:c.border,background:c.bg,color:c.text}:{}} onClick={()=>toggleAction(key)}>
                <div className="action-dot" style={!used?{background:c.text}:{}}/>
                <div className="action-label">{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</div>
                <div className="action-status">{used?(lang==="it"?"✗ Usata":"✗ Used"):(lang==="it"?"✓ Disponibile":"✓ Available")}</div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Conditions */}
      <div className="card">
        <div className="card-title">{t.conditions}</div>
        <div className="cond-grid">{condArr.map((c,i)=><div key={c} className={`cond-chip ${char.conditions.includes(CONDITIONS_EN[i])?"active":""}`} onClick={()=>toggleCondition(CONDITIONS_EN[i])}>{c}</div>)}</div>
        <div className="sep"/>
        <div className="conc-toggle" onClick={()=>save({...char,concentration:!char.concentration})}>
          <div className={`toggle ${char.concentration?"on":""}`}/>
          <span>{t.concentration}</span>
          {char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
        </div>
      </div>
      {/* Abilities */}
      <div className="card">
        <div className="section-header"><span className="section-title">{t.abilities}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAdd("ability")}>+ {t.addAbility}</button></div>
        {(char.abilities||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noAbilities}</p>:(
          <div className="ability-list">
            {(char.abilities||[]).map(a=>(
              <div key={a.id} className="ability-card">
                <div className="ability-card-info"><div className="ability-card-name">{a.name}</div>{a.desc&&<div className="ability-card-desc">{a.desc}</div>}</div>
                <div className="ability-card-meta">
                  <ActionTag actionKey={a.actionType} lang={lang}/>
                  <div style={{display:"flex",gap:4}}>
                    <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:"1rem"}} onClick={()=>setEditAbility({type:"ability",item:a})} title={t.editAbility}>✎</button>
                    <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>removeEntry("ability",a.id)}>×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Spells */}
      <div className="card">
        <div className="section-header"><span className="section-title">{t.spells}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAdd("spell")}>+ {t.addSpell}</button></div>
        {(char.spells||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noSpells}</p>:(
          <div className="ability-list">
            {(char.spells||[]).map(s=>(
              <div key={s.id} className="ability-card">
                <div className="ability-card-info"><div className="ability-card-name">{s.name}</div>{s.desc&&<div className="ability-card-desc">{s.desc}</div>}</div>
                <div className="ability-card-meta">
                  <span style={{fontSize:"0.7rem",color:"var(--accent2)",fontWeight:700,background:"rgba(123,94,167,0.12)",padding:"3px 8px",borderRadius:99,border:"1px solid rgba(123,94,167,0.25)"}}>{s.spellLevel===0?(lang==="it"?"Trucchetto":"Cantrip"):`Lv ${s.spellLevel}`}</span>
                  <ActionTag actionKey={s.actionType} lang={lang}/>
                  <div style={{display:"flex",gap:4}}>
                    <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:"1rem"}} onClick={()=>setEditAbility({type:"spell",item:s})} title={t.editSpell}>✎</button>
                    <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>removeEntry("spell",s.id)}>×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Spell slots */}
      <div className="card">
        <div className="card-title">{t.spellSlots}</div>
        <div className="spell-grid">
          {SPELL_SLOTS.map(lv=>(
            <div key={lv} className="spell-slot">
              <div className="spell-slot-label">Lv {lv}</div>
              <div className="spell-pips">
                {Array.from({length:char.spellSlots[lv]||0}).map((_,i)=>(
                  <div key={i} className={`pip ${i<(char.spellSlotsUsed[lv]||0)?"full":""}`} onClick={()=>updateSpellSlot(lv,i<(char.spellSlotsUsed[lv]||0)?i:i+1)}/>
                ))}
                {(char.spellSlots[lv]||0)===0&&<span style={{fontSize:"0.7rem",color:"var(--muted)"}}>—</span>}
              </div>
              <div className="slot-controls">
                <button className="slot-btn" onClick={()=>save({...char,spellSlots:{...char.spellSlots,[lv]:Math.max(0,(char.spellSlots[lv]||0)-1)},spellSlotsUsed:{...char.spellSlotsUsed,[lv]:Math.min(char.spellSlotsUsed[lv]||0,Math.max(0,(char.spellSlots[lv]||0)-1))}})}>−</button>
                <span style={{flex:1,textAlign:"center",fontSize:"0.75rem",color:"var(--muted)"}}>{char.spellSlots[lv]||0}</span>
                <button className="slot-btn" onClick={()=>save({...char,spellSlots:{...char.spellSlots,[lv]:(char.spellSlots[lv]||0)+1}})}>+</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Inventory */}
      <div className="card">
        <div className="card-title">{t.inventory}</div>
        <div className="inv-list">{(char.inventory||[]).map((item,i)=><div key={i} className="inv-item"><span>{item}</span><button onClick={()=>removeInv(i)}>×</button></div>)}</div>
        <div className="inv-input-row"><input className="inv-input" value={invInput} onChange={e=>setInvInput(e.target.value)} placeholder={t.addItem} onKeyDown={e=>e.key==="Enter"&&addInv()}/><button className="btn btn-ghost btn-sm" onClick={addInv}>+</button></div>
      </div>
      {/* Notes */}
      <div className="card"><div className="card-title">{t.notes}</div><textarea className="notes-area" value={char.notes||""} onChange={e=>save({...char,notes:e.target.value})}/></div>

      {/* Modals */}
      {editStat&&<EditStatModal stat={editStat} value={char.stats[editStat]} lang={lang} onSave={v=>updateStat(editStat,v)} onClose={()=>setEditStat(null)}/>}
      {showAdd&&<AbilityModal lang={lang} type={showAdd} onSave={item=>addEntry(showAdd,item)} onClose={()=>setShowAdd(false)}/>}
      {editAbility&&<AbilityModal lang={lang} type={editAbility.type} existing={editAbility.item} onSave={item=>editEntry(editAbility.type,item)} onClose={()=>setEditAbility(null)}/>}
      {useModal&&<UseModal lang={lang} item={useModal.item} type={useModal.type} char={char} onConfirm={(slot)=>handleUseConfirm(useModal.item,useModal.type,slot)} onClose={()=>setUseModal(null)}/>}
      {reactivate&&(
        <div className="modal-overlay" onClick={()=>setReactivate(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
            <h3>{t.reactivateTitle}</h3>
            <div style={{background:"var(--bg)",border:`1px solid ${actionColor(reactivate).border}`,borderRadius:10,padding:14,marginBottom:18,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:12,height:12,borderRadius:"50%",background:actionColor(reactivate).text,flexShrink:0}}/>
              <span style={{fontFamily:"Cinzel,serif",fontWeight:700,color:actionColor(reactivate).text}}>{lang==="it"?ACTION_TYPES_IT[ACTION_KEYS.indexOf(reactivate)]:ACTION_TYPES_EN[ACTION_KEYS.indexOf(reactivate)]}</span>
            </div>
            <p style={{color:"var(--muted)",fontSize:"0.9rem",lineHeight:1.5,marginBottom:20}}>{t.reactivateMsg}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setReactivate(null)}>{t.cancel}</button>
              <button className="btn btn-primary" onClick={()=>{save({...char,actions:{...char.actions,[reactivate]:false}});setReactivate(null);}}>{t.reactivate}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── MONSTER INSTANCE SHEET (DM only) ────────────────────────────────────────
function MonsterSheet({lang,inst,activeParty,onSave,onRemove,onBack}){
  const t=T[lang];
  const [hpInput,setHpInput]=useState("");
  const condArr=lang==="it"?CONDITIONS_IT:CONDITIONS_EN;

  const updateHp=(mode)=>{
    const amt=parseInt(hpInput)||0; if(!amt) return;
    let u={...inst};
    if(mode==="heal") u.hp={...inst.hp,current:Math.min(inst.hp.max,inst.hp.current+amt)};
    else u.hp={...inst.hp,current:Math.max(0,inst.hp.current-amt)};
    setHpInput(""); onSave(u);
  };
  const toggleCond=(cond)=>{
    const cs=inst.conditions.includes(cond)?inst.conditions.filter(x=>x!==cond):[...inst.conditions,cond];
    onSave({...inst,conditions:cs});
  };

  return(
    <>
      <div className="monster-banner">
        <span style={{flex:1}}>☠ {t.monsterSheet}: <strong>{inst.name}</strong></span>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <div className="vis-toggle" onClick={()=>onSave({...inst,visibleHp:!inst.visibleHp})}>
            <div className="toggle" style={{width:28,height:16,flexShrink:0,...(inst.visibleHp?{background:"var(--accent2)",borderColor:"var(--accent2)"}:{})}}/>
            <span>{inst.visibleHp?t.hpVisible:t.hideHp}</span>
          </div>
          <button className="btn btn-danger btn-sm" onClick={()=>{if(window.confirm(t.removeFromCombat+"?")) onRemove(inst.instanceId);}}>{t.removeFromCombat}</button>
          <button className="dm-back-btn" onClick={onBack}>{t.backToDm}</button>
        </div>
      </div>
      {/* Monster portrait + token */}
      <div className="card">
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <ImagePicker lang={lang} value={inst.portrait||""} onChange={v=>onSave({...inst,portrait:v})} label={t.portrait} isMonster={true}/>
          <ImagePicker lang={lang} value={inst.token||""} onChange={v=>onSave({...inst,token:v})} label={t.token} isToken={true} isMonster={true}/>
        </div>
      </div>
      {/* HP */}
      <div className="card">
        <div className="card-title">{t.hp}</div>
        <HpBar current={inst.hp.current} max={inst.hp.max}/>
        <div className="hp-row">
          <div className="hp-nums" style={{color:inst.hp.current===0?"#e74c3c":inst.hp.current<inst.hp.max/4?"#f39c12":"var(--text)"}}>{inst.hp.current}/{inst.hp.max}</div>
          <div className="quick-hp">
            <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>e.key==="Enter"&&updateHp("damage")}/>
            <button className="btn btn-green btn-sm" onClick={()=>updateHp("heal")}>{t.heal}</button>
            <button className="btn btn-danger btn-sm" onClick={()=>updateHp("damage")}>{t.damage}</button>
          </div>
        </div>
        <div className="sep"/>
        <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>Max HP</div>
          <input type="number" min={1} value={inst.hp.max} onChange={e=>onSave({...inst,hp:{...inst.hp,max:+e.target.value}})} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}}/>
        </div>
      </div>
      {/* Meta stats */}
      <div className="card">
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:16}}>
          {[["ac",t.ac],["speed",t.speed],["initiative",t.initiative]].map(([k,lbl])=>(
            <div key={k} className="meta-item">
              <input type="number" value={inst[k]||0} onChange={e=>onSave({...inst,[k]:+e.target.value})}
                style={{width:60,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1.4rem",textAlign:"center",fontWeight:700,outline:"none"}}/>
              <div className="meta-label">{lbl}</div>
            </div>
          ))}
        </div>
        <div className="card-title">{lang==="it"?"Caratteristiche":"Ability Scores"}</div>
        <div className="stat-grid">{STATS.map(s=><StatBox key={s} stat={s} value={inst.stats?.[s]||10} lang={lang}/>)}</div>
      </div>
      {/* Conditions */}
      <div className="card">
        <div className="card-title">{t.conditions}</div>
        <div className="cond-grid">{condArr.map((c,i)=><div key={c} className={`cond-chip ${inst.conditions.includes(CONDITIONS_EN[i])?"active":""}`} onClick={()=>toggleCond(CONDITIONS_EN[i])}>{c}</div>)}</div>
      </div>
      {/* Abilities */}
      {(inst.abilities||[]).length>0&&(
        <div className="card">
          <div className="card-title">{t.abilities}</div>
          <div className="ability-list">{(inst.abilities||[]).map(a=>(
            <div key={a.id} className="ability-card">
              <div className="ability-card-info"><div className="ability-card-name">{a.name}</div>{a.desc&&<div className="ability-card-desc">{a.desc}</div>}</div>
              <div className="ability-card-meta"><ActionTag actionKey={a.actionType} lang={lang}/></div>
            </div>
          ))}</div>
        </div>
      )}
      {/* Notes */}
      <div className="card"><div className="card-title">{t.notes}</div><textarea className="notes-area" value={inst.notes||""} onChange={e=>onSave({...inst,notes:e.target.value})}/></div>
    </>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const [lang,setLang]             = useState("it");
  const [screen,setScreen]         = useState("loading");
  const [authMode,setAuthMode]     = useState("login");
  const [emailInput,setEmailInput] = useState("");
  const [passInput,setPassInput]   = useState("");
  const [nameInput,setNameInput]   = useState("");
  const [roleInput,setRoleInput]   = useState("player");
  const [authError,setAuthError]   = useState("");
  const [currentUser,setCurrentUser] = useState(null);
  const [char,setChar]             = useState(null);
  const [allChars,setAllChars]     = useState([]);
  const [activeParty,setActiveParty] = useState(null);
  const [dmViewChar,setDmViewChar] = useState(null);
  const [dmViewInst,setDmViewInst] = useState(null);
  const [showCreateChar,setShowCreateChar] = useState(false);
  const [hpInput,setHpInput]       = useState("");
  const [invInput,setInvInput]     = useState("");

  const t=T[lang];
  const isDM=currentUser?.role==="dm";
  const playerTabs=[["sheet",t.sheet],["combat",t.combat],["party",t.currentParty]];
  const dmTabs=[["parties",t.parties],["dm",t.dmView],["monsters",t.monsters],["combat",t.orderInit]];
  const tabs=isDM?dmTabs:playerTabs;
  const validScreens=(isDM?dmTabs:playerTabs).map(x=>x[0]);

  // Redirect to correct screen if role changes
  useEffect(()=>{
    if(!currentUser||screen==="loading"||screen==="auth") return;
    if(!validScreens.includes(screen)) setScreen(isDM?"parties":"sheet");
  },[currentUser,isDM]);

  // Auth listener
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async(fu)=>{
      if(fu){
        const profile=await loadUserProfile(fu.uid);
        if(profile){
          const user={uid:fu.uid,email:fu.email,role:profile.role,displayName:profile.displayName};
          setCurrentUser(user);
          const c=await loadCharFromDb(fu.uid); if(c) setChar(c);
          setScreen(profile.role==="dm"?"parties":"sheet");
        } else setScreen("auth");
      } else { setCurrentUser(null); setChar(null); setScreen("auth"); }
    });
    return()=>unsub();
  },[]);

  // Load party members for DM
  const loadAllChars=useCallback(async()=>{
    if(!activeParty){ setAllChars([]); return; }
    const cs=await loadPartyMembers(activeParty.members||[]); setAllChars(cs);
  },[activeParty]);

  useEffect(()=>{
    if(isDM&&(screen==="dm"||screen==="combat")&&activeParty) loadAllChars();
    if(!isDM&&screen==="combat"&&char?.partyId){
      loadParty(char.partyId).then(p=>{ if(p){ setActiveParty(p); loadPartyMembers(p.members||[]).then(setAllChars); } });
    }
  },[screen,activeParty,char?.partyId]);

  // Polling
  useEffect(()=>{
    if(!currentUser) return;
    const iv=setInterval(()=>{
      if(isDM&&(screen==="dm"||screen==="combat"||screen==="monsters")&&activeParty) loadAllChars();
      if(!isDM) loadCharFromDb(currentUser.uid).then(c=>{ if(c) setChar(c); });
      if(!isDM&&screen==="combat"&&char?.partyId) loadParty(char.partyId).then(p=>{ if(p){ setActiveParty(p); loadPartyMembers(p.members||[]).then(setAllChars); } });
    },5000);
    return()=>clearInterval(iv);
  },[currentUser,isDM,screen,activeParty,char?.partyId]);

  const saveChar=async(updated)=>{ setChar(updated); await saveCharToDb(currentUser.uid,updated); };
  const saveInstance=async(updated)=>{
    if(!activeParty) return;
    const newMs=(activeParty.combatMonsters||[]).map(m=>m.instanceId===updated.instanceId?updated:m);
    const up={...activeParty,combatMonsters:newMs};
    setActiveParty(up); setDmViewInst(updated); await saveParty(up);
  };
  const removeInstance=async(instanceId)=>{
    if(!activeParty) return;
    const newMs=(activeParty.combatMonsters||[]).filter(m=>m.instanceId!==instanceId);
    const up={...activeParty,combatMonsters:newMs};
    setActiveParty(up); setDmViewInst(null); await saveParty(up);
  };

  // Auth
  const handleAuth=async()=>{
    setAuthError("");
    if(!emailInput.trim()||!passInput.trim()){ setAuthError(lang==="it"?"Compila tutti i campi":"Fill all fields"); return; }
    try{
      if(authMode==="register"){
        if(!nameInput.trim()){ setAuthError(lang==="it"?"Inserisci un nome":"Enter a name"); return; }
        const cred=await createUserWithEmailAndPassword(auth,emailInput.trim(),passInput);
        const user={uid:cred.user.uid,email:cred.user.email,role:roleInput,displayName:nameInput.trim()};
        await saveUserProfile(cred.user.uid,{role:roleInput,displayName:nameInput.trim(),email:cred.user.email});
        const nc={...DEFAULT_CHAR,id:cred.user.uid,name:nameInput.trim(),role:roleInput};
        await saveCharToDb(cred.user.uid,nc);
        setCurrentUser(user); setChar(nc); setScreen(roleInput==="dm"?"parties":"sheet");
      } else await signInWithEmailAndPassword(auth,emailInput.trim(),passInput);
    } catch(err){
      const msgs={"auth/email-already-in-use":lang==="it"?"Email già in uso":"Email in use","auth/invalid-email":lang==="it"?"Email non valida":"Invalid email","auth/weak-password":lang==="it"?"Password troppo corta":"Password too short","auth/invalid-credential":lang==="it"?"Credenziali errate":"Wrong credentials"};
      setAuthError(msgs[err.code]||err.message);
    }
  };
  const logout=async()=>{ await signOut(auth); setEmailInput(""); setPassInput(""); setNameInput(""); };

  const handleCreateChar=async(form)=>{
    const base=char||DEFAULT_CHAR;
    const nc={...base,id:currentUser.uid,name:form.name,class:form.class,race:form.race,level:form.level,hp:{...base.hp,max:form.hpMax,current:Math.min(base.hp.current||form.hpMax,form.hpMax)}};
    await saveCharToDb(currentUser.uid,nc); setChar(nc); setShowCreateChar(false);
  };

  // LOADING
  if(screen==="loading") return(<><style>{css}</style><div className="loading">⚔ {t.appName}…</div></>);

  // AUTH
  if(screen==="auth") return(
    <><style>{css}</style>
      <div className="auth-wrap">
        <div className="auth-box">
          <h1>⚔ {t.appName}</h1><p>D&D 5e Companion</p>
          {authError&&<div style={{color:"#e74c3c",marginBottom:12,fontSize:"0.85rem",textAlign:"center"}}>{authError}</div>}
          <div className="field"><label>{t.email}</label><input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="nome@email.com"/></div>
          <div className="field"><label>{t.password}</label><input type="password" value={passInput} onChange={e=>setPassInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="min 6 caratteri"/></div>
          {authMode==="register"&&<>
            <div className="field"><label>{t.displayName}</label><input value={nameInput} onChange={e=>setNameInput(e.target.value)} placeholder="Gandalf"/></div>
            <div className="field"><label>{t.role}</label>
              <select value={roleInput} onChange={e=>setRoleInput(e.target.value)}>
                <option value="player">{t.player}</option>
                <option value="dm">{t.dm}</option>
              </select>
            </div>
          </>}
          <button className="btn btn-primary btn-full" onClick={handleAuth}>{authMode==="login"?t.login:t.register}</button>
          <div className="auth-switch">
            {authMode==="login"
              ?<>{lang==="it"?"Non hai un account? ":"No account? "}<span onClick={()=>setAuthMode("register")}>{t.register}</span></>
              :<>{lang==="it"?"Hai già un account? ":"Have an account? "}<span onClick={()=>setAuthMode("login")}>{t.login}</span></>
            }
          </div>
          <div style={{textAlign:"center",marginTop:16}}>
            <button className="lang-btn" onClick={()=>setLang(l=>l==="en"?"it":"en")}>{lang==="en"?"🇮🇹 Italiano":"🇬🇧 English"}</button>
          </div>
        </div>
      </div>
    </>
  );

  // MAIN APP
  const navTo=(id)=>{ setScreen(id); setDmViewChar(null); setDmViewInst(null); };

  return(
    <><style>{css}</style>
      <div className="app">
        <nav className="nav">
          <span className="nav-brand">⚔ {t.appName}</span>
          <div className="nav-tabs">{tabs.map(([id,lbl])=><button key={id} className={`nav-tab ${screen===id?"active":""}`} onClick={()=>navTo(id)}>{lbl}</button>)}</div>
          {isDM&&activeParty&&<span style={{fontSize:"0.72rem",color:"var(--accent2)",fontWeight:700,border:"1px solid rgba(123,94,167,0.4)",borderRadius:6,padding:"3px 8px",whiteSpace:"nowrap"}}>⚔ {activeParty.name}</span>}
          <button className="lang-btn" onClick={()=>setLang(l=>l==="en"?"it":"en")}>{lang==="en"?"IT":"EN"}</button>
          <button className="btn btn-ghost btn-sm" onClick={logout}>{t.logout}</button>
        </nav>
        <main className="main">

          {/* ══ PARTIES (DM) ══ */}
          {screen==="parties"&&isDM&&(
            <DmPartyManager lang={lang} currentUser={currentUser} activePartyId={activeParty?.id}
              onSelectParty={p=>{ setActiveParty(p); setScreen("dm"); }}/>
          )}

          {/* ══ PLAYER PARTY ══ */}
          {screen==="party"&&!isDM&&(
            <PlayerPartyPanel lang={lang} currentUser={currentUser} char={char} onCharUpdate={c=>setChar(c)}/>
          )}

          {/* ══ DM MONSTER LIBRARY ══ */}
          {screen==="monsters"&&isDM&&(
            <DmMonsterLibrary lang={lang} currentUser={currentUser} activeParty={activeParty}
              onSetActiveParty={p=>setActiveParty(p)}
              onOpenInstance={inst=>{ setDmViewInst(inst); setScreen("dm"); }}/>
          )}

          {/* ══ DM: MONSTER INSTANCE SHEET ══ */}
          {screen==="dm"&&isDM&&dmViewInst&&(
            <MonsterSheet lang={lang} inst={dmViewInst} activeParty={activeParty}
              onSave={saveInstance}
              onRemove={removeInstance}
              onBack={()=>setDmViewInst(null)}/>
          )}

          {/* ══ DM: PLAYER SHEET VIEW ══ */}
          {screen==="dm"&&isDM&&dmViewChar&&!dmViewInst&&(
            <CharSheet lang={lang} char={dmViewChar.data} isDmView={true}
              onSave={async(updated)=>{
                setDmViewChar({...dmViewChar,data:updated});
                await saveCharToDb(updated.id,updated);
                setAllChars(prev=>prev.map(c=>c.id===updated.id?updated:c));
              }}
              onBack={()=>setDmViewChar(null)}
              hpInput={hpInput} setHpInput={setHpInput}
              invInput={invInput} setInvInput={setInvInput}/>
          )}

          {/* ══ DM OVERVIEW ══ */}
          {screen==="dm"&&isDM&&!dmViewChar&&!dmViewInst&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <h2 style={{fontFamily:"Cinzel,serif",color:"var(--accent)"}}>{activeParty?activeParty.name:t.allChars}</h2>
                <button className="btn btn-ghost btn-sm" onClick={loadAllChars}>{lang==="it"?"Aggiorna":"Refresh"}</button>
              </div>
              {!activeParty?(
                <div className="card">
                  <p style={{color:"var(--muted)",marginBottom:12}}>{lang==="it"?"Seleziona un party dalla scheda Party.":"Select a party from the Parties tab."}</p>
                  <button className="btn btn-primary btn-sm" onClick={()=>setScreen("parties")}>{t.parties}</button>
                </div>
              ):(
                <>
                  <p style={{color:"var(--muted)",fontSize:"0.82rem",marginBottom:12}}>🖊 {lang==="it"?"Clicca su un personaggio per aprirne la scheda":"Click a character to open their sheet"}</p>
                  {allChars.filter(c=>c.role!=="dm").length===0
                    ?<p style={{color:"var(--muted)"}}>{t.noChars}</p>
                    :<div className="char-cards">
                      {allChars.filter(c=>c.role!=="dm").map(c=>(
                        <div key={c.id} className="char-card char-card-clickable" onClick={()=>setDmViewChar({id:c.id,data:c})}>
                          {c.portrait&&<img src={c.portrait} alt={c.name} style={{width:"100%",height:120,objectFit:"cover",borderRadius:8,marginBottom:8}}/>}
                          <div className="char-card-name">{c.name}</div>
                          <div className="char-card-sub">{c.race} · {c.class} · Lv {c.level}</div>
                          <HpBar current={c.hp.current} max={c.hp.max}/>
                          <div style={{fontSize:"0.85rem",margin:"6px 0"}}>{c.hp.current}/{c.hp.max} HP</div>
                          <div className="char-card-stats">
                            <div className="char-card-stat"><div className="char-card-stat-val">{c.ac}</div><div className="char-card-stat-label">{t.ac}</div></div>
                            <div className="char-card-stat"><div className="char-card-stat-val">{c.initiative>=0?"+":""}{c.initiative}</div><div className="char-card-stat-label">Init</div></div>
                            <div className="char-card-stat"><div className="char-card-stat-val">{modStr(profBonus(c.level||1))}</div><div className="char-card-stat-label">Prof</div></div>
                            <div className="char-card-stat"><div className="char-card-stat-val">{getSpellSaveDC(c)}</div><div className="char-card-stat-label">DC</div></div>
                          </div>
                          {c.conditions?.length>0&&<div className="badges" style={{marginTop:8}}>{c.conditions.map(cond=><span key={cond} className="badge badge-red">{lang==="it"?CONDITIONS_IT[CONDITIONS_EN.indexOf(cond)]:cond}</span>)}</div>}
                          {c.concentration&&<span className="badge badge-purple" style={{marginTop:6,display:"inline-block"}}>{t.conc}</span>}
                        </div>
                      ))}
                    </div>
                  }
                  {/* Combat monster instances summary */}
                  {(activeParty.combatMonsters||[]).length>0&&(
                    <div className="card" style={{marginTop:8}}>
                      <div className="card-title">☠ {t.combatInstances}</div>
                      {(activeParty.combatMonsters||[]).map(inst=>(
                        <div key={inst.instanceId} className="instance-row">
                          <div className="instance-name" style={{flex:1}}>{inst.name}</div>
                          <div style={{width:80}}><HpBar current={inst.hp.current} max={inst.hp.max}/></div>
                          <span style={{fontSize:"0.8rem",color:"var(--muted)",minWidth:55}}>{inst.hp.current}/{inst.hp.max}</span>
                          <button className="btn btn-ghost btn-sm" onClick={()=>{ setDmViewInst(inst); }}>⚔ {lang==="it"?"Apri":"Open"}</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ══ PLAYER SHEET ══ */}
          {screen==="sheet"&&!isDM&&(
            !char?(
              <div className="no-char">
                <h2>{t.createChar}</h2>
                <p style={{color:"var(--muted)",marginBottom:24}}>{lang==="it"?"Crea il tuo personaggio per iniziare.":"Create your character to get started."}</p>
                <button className="btn btn-primary" onClick={()=>setShowCreateChar(true)}>{t.createChar}</button>
              </div>
            ):(
              <CharSheet lang={lang} char={char} isDmView={false} onSave={saveChar}
                hpInput={hpInput} setHpInput={setHpInput} invInput={invInput} setInvInput={setInvInput}/>
            )
          )}

          {/* ══ COMBAT ══ */}
          {screen==="combat"&&(()=>{
            const activeChar=isDM?null:char;
            const condArr=lang==="it"?CONDITIONS_IT:CONDITIONS_EN;
            // Build initiative list: party members + visible monsters
            const initList=[
              ...allChars.map(c=>({...c,_type:"player"})),
              ...(activeParty?.combatMonsters||[])
                .filter(m=>isDM||m.visibleHp)
                .map(m=>({...m,id:m.instanceId,_type:"monster"})),
            ].sort((a,b)=>(b.initiative||0)-(a.initiative||0));

            return(
              <>
                {/* Player combat actions */}
                {!isDM&&activeChar&&(
                  <>
                    <div className="card">
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                        <span style={{fontFamily:"Cinzel,serif",fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1.5px"}}>{lang==="it"?"Turno":"Combat Turn"}</span>
                        <button className="btn btn-ghost btn-sm" onClick={()=>saveChar({...activeChar,actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false}})}>{t.resetTurn}</button>
                      </div>
                      <div className="action-row">
                        {ACTION_KEYS.map((key,i)=>{ const used=activeChar.actions?.[key]||false; const c=actionColor(key); return(
                          <div key={key} className={`action-btn${used?" consumed":""}`} style={!used?{borderColor:c.border,background:c.bg,color:c.text}:{}} onClick={()=>saveChar({...activeChar,actions:{...activeChar.actions,[key]:!used}})}>
                            <div className="action-dot" style={!used?{background:c.text}:{}}/>
                            <div className="action-label">{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</div>
                            <div className="action-status">{used?(lang==="it"?"✗ Usata":"✗ Used"):(lang==="it"?"✓ Disponibile":"✓ Available")}</div>
                          </div>
                        ); })}
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-title">{t.hp}</div>
                      <HpBar current={activeChar.hp.current} max={activeChar.hp.max}/>
                      <div className="hp-row">
                        <div className="hp-nums" style={{color:activeChar.hp.current===0?"#e74c3c":activeChar.hp.current<activeChar.hp.max/4?"#f39c12":"var(--text)"}}>{activeChar.hp.current}/{activeChar.hp.max}</div>
                        <div className="quick-hp">
                          <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>{
                            if(e.key==="Enter"){ const amt=parseInt(hpInput)||0; if(!amt) return; let u={...activeChar}; u.hp={...u.hp,current:Math.max(0,u.hp.current-amt)}; setHpInput(""); saveChar(u); }
                          }}/>
                          <button className="btn btn-green btn-sm" onClick={()=>{ const amt=parseInt(hpInput)||0; if(!amt) return; saveChar({...activeChar,hp:{...activeChar.hp,current:Math.min(activeChar.hp.max,activeChar.hp.current+amt)}}); setHpInput(""); }}>{t.heal}</button>
                          <button className="btn btn-danger btn-sm" onClick={()=>{ const amt=parseInt(hpInput)||0; if(!amt) return; saveChar({...activeChar,hp:{...activeChar.hp,current:Math.max(0,activeChar.hp.current-amt)}}); setHpInput(""); }}>{t.damage}</button>
                        </div>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-title">{t.conditions}</div>
                      <div className="cond-grid">{condArr.map((c,i)=><div key={c} className={`cond-chip ${activeChar.conditions.includes(CONDITIONS_EN[i])?"active":""}`} onClick={()=>{ const cs=activeChar.conditions.includes(CONDITIONS_EN[i])?activeChar.conditions.filter(x=>x!==CONDITIONS_EN[i]):[...activeChar.conditions,CONDITIONS_EN[i]]; saveChar({...activeChar,conditions:cs}); }}>{c}</div>)}</div>
                      <div className="sep"/>
                      <div className="conc-toggle" onClick={()=>saveChar({...activeChar,concentration:!activeChar.concentration})}><div className={`toggle ${activeChar.concentration?"on":""}`}/><span>{t.concentration}</span>{activeChar.concentration&&<span className="badge badge-purple">{t.conc}</span>}</div>
                    </div>
                  </>
                )}
                {/* Initiative order */}
                <div className="card">
                  <div className="card-title">{t.orderInit}</div>
                  {initList.length===0
                    ?<p style={{color:"var(--muted)",fontSize:"0.9rem"}}>{lang==="it"?"Nessun personaggio in iniziativa.":"No characters in initiative."}</p>
                    :<div className="init-list">
                      {initList.map(c=>(
                        <div key={c._type==="monster"?c.instanceId:c.id} className="init-item"
                          style={c.id===currentUser?.uid?{borderColor:"var(--accent)"}:c._type==="monster"?{borderColor:"rgba(192,57,43,0.4)"}:{}}>
                          <div className="init-num">{c.initiative>=0?"+":""}{c.initiative||0}</div>
                          {/* Token image */}
                          {c.token
                            ?<img src={c.token} alt={c.name} className={c._type==="monster"?"token-monster":"token"}/>
                            :<div className="token-placeholder" style={{fontSize:"0.8rem",color:"var(--muted)",opacity:0.4}}>{c._type==="monster"?"☠":"⚔"}</div>
                          }
                          <div className="init-name" style={c._type==="monster"?{color:"#e74c3c"}:{}}>{c.name}</div>
                          {c._type==="monster"?(
                            isDM?(
                              <div style={{fontSize:"0.85rem",color:c.hp.current===0?"#e74c3c":c.hp.current<c.hp.max/4?"#f39c12":"var(--muted)"}}>{c.hp.current}/{c.hp.max} HP</div>
                            ):c.visibleHp?(
                              <div style={{width:80}}><HpBar current={c.hp.current} max={c.hp.max}/></div>
                            ):(
                              <div style={{fontSize:"0.75rem",color:"var(--muted)",fontStyle:"italic"}}>{lang==="it"?"HP nascosti":"HP hidden"}</div>
                            )
                          ):(
                            <div style={{fontSize:"0.85rem",color:c.hp?.current===0?"#e74c3c":c.hp?.current<c.hp?.max/4?"#f39c12":"var(--muted)"}}>{c.hp?.current||0}/{c.hp?.max||0} HP</div>
                          )}
                          <div className="badges">
                            {c.conditions?.map(cond=><span key={cond} className="badge badge-red" style={{padding:"2px 6px",fontSize:"0.65rem"}}>{lang==="it"?CONDITIONS_IT[CONDITIONS_EN.indexOf(cond)]:cond}</span>)}
                            {c._type==="player"&&c.concentration&&<span className="badge badge-purple" style={{padding:"2px 6px",fontSize:"0.65rem"}}>⦿</span>}
                            {isDM&&c._type==="monster"&&<button className="btn btn-ghost btn-sm" style={{fontSize:"0.65rem",padding:"2px 6px"}} onClick={()=>{ setDmViewInst(c); setScreen("dm"); }}>⚔</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  }
                </div>
              </>
            );
          })()}

        </main>
      </div>

      {showCreateChar&&<CreateCharModal lang={lang} char={char} onSave={handleCreateChar} onClose={()=>setShowCreateChar(false)}/>}
    </>
  );
}
