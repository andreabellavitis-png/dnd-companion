import { useState, useEffect, useCallback } from "react";
import { db, auth } from "./firebase";
import {
  doc, setDoc, getDoc, getDocs, collection, onSnapshot
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATS = ["STR","DEX","CON","INT","WIS","CHA"];
const STAT_IT = { STR:"FOR", DEX:"DES", CON:"COS", INT:"INT", WIS:"SAG", CHA:"CAR" };

const CONDITIONS_EN = ["Blinded","Charmed","Deafened","Exhausted","Frightened","Grappled","Incapacitated","Invisible","Paralyzed","Petrified","Poisoned","Prone","Restrained","Stunned","Unconscious"];
const CONDITIONS_IT = ["Accecato","Affascinato","Assordato","Esausto","Spaventato","Afferrato","Incapacitato","Invisibile","Paralizzato","Pietrificato","Avvelenato","Prono","Trattenuto","Stordito","Privo di sensi"];

const SPELL_SLOTS = [1,2,3,4,5,6,7,8,9];

const ACTION_TYPES_EN = ["Action","Bonus Action","Reaction","Free Action","Movement"];
const ACTION_TYPES_IT = ["Azione","Azione Bonus","Reazione","Azione Gratuita","Movimento"];
const ACTION_KEYS     = ["action","bonusAction","reaction","freeAction","movement"];
const ACTION_COLORS   = {
  action:      {bg:"rgba(200,150,62,0.12)", border:"rgba(200,150,62,0.5)", text:"#c8963e"},
  bonusAction: {bg:"rgba(123,94,167,0.12)", border:"rgba(123,94,167,0.5)", text:"#9b7be0"},
  reaction:    {bg:"rgba(52,152,219,0.12)", border:"rgba(52,152,219,0.5)", text:"#5dade2"},
  freeAction:  {bg:"rgba(39,174,96,0.12)",  border:"rgba(39,174,96,0.5)",  text:"#2ecc71"},
  movement:    {bg:"rgba(230,126,34,0.12)", border:"rgba(230,126,34,0.5)", text:"#e67e22"},
};

const SKILLS = [
  {key:"acrobatics",   en:"Acrobatics",     it:"Acrobazia",          stat:"DEX"},
  {key:"animalH",      en:"Animal Handling", it:"Addestrare Animali", stat:"WIS"},
  {key:"arcana",       en:"Arcana",          it:"Arcano",             stat:"INT"},
  {key:"athletics",    en:"Athletics",       it:"Atletica",           stat:"STR"},
  {key:"deception",    en:"Deception",       it:"Inganno",            stat:"CHA"},
  {key:"history",      en:"History",         it:"Storia",             stat:"INT"},
  {key:"insight",      en:"Insight",         it:"Intuizione",         stat:"WIS"},
  {key:"intimidation", en:"Intimidation",    it:"Intimidire",         stat:"CHA"},
  {key:"investigation",en:"Investigation",   it:"Investigare",        stat:"INT"},
  {key:"medicine",     en:"Medicine",        it:"Medicina",           stat:"WIS"},
  {key:"nature",       en:"Nature",          it:"Natura",             stat:"INT"},
  {key:"perception",   en:"Perception",      it:"Percezione",         stat:"WIS"},
  {key:"performance",  en:"Performance",     it:"Esibizione",         stat:"CHA"},
  {key:"persuasion",   en:"Persuasion",      it:"Persuasione",        stat:"CHA"},
  {key:"religion",     en:"Religion",        it:"Religione",          stat:"INT"},
  {key:"sleightOfHand",en:"Sleight of Hand", it:"Rapidità di Mano",   stat:"DEX"},
  {key:"stealth",      en:"Stealth",         it:"Furtività",          stat:"DEX"},
  {key:"survival",     en:"Survival",        it:"Sopravvivenza",      stat:"WIS"},
];

const profBonus = (level) => Math.ceil(level / 4) + 1;
const mod     = (score) => Math.floor((score - 10) / 2);
const modStr  = (n)     => n >= 0 ? `+${n}` : `${n}`;
const uid     = ()      => Math.random().toString(36).slice(2,9);

const DEFAULT_CHAR = {
  id:"", name:"Hero", class:"Fighter", race:"Human", level:1,
  stats:{STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10},
  hp:{current:10,max:10,temp:0},
  ac:10, speed:30, initiative:0,
  spellSlots:    {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0},
  spellSlotsUsed:{1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0},
  skillProfs:{}, savingThrowProfs:{},
  spellcastingStat:"INT", attackBonusExtra:0,
  inventory:[], abilities:[], spells:[],
  conditions:[], concentration:false, notes:"",
  actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false},
  role:"player",
};

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
const saveCharToDb = async (uid, data) => {
  await setDoc(doc(db, "characters", uid), data);
};
const loadCharFromDb = async (uid) => {
  const snap = await getDoc(doc(db, "characters", uid));
  return snap.exists() ? snap.data() : null;
};
const loadAllCharsFromDb = async () => {
  const snap = await getDocs(collection(db, "characters"));
  return snap.docs.map(d => d.data());
};
// Save user profile (role etc.) in a separate collection
const saveUserProfile = async (uid, data) => {
  await setDoc(doc(db, "users", uid), data);
};
const loadUserProfile = async (uid) => {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
};

// ─── COMPUTED BONUSES ─────────────────────────────────────────────────────────
function getSkillBonus(char, skillKey) {
  const skill = SKILLS.find(s => s.key === skillKey);
  if (!skill) return 0;
  const base = mod(char.stats[skill.stat] || 10);
  const pb   = profBonus(char.level || 1);
  return base + (char.skillProfs?.[skillKey] ? pb : 0);
}
function getSaveBonus(char, stat) {
  const base = mod(char.stats[stat] || 10);
  const pb   = profBonus(char.level || 1);
  return base + (char.savingThrowProfs?.[stat] ? pb : 0);
}
function getSpellSaveDC(char) {
  const pb   = profBonus(char.level || 1);
  const smod = mod(char.stats[char.spellcastingStat || "INT"] || 10);
  return 8 + pb + smod;
}
function getAttackBonus(char) {
  const pb   = profBonus(char.level || 1);
  const smod = mod(char.stats[char.spellcastingStat || "INT"] || 10);
  return pb + smod + (char.attackBonusExtra || 0);
}

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
  .btn-primary{background:var(--accent);color:#1a1000;}
  .btn-primary:hover{filter:brightness(1.15);}
  .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);}
  .btn-ghost:hover{border-color:var(--accent);color:var(--accent);}
  .btn-danger{background:var(--red);color:#fff;}
  .btn-green{background:var(--green);color:#fff;}
  .btn-full{width:100%;}
  .btn-sm{padding:6px 12px;font-size:0.8rem;}
  .auth-switch{text-align:center;margin-top:18px;color:var(--muted);font-size:0.85rem;}
  .auth-switch span{color:var(--accent);cursor:pointer;}
  .nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:16px;height:56px;position:sticky;top:0;z-index:100;}
  .nav-brand{font-family:'Cinzel',serif;font-size:1.1rem;color:var(--accent);font-weight:700;letter-spacing:1px;flex:1;}
  .nav-tabs{display:flex;gap:4px;}
  .nav-tab{background:transparent;border:none;color:var(--muted);padding:6px 14px;border-radius:6px;cursor:pointer;font-family:'Lato',sans-serif;font-size:0.85rem;font-weight:700;transition:all 0.2s;text-transform:uppercase;letter-spacing:0.5px;}
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
  .quick-stat-val{font-family:'Cinzel',serif;font-size:1.6rem;font-weight:700;color:var(--accent);line-height:1;}
  .quick-stat-val.green{color:var(--green);}
  .quick-stat-val.blue{color:#5dade2;}
  .quick-stat-val.purple{color:#9b7be0;}
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
  .skill-list{display:flex;flex-direction:column;gap:2px;}
  .skill-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;cursor:pointer;transition:background 0.15s;user-select:none;}
  .skill-row:hover{background:var(--surface2);}
  .skill-prof-dot{width:11px;height:11px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;transition:all 0.2s;}
  .skill-prof-dot.active{background:var(--accent);border-color:var(--accent);}
  .skill-name{flex:1;font-size:0.85rem;}
  .skill-stat{font-size:0.7rem;color:var(--muted);width:28px;text-align:right;}
  .skill-bonus{font-family:'Cinzel',serif;font-size:0.9rem;font-weight:700;width:30px;text-align:right;}
  .skill-bonus.prof{color:var(--accent);}
  .action-row{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
  .action-btn{padding:12px 6px;border-radius:10px;border:2px solid;background:transparent;cursor:pointer;text-align:center;transition:all 0.25s;font-family:'Cinzel',serif;font-size:0.68rem;line-height:1.3;position:relative;}
  .action-btn.consumed{background:#1a1a1a !important;border-color:#333 !important;color:#444 !important;filter:grayscale(1);}
  .action-btn.consumed .action-label{text-decoration:line-through;text-decoration-color:#555;color:#484848;}
  .action-btn.consumed .action-dot{background:#333 !important;}
  .action-btn.consumed .action-status{color:#444;}
  .action-dot{width:8px;height:8px;border-radius:50%;margin:0 auto 6px;}
  .ability-list{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
  .ability-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:12px;}
  .ability-card-info{flex:1;min-width:0;}
  .ability-card-name{font-weight:700;font-size:0.95rem;margin-bottom:3px;}
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
  .inv-item span{flex:1;font-size:0.9rem;}
  .inv-item button{background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem;}
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
  .char-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;}
  .char-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;}
  .char-card-name{font-family:'Cinzel',serif;font-size:1rem;color:var(--accent);margin-bottom:4px;}
  .char-card-sub{font-size:0.8rem;color:var(--muted);margin-bottom:10px;}
  .char-card-stats{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;}
  .char-card-stat{text-align:center;}
  .char-card-stat-val{font-size:1.1rem;font-weight:700;}
  .char-card-stat-label{font-size:0.65rem;color:var(--muted);}
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
  .meta-item{text-align:center;}
  .meta-label{font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
  .conc-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;}
  .toggle{width:40px;height:22px;border-radius:99px;border:2px solid var(--border);background:var(--bg);position:relative;transition:all 0.2s;}
  .toggle.on{background:var(--accent2);border-color:var(--accent2);}
  .toggle::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left 0.2s;}
  .toggle.on::after{left:20px;}
  .warn-box{background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.35);border-radius:8px;padding:10px 14px;color:#e74c3c;font-size:0.85rem;font-weight:700;margin-bottom:14px;}
  .no-char{text-align:center;padding:60px 20px;}
  .no-char h2{font-family:'Cinzel',serif;color:var(--accent);margin-bottom:12px;}
  .loading{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg);font-family:'Cinzel',serif;color:var(--accent);font-size:1.2rem;}
  .dm-banner{background:rgba(123,94,167,0.15);border:1px solid rgba(123,94,167,0.4);border-radius:10px;padding:12px 16px;color:#9b7be0;font-size:0.85rem;margin-bottom:16px;display:flex;align-items:center;gap:10px;}
  .dm-back-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:8px;cursor:pointer;font-family:'Cinzel',serif;font-size:0.8rem;font-weight:700;transition:all 0.2s;white-space:nowrap;}
  .dm-back-btn:hover{border-color:var(--accent2);color:var(--accent2);}
  .char-card-clickable{cursor:pointer;transition:border 0.2s,transform 0.15s;}
  .char-card-clickable:hover{border-color:var(--accent);transform:translateY(-2px);}
  @media(max-width:640px){
    .stat-grid{grid-template-columns:repeat(3,1fr);}
    .action-row{grid-template-columns:repeat(3,1fr);}
    .two-col{grid-template-columns:1fr;}
    .char-name{font-size:1.3rem;}
    .quick-stats{gap:8px;}
  }
`;

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const T = {
  en:{
    appName:"D&D Companion", login:"Sign In", register:"Create Account",
    email:"Email", password:"Password", role:"Role",
    player:"Player", dm:"Dungeon Master",
    logout:"Logout", sheet:"Sheet", combat:"Combat",
    initiative:"Initiative", conditions:"Conditions", concentration:"Concentration",
    action:"Action", bonusAction:"Bonus Action", reaction:"Reaction",
    freeAction:"Free Action", movement:"Movement",
    resetTurn:"Reset Turn", hp:"Hit Points", temp:"Temp HP", ac:"AC",
    speed:"Speed", spellSlots:"Spell Slots", inventory:"Inventory",
    notes:"Notes", addItem:"Add item...", save:"Save", cancel:"Cancel",
    heal:"Heal", damage:"Damage", amount:"Amount", dmView:"DM Overview",
    allChars:"All Characters", orderInit:"Combat Order", noChars:"No characters yet.",
    charName:"Character Name", class:"Class", race:"Race", level:"Level",
    createChar:"Create Character", editChar:"Edit Character",
    used:"Used", available:"Available", conc:"Concentrating",
    abilities:"Special Abilities", spells:"Spells",
    addAbility:"Add Ability", addSpell:"Add Spell",
    abilityName:"Ability Name", spellName:"Spell Name",
    description:"Description", actionRequired:"Action Required",
    spellLevel:"Spell Level", useAbility:"Use Ability", useSpell:"Cast Spell",
    actionUsed:"Action already used — it will be marked again!", slotUsed:"Choose spell slot:",
    slotAvailable:"available", noSlots:"No slots available.",
    confirm:"Confirm", noAbilities:"No abilities added yet.", noSpells:"No spells added yet.",
    cantUse:"No slots!", reactivateTitle:"Reactivate Action?",
    reactivateMsg:"This action is marked as used. Mark it as available again?",
    reactivate:"Reactivate",
    skills:"Skills", savingThrows:"Saving Throws",
    proficiencyBonus:"Proficiency Bonus", attackBonus:"Attack Bonus",
    spellSaveDC:"Spell Save DC", spellcastingStat:"Spellcasting Ability",
    attackBonusExtra:"Extra Attack Bonus", displayName:"Display Name",
  },
  it:{
    appName:"D&D Companion", login:"Accedi", register:"Crea Account",
    email:"Email", password:"Password", role:"Ruolo",
    player:"Giocatore", dm:"Dungeon Master",
    logout:"Esci", sheet:"Scheda", combat:"Combattimento",
    initiative:"Iniziativa", conditions:"Condizioni", concentration:"Concentrazione",
    action:"Azione", bonusAction:"Azione Bonus", reaction:"Reazione",
    freeAction:"Azione Gratuita", movement:"Movimento",
    resetTurn:"Reset Turno", hp:"Punti Ferita", temp:"PF Temp", ac:"CA",
    speed:"Velocità", spellSlots:"Slot Incantesimo", inventory:"Inventario",
    notes:"Note", addItem:"Aggiungi oggetto...", save:"Salva", cancel:"Annulla",
    heal:"Cura", damage:"Danno", amount:"Quantità", dmView:"Vista DM",
    allChars:"Tutti i Personaggi", orderInit:"Ordine Iniziativa", noChars:"Nessun personaggio.",
    charName:"Nome Personaggio", class:"Classe", race:"Razza", level:"Livello",
    createChar:"Crea Personaggio", editChar:"Modifica Personaggio",
    used:"Usata", available:"Disponibile", conc:"Concentrazione",
    abilities:"Abilità Speciali", spells:"Incantesimi",
    addAbility:"Aggiungi Abilità", addSpell:"Aggiungi Incantesimo",
    abilityName:"Nome Abilità", spellName:"Nome Incantesimo",
    description:"Descrizione", actionRequired:"Azione Richiesta",
    spellLevel:"Livello Incantesimo", useAbility:"Usa Abilità", useSpell:"Lancia Incantesimo",
    actionUsed:"Azione già usata — verrà segnata di nuovo!", slotUsed:"Scegli lo slot:",
    slotAvailable:"disponibili", noSlots:"Nessuno slot disponibile.",
    confirm:"Conferma", noAbilities:"Nessuna abilità aggiunta.", noSpells:"Nessun incantesimo aggiunto.",
    cantUse:"Slot esauriti!", reactivateTitle:"Riattivare Azione?",
    reactivateMsg:"Questa azione è già stata usata. Segnarla di nuovo come disponibile?",
    reactivate:"Riattiva",
    skills:"Abilità", savingThrows:"Tiri Salvezza",
    proficiencyBonus:"Bonus Competenza", attackBonus:"Bonus Attacco",
    spellSaveDC:"CD Incantesimi", spellcastingStat:"Caratteristica Magia",
    attackBonusExtra:"Bonus Attacco Extra", displayName:"Nome da mostrare",
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const actionLabel = (key, lang) => { const i=ACTION_KEYS.indexOf(key); return i>=0?(lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]):key; };
const actionColor = (key) => ACTION_COLORS[key]||{bg:"rgba(255,255,255,0.05)",border:"#444",text:"#aaa"};

function ActionTag({actionKey, lang}){
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
    <div className="stat-box" onClick={()=>onClick(stat)}>
      <div className="stat-label">{lang==="it"?STAT_IT[stat]:stat}</div>
      <div className="stat-mod">{modStr(mod(value))}</div>
      <div className="stat-score">{value}</div>
    </div>
  );
}
function SkillsSection({char,lang,onToggle}){
  const pb=profBonus(char.level||1);
  return(
    <div className="card">
      <div className="card-title">{T[lang].skills} <span style={{float:"right",color:"var(--muted)",fontFamily:"Lato,sans-serif",fontWeight:400,fontSize:"0.7rem",textTransform:"none",letterSpacing:0}}>{lang==="it"?`Comp. +${pb}`:`Prof. +${pb}`}</span></div>
      <div className="skill-list">
        {SKILLS.map(s=>{
          const isProf=!!(char.skillProfs?.[s.key]);
          const bonus=getSkillBonus(char,s.key);
          return(
            <div key={s.key} className="skill-row" onClick={()=>onToggle(s.key)}>
              <div className={`skill-prof-dot ${isProf?"active":""}`}/>
              <span className="skill-name">{lang==="it"?s.it:s.en}</span>
              <span className="skill-stat">{lang==="it"?STAT_IT[s.stat]:s.stat}</span>
              <span className={`skill-bonus ${isProf?"prof":""}`}>{modStr(bonus)}</span>
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
      <div className="card-title">{T[lang].savingThrows} <span style={{float:"right",color:"var(--muted)",fontFamily:"Lato,sans-serif",fontWeight:400,fontSize:"0.7rem",textTransform:"none",letterSpacing:0}}>{lang==="it"?`Comp. +${pb}`:`Prof. +${pb}`}</span></div>
      <div className="skill-list">
        {STATS.map(stat=>{
          const isProf=!!(char.savingThrowProfs?.[stat]);
          const bonus=getSaveBonus(char,stat);
          return(
            <div key={stat} className="skill-row" onClick={()=>onToggle(stat)}>
              <div className={`skill-prof-dot ${isProf?"active":""}`}/>
              <span className="skill-name">{lang==="it"?STAT_IT[stat]:stat}</span>
              <span className={`skill-bonus ${isProf?"prof":""}`}>{modStr(bonus)}</span>
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
        <div className="field"><label>{t.charName}</label><input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Aragorn" autoFocus/></div>
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
function AddAbilityModal({lang,type,onSave,onClose}){
  const t=T[lang]; const isSpell=type==="spell";
  const [form,setForm]=useState({name:"",desc:"",actionType:"action",spellLevel:1});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{isSpell?t.addSpell:t.addAbility}</h3>
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
          <button className="btn btn-primary" onClick={()=>form.name&&onSave({...form,id:uid()})}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}
function UseModal({lang,item,type,char,onConfirm,onClose}){
  const t=T[lang]; const isSpell=type==="spell";
  const spellLv=Number(item.spellLevel??0);
  const needsSlot=isSpell&&spellLv>0;
  const [chosenSlot,setChosenSlot]=useState(null);
  const c=actionColor(item.actionType);
  const actionAlreadyUsed=char.actions?.[item.actionType];
  const slots=char.spellSlots||{}; const usedSlots=char.spellSlotsUsed||{};
  const availableSlots=needsSlot?SPELL_SLOTS.filter(lv=>lv>=spellLv&&((Number(slots[lv])||0)-(Number(usedSlots[lv])||0))>0):[];
  const canConfirm=!needsSlot||(availableSlots.length>0&&chosenSlot!==null);
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
            {isSpell&&spellLv===0&&<span style={{fontSize:"0.75rem",color:"var(--muted)",fontWeight:700,background:"rgba(255,255,255,0.05)",padding:"3px 9px",borderRadius:99,border:"1px solid var(--border)"}}>{lang==="it"?"Trucchetto":"Cantrip"}</span>}
          </div>
        </div>
        {actionAlreadyUsed&&<div className="warn-box">⚠ {t.actionUsed}</div>}
        {needsSlot&&<div>
          <div style={{fontSize:"0.78rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>{t.slotUsed}</div>
          {availableSlots.length===0
            ?<div style={{color:"#e74c3c",fontSize:"0.9rem",marginBottom:8}}>{t.noSlots}</div>
            :availableSlots.map(lv=>{
              const avail=(Number(slots[lv])||0)-(Number(usedSlots[lv])||0);
              return <div key={lv} className={`slot-option ${chosenSlot===lv?"selected":""}`} onClick={()=>setChosenSlot(lv)}>
                <span style={{fontFamily:"Cinzel,serif",fontWeight:700}}>{lang==="it"?`Livello ${lv}`:`Level ${lv}`}</span>
                <span style={{fontSize:"0.8rem",color:"var(--muted)"}}>{avail} {t.slotAvailable}</span>
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

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const [lang,setLang]                     = useState("it");
  const [screen,setScreen]                 = useState("loading");
  const [authMode,setAuthMode]             = useState("login");
  const [emailInput,setEmailInput]         = useState("");
  const [passwordInput,setPasswordInput]   = useState("");
  const [displayNameInput,setDisplayNameInput] = useState("");
  const [roleInput,setRoleInput]           = useState("player");
  const [authError,setAuthError]           = useState("");
  const [currentUser,setCurrentUser]       = useState(null); // { uid, email, role, displayName }
  const [char,setChar]                     = useState(null);
  const [allChars,setAllChars]             = useState([]);
  const [editStat,setEditStat]             = useState(null);
  const [showCreateChar,setShowCreateChar] = useState(false);
  const [showAddModal,setShowAddModal]     = useState(false);
  const [useModal,setUseModal]             = useState(null);
  const [reactivateModal,setReactivateModal] = useState(null);
  const [dmViewChar,setDmViewChar]           = useState(null); // { id, data } — which player the DM is inspecting
  const [invInput,setInvInput]             = useState("");
  const [hpInput,setHpInput]               = useState("");
  const [hpMode,setHpMode]                 = useState("heal");

  const t = T[lang];

  // ── Auth state listener (runs once on mount)
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async(firebaseUser)=>{
      if(firebaseUser){
        const profile = await loadUserProfile(firebaseUser.uid);
        if(profile){
          const user = { uid:firebaseUser.uid, email:firebaseUser.email, role:profile.role, displayName:profile.displayName };
          setCurrentUser(user);
          const c = await loadCharFromDb(firebaseUser.uid);
          if(c) setChar(c);
          setScreen(profile.role==="dm"?"dm":"sheet");
        } else {
          // Profile not saved yet — edge case, go to auth
          setScreen("auth");
        }
      } else {
        setCurrentUser(null);
        setChar(null);
        setScreen("auth");
      }
    });
    return ()=>unsub();
  },[]);

  // ── Load all chars (DM + combat)
  const loadAllChars = useCallback(async()=>{
    const chars = await loadAllCharsFromDb();
    setAllChars(chars);
  },[]);

  useEffect(()=>{
    if(screen==="dm"||screen==="combat") loadAllChars();
  },[screen,loadAllChars]);

  // ── Polling every 5s for real-time feel
  useEffect(()=>{
    if(!currentUser) return;
    const iv = setInterval(()=>{
      if(screen==="dm"||screen==="combat") loadAllChars();
      if(currentUser.role==="player"){
        loadCharFromDb(currentUser.uid).then(c=>{ if(c) setChar(c); });
      }
      // if DM is inspecting a player, refresh that char too
      if(currentUser.role==="dm"){
        setDmViewChar(prev=>{
          if(!prev) return prev;
          loadCharFromDb(prev.id).then(c=>{ if(c) setDmViewChar({id:prev.id,data:c}); });
          return prev;
        });
      }
    },5000);
    return ()=>clearInterval(iv);
  },[currentUser,screen,loadAllChars]);

  const saveChar = async(updated)=>{
    setChar(updated);
    await saveCharToDb(currentUser.uid, updated);
  };

  // Saves a player's char on behalf of the DM
  const saveDmChar = async(updated)=>{
    setDmViewChar({...dmViewChar, data:updated});
    await saveCharToDb(updated.id, updated);
    // also refresh allChars so DM overview updates
    setAllChars(prev=>prev.map(c=>c.id===updated.id?updated:c));
  };

  // ── AUTH
  const handleAuth = async()=>{
    setAuthError("");
    if(!emailInput.trim()||!passwordInput.trim()){
      setAuthError(lang==="it"?"Compila tutti i campi":"Fill all fields"); return;
    }
    try{
      if(authMode==="register"){
        if(!displayNameInput.trim()){ setAuthError(lang==="it"?"Inserisci un nome":"Enter a display name"); return; }
        const cred = await createUserWithEmailAndPassword(auth, emailInput.trim(), passwordInput);
        const user = { uid:cred.user.uid, email:cred.user.email, role:roleInput, displayName:displayNameInput.trim() };
        await saveUserProfile(cred.user.uid, { role:roleInput, displayName:displayNameInput.trim(), email:cred.user.email });
        const nc = { ...DEFAULT_CHAR, id:cred.user.uid, name:displayNameInput.trim(), role:roleInput };
        await saveCharToDb(cred.user.uid, nc);
        setCurrentUser(user); setChar(nc);
        setScreen(roleInput==="dm"?"dm":"sheet");
      } else {
        await signInWithEmailAndPassword(auth, emailInput.trim(), passwordInput);
        // onAuthStateChanged handles the rest
      }
    } catch(err){
      const msgs = {
        "auth/email-already-in-use": lang==="it"?"Email già in uso":"Email already in use",
        "auth/invalid-email":        lang==="it"?"Email non valida":"Invalid email",
        "auth/weak-password":        lang==="it"?"Password troppo corta (min 6 caratteri)":"Password too short (min 6 chars)",
        "auth/invalid-credential":   lang==="it"?"Email o password errati":"Wrong email or password",
        "auth/user-not-found":       lang==="it"?"Utente non trovato":"User not found",
        "auth/wrong-password":       lang==="it"?"Password errata":"Wrong password",
      };
      setAuthError(msgs[err.code] || err.message);
    }
  };

  const logout = async()=>{
    await signOut(auth);
    setEmailInput(""); setPasswordInput(""); setDisplayNameInput("");
  };

  // ── MUTATIONS
  const updateStat=(stat,val)=>{ saveChar({...char,stats:{...char.stats,[stat]:val}}); setEditStat(null); };
  const updateHp=(mode)=>{
    const amt=parseInt(hpInput)||0; if(!amt) return;
    let u={...char};
    if(mode==="heal") u.hp={...char.hp,current:Math.min(char.hp.max,char.hp.current+amt)};
    else{ let d=amt,tmp=Math.min(char.hp.temp||0,d); d-=tmp; u.hp={...char.hp,temp:(char.hp.temp||0)-tmp,current:Math.max(0,char.hp.current-d)}; }
    setHpInput(""); saveChar(u);
  };
  const toggleAction=(act)=>{ if(char.actions?.[act]) setReactivateModal(act); else saveChar({...char,actions:{...char.actions,[act]:true}}); };
  const resetTurn=()=>saveChar({...char,actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false}});
  const toggleCondition=(cond)=>{ const c=char.conditions.includes(cond)?char.conditions.filter(x=>x!==cond):[...char.conditions,cond]; saveChar({...char,conditions:c}); };
  const addInvItem=()=>{ if(!invInput.trim()) return; saveChar({...char,inventory:[...(char.inventory||[]),invInput.trim()]}); setInvInput(""); };
  const removeInvItem=(i)=>{ const inv=[...char.inventory]; inv.splice(i,1); saveChar({...char,inventory:inv}); };
  const addEntry=(type,item)=>{
    const sanitized=type==="spell"?{...item,spellLevel:Number(item.spellLevel??0)}:item;
    if(type==="ability") saveChar({...char,abilities:[...(char.abilities||[]),sanitized]});
    else saveChar({...char,spells:[...(char.spells||[]),sanitized]});
    setShowAddModal(false);
  };
  const removeEntry=(type,id)=>{ if(type==="ability") saveChar({...char,abilities:(char.abilities||[]).filter(a=>a.id!==id)}); else saveChar({...char,spells:(char.spells||[]).filter(s=>s.id!==id)}); };
  const updateSpellSlot=(lv,used)=>saveChar({...char,spellSlotsUsed:{...char.spellSlotsUsed,[lv]:Math.max(0,Math.min(char.spellSlots[lv],used))}});
  const toggleSkillProf=(key)=>saveChar({...char,skillProfs:{...char.skillProfs,[key]:!char.skillProfs?.[key]}});
  const toggleSaveProf=(stat)=>saveChar({...char,savingThrowProfs:{...char.savingThrowProfs,[stat]:!char.savingThrowProfs?.[stat]}});
  const handleCreateChar=async(form)=>{
    const base=char||DEFAULT_CHAR;
    const nc={...base,id:currentUser.uid,name:form.name,class:form.class,race:form.race,level:form.level,hp:{...base.hp,max:form.hpMax,current:Math.min(base.hp.current||form.hpMax,form.hpMax)}};
    await saveCharToDb(currentUser.uid,nc); setChar(nc); setShowCreateChar(false);
  };
  const handleUseConfirm=(item,type,slotLevel)=>{
    let u={...char}; u.actions={...u.actions,[item.actionType]:true};
    if(type==="spell"&&item.spellLevel>0&&slotLevel!=null) u.spellSlotsUsed={...u.spellSlotsUsed,[slotLevel]:(u.spellSlotsUsed[slotLevel]||0)+1};
    saveChar(u); setUseModal(null);
  };

  const isDM=currentUser?.role==="dm";
  const condArr=lang==="it"?CONDITIONS_IT:CONDITIONS_EN;
  const tabs=isDM?[["dm",t.dmView],["combat",t.orderInit]]:[["sheet",t.sheet],["combat",t.combat]];
  const pb  = char ? profBonus(char.level||1) : 2;
  const atk = char ? getAttackBonus(char) : 0;
  const dc  = char ? getSpellSaveDC(char) : 10;

  // ── LOADING
  if(screen==="loading") return(
    <>
      <style>{css}</style>
      <div className="loading">⚔ {T[lang].appName}…</div>
    </>
  );

  // ── AUTH SCREEN
  if(screen==="auth") return(
    <>
      <style>{css}</style>
      <div className="auth-wrap">
        <div className="auth-box">
          <h1>⚔ {t.appName}</h1>
          <p>D&D 5e Companion</p>
          {authError&&<div style={{color:"#e74c3c",marginBottom:12,fontSize:"0.85rem",textAlign:"center"}}>{authError}</div>}
          <div className="field"><label>{t.email}</label><input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="nome@email.com"/></div>
          <div className="field"><label>{t.password}</label><input type="password" value={passwordInput} onChange={e=>setPasswordInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()} placeholder="min 6 caratteri"/></div>
          {authMode==="register"&&<>
            <div className="field"><label>{t.displayName}</label><input value={displayNameInput} onChange={e=>setDisplayNameInput(e.target.value)} placeholder="Gandalf"/></div>
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

  // ── MAIN APP
  return(
    <>
      <style>{css}</style>
      <div className="app">
        <nav className="nav">
          <span className="nav-brand">⚔ {t.appName}</span>
          <div className="nav-tabs">{tabs.map(([id,lbl])=><button key={id} className={`nav-tab ${screen===id?"active":""}`} onClick={()=>setScreen(id)}>{lbl}</button>)}</div>
          <button className="lang-btn" style={{marginRight:8}} onClick={()=>setLang(l=>l==="en"?"it":"en")}>{lang==="en"?"IT":"EN"}</button>
          <button className="btn btn-ghost btn-sm" onClick={logout}>{t.logout}</button>
        </nav>

        <main className="main">

          {/* ══ SHEET ══ */}
          {screen==="sheet"&&(
            !char?(
              <div className="no-char">
                <h2>{t.createChar}</h2>
                <p style={{color:"var(--muted)",marginBottom:24}}>{lang==="it"?"Crea il tuo personaggio per iniziare.":"Create your character to get started."}</p>
                <button className="btn btn-primary" onClick={()=>setShowCreateChar(true)}>{t.createChar}</button>
              </div>
            ):(<>
              <div className="card">
                <div className="char-header">
                  <div className="char-info">
                    <div className="char-name" onClick={()=>setShowCreateChar(true)}>{char.name}</div>
                    <div className="char-sub">{char.race} · {char.class} · Lv {char.level}</div>
                    {(char.conditions.length>0||char.concentration)&&(
                      <div className="badges" style={{marginTop:8}}>
                        {char.conditions.map(c=><span key={c} className="badge badge-red">{c}</span>)}
                        {char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
                      </div>
                    )}
                  </div>
                  <div className="meta-grid">
                    {[["ac",t.ac],["speed",t.speed],["initiative",t.initiative]].map(([k,lbl])=>(
                      <div key={k} className="meta-item">
                        <input type="number" style={{width:60,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1.4rem",textAlign:"center",fontWeight:700,outline:"none"}}
                          value={char[k]} onChange={e=>saveChar({...char,[k]:+e.target.value})}/>
                        <div className="meta-label">{lbl}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">{lang==="it"?"Caratteristiche":"Ability Scores"}</div>
                <div className="stat-grid">{STATS.map(s=><StatBox key={s} stat={s} value={char.stats[s]} lang={lang} onClick={()=>setEditStat(s)}/>)}</div>
              </div>

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
                    <select value={char.spellcastingStat||"INT"} onChange={e=>saveChar({...char,spellcastingStat:e.target.value})}
                      style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}>
                      {STATS.map(s=><option key={s} value={s}>{lang==="it"?STAT_IT[s]:s}</option>)}
                    </select>
                  </div>
                  <div style={{flex:1,minWidth:140}}>
                    <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.attackBonusExtra}</div>
                    <input type="number" value={char.attackBonusExtra||0} onChange={e=>saveChar({...char,attackBonusExtra:+e.target.value})}
                      style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}/>
                  </div>
                </div>
              </div>

              <div className="two-col">
                <SkillsSection char={char} lang={lang} onToggle={toggleSkillProf}/>
                <SavingThrowsSection char={char} lang={lang} onToggle={toggleSaveProf}/>
              </div>

              <div className="card">
                <div className="card-title">{t.hp}</div>
                <HpBar current={char.hp.current} max={char.hp.max}/>
                <div className="hp-row">
                  <div className="hp-nums" style={{color:char.hp.current===0?"#e74c3c":char.hp.current<char.hp.max/4?"#f39c12":"var(--text)"}}>
                    {char.hp.current} / {char.hp.max}
                    {char.hp.temp>0&&<span style={{fontSize:"0.9rem",color:"#9b7be0",marginLeft:8}}>+{char.hp.temp} {t.temp}</span>}
                  </div>
                  <div className="quick-hp">
                    <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>e.key==="Enter"&&updateHp(hpMode)}/>
                    <button className="btn btn-green btn-sm" onClick={()=>{setHpMode("heal");updateHp("heal");}}>{t.heal}</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>{setHpMode("damage");updateHp("damage");}}>{t.damage}</button>
                  </div>
                </div>
                <div className="sep"/>
                <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                  <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>Max HP</div>
                    <input type="number" min={1} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}} value={char.hp.max} onChange={e=>saveChar({...char,hp:{...char.hp,max:+e.target.value}})}/>
                  </div>
                  <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>{t.temp}</div>
                    <input type="number" min={0} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}} value={char.hp.temp||0} onChange={e=>saveChar({...char,hp:{...char.hp,temp:+e.target.value}})}/>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="section-header"><span className="section-title">{t.abilities}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAddModal("ability")}>+ {t.addAbility}</button></div>
                {(char.abilities||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noAbilities}</p>
                  :<div className="ability-list">{(char.abilities||[]).map(a=>(
                    <div key={a.id} className="ability-card">
                      <div className="ability-card-info"><div className="ability-card-name">{a.name}</div>{a.desc&&<div className="ability-card-desc">{a.desc}</div>}</div>
                      <div className="ability-card-meta"><ActionTag actionKey={a.actionType} lang={lang}/><button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>removeEntry("ability",a.id)}>×</button></div>
                    </div>
                  ))}</div>
                }
              </div>

              <div className="card">
                <div className="section-header"><span className="section-title">{t.spells}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAddModal("spell")}>+ {t.addSpell}</button></div>
                {(char.spells||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noSpells}</p>
                  :<div className="ability-list">{(char.spells||[]).map(s=>(
                    <div key={s.id} className="ability-card">
                      <div className="ability-card-info"><div className="ability-card-name">{s.name}</div>{s.desc&&<div className="ability-card-desc">{s.desc}</div>}</div>
                      <div className="ability-card-meta">
                        <span style={{fontSize:"0.7rem",color:"var(--accent2)",fontWeight:700,background:"rgba(123,94,167,0.12)",padding:"3px 8px",borderRadius:99,border:"1px solid rgba(123,94,167,0.25)"}}>{s.spellLevel===0?(lang==="it"?"Trucchetto":"Cantrip"):`Lv ${s.spellLevel}`}</span>
                        <ActionTag actionKey={s.actionType} lang={lang}/>
                        <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>removeEntry("spell",s.id)}>×</button>
                      </div>
                    </div>
                  ))}</div>
                }
              </div>

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
                        <button className="slot-btn" onClick={()=>saveChar({...char,spellSlots:{...char.spellSlots,[lv]:Math.max(0,(char.spellSlots[lv]||0)-1)},spellSlotsUsed:{...char.spellSlotsUsed,[lv]:Math.min(char.spellSlotsUsed[lv]||0,Math.max(0,(char.spellSlots[lv]||0)-1))}})}>−</button>
                        <span style={{flex:1,textAlign:"center",fontSize:"0.75rem",color:"var(--muted)"}}>{char.spellSlots[lv]||0}</span>
                        <button className="slot-btn" onClick={()=>saveChar({...char,spellSlots:{...char.spellSlots,[lv]:(char.spellSlots[lv]||0)+1}})}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-title">{t.inventory}</div>
                <div className="inv-list">{(char.inventory||[]).map((item,i)=><div key={i} className="inv-item"><span>{item}</span><button onClick={()=>removeInvItem(i)}>×</button></div>)}</div>
                <div className="inv-input-row">
                  <input className="inv-input" value={invInput} onChange={e=>setInvInput(e.target.value)} placeholder={t.addItem} onKeyDown={e=>e.key==="Enter"&&addInvItem()}/>
                  <button className="btn btn-ghost btn-sm" onClick={addInvItem}>+</button>
                </div>
              </div>

              <div className="card">
                <div className="card-title">{t.notes}</div>
                <textarea className="notes-area" value={char.notes||""} onChange={e=>saveChar({...char,notes:e.target.value})}/>
              </div>
            </>)
          )}

          {/* ══ COMBAT ══ */}
          {screen==="combat"&&char&&(<>
            <div className="card">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <span style={{fontFamily:"Cinzel,serif",fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1.5px"}}>{lang==="it"?"Turno":"Combat Turn"}</span>
                <button className="btn btn-ghost btn-sm" onClick={resetTurn}>{t.resetTurn}</button>
              </div>
              <div className="action-row">
                {ACTION_KEYS.map((key,i)=>{
                  const used=char.actions?.[key]||false;
                  const c=actionColor(key);
                  return(
                    <div key={key} className={`action-btn${used?" consumed":""}`}
                      style={!used?{borderColor:c.border,background:c.bg,color:c.text}:{}}
                      onClick={()=>toggleAction(key)}>
                      <div className="action-dot" style={!used?{background:c.text}:{}}/>
                      <div className="action-label">{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</div>
                      <div className="action-status" style={{fontSize:"0.6rem",marginTop:3}}>{used?(lang==="it"?"✗ Usata":"✗ Used"):(lang==="it"?"✓ Disponibile":"✓ Available")}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-title">{t.hp}</div>
              <HpBar current={char.hp.current} max={char.hp.max}/>
              <div className="hp-row">
                <div className="hp-nums" style={{color:char.hp.current===0?"#e74c3c":char.hp.current<char.hp.max/4?"#f39c12":"var(--text)"}}>
                  {char.hp.current} / {char.hp.max}
                  {char.hp.temp>0&&<span style={{fontSize:"0.9rem",color:"#9b7be0",marginLeft:8}}>+{char.hp.temp}</span>}
                </div>
                <div className="quick-hp">
                  <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>e.key==="Enter"&&updateHp(hpMode)}/>
                  <button className="btn btn-green btn-sm" onClick={()=>{setHpMode("heal");updateHp("heal");}}>{t.heal}</button>
                  <button className="btn btn-danger btn-sm" onClick={()=>{setHpMode("damage");updateHp("damage");}}>{t.damage}</button>
                </div>
              </div>
            </div>

            {(char.abilities||[]).length>0&&(
              <div className="card">
                <div className="card-title">{t.abilities}</div>
                <div className="ability-list">
                  {(char.abilities||[]).map(a=>{
                    const depleted=char.actions?.[a.actionType]||false;
                    const c=actionColor(a.actionType);
                    return(
                      <div key={a.id} className={`combat-ability ${depleted?"depleted":""}`} style={{borderColor:depleted?"var(--border)":c.border}} onClick={()=>!depleted&&setUseModal({item:a,type:"ability"})}>
                        <div className="combat-ability-header">
                          <span className="combat-ability-name">{a.name}</span>
                          <ActionTag actionKey={a.actionType} lang={lang}/>
                          {depleted&&<span style={{fontSize:"0.7rem",color:"var(--red)",fontWeight:700}}>{t.used}</span>}
                        </div>
                        {a.desc&&<div className="combat-ability-desc">{a.desc}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(char.spells||[]).length>0&&(
              <div className="card">
                <div className="card-title">{t.spells}</div>
                <div className="ability-list">
                  {(char.spells||[]).map(s=>{
                    const sLv=Number(s.spellLevel??0);
                    const slts=char.spellSlots||{}; const uSlts=char.spellSlotsUsed||{};
                    const actionDepleted=char.actions?.[s.actionType]||false;
                    const noSlots=sLv>0&&!SPELL_SLOTS.some(lv=>lv>=sLv&&((Number(slts[lv])||0)-(Number(uSlts[lv])||0))>0);
                    const depleted=actionDepleted||noSlots;
                    const slotsLeft=sLv>0?SPELL_SLOTS.filter(lv=>lv>=sLv).reduce((acc,lv)=>acc+Math.max(0,(Number(slts[lv])||0)-(Number(uSlts[lv])||0)),0):null;
                    const c=actionColor(s.actionType);
                    return(
                      <div key={s.id} className={`combat-ability ${depleted?"depleted":""}`} style={{borderColor:depleted?"var(--border)":c.border}} onClick={()=>!depleted&&setUseModal({item:s,type:"spell"})}>
                        <div className="combat-ability-header">
                          <span className="combat-ability-name">{s.name}</span>
                          <span style={{fontSize:"0.72rem",color:"var(--accent2)",fontWeight:700,background:"rgba(123,94,167,0.12)",padding:"2px 8px",borderRadius:99,border:"1px solid rgba(123,94,167,0.25)"}}>{sLv===0?(lang==="it"?"Trucchetto":"Cantrip"):`Lv ${sLv}`}</span>
                          <ActionTag actionKey={s.actionType} lang={lang}/>
                          {slotsLeft!==null&&!depleted&&<span style={{fontSize:"0.7rem",color:"var(--muted)"}}>{slotsLeft} slot</span>}
                          {noSlots&&<span style={{fontSize:"0.7rem",color:"var(--red)",fontWeight:700}}>{t.cantUse}</span>}
                          {actionDepleted&&!noSlots&&<span style={{fontSize:"0.7rem",color:"#f39c12",fontWeight:700}}>{t.used}</span>}
                        </div>
                        {s.desc&&<div className="combat-ability-desc">{s.desc}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-title">{t.conditions}</div>
              <div className="cond-grid">
                {condArr.map((c,i)=><div key={c} className={`cond-chip ${char.conditions.includes(CONDITIONS_EN[i])?"active":""}`} onClick={()=>toggleCondition(CONDITIONS_EN[i])}>{c}</div>)}
              </div>
              <div className="sep"/>
              <div className="conc-toggle" onClick={()=>saveChar({...char,concentration:!char.concentration})}>
                <div className={`toggle ${char.concentration?"on":""}`}/>
                <span>{t.concentration}</span>
                {char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
              </div>
            </div>
          </>)}

          {screen==="combat"&&(
            <div className="card">
              <div className="card-title">{t.orderInit}</div>
              {allChars.length===0?<p style={{color:"var(--muted)",fontSize:"0.9rem"}}>{t.noChars}</p>
                :<div className="init-list">
                  {[...allChars].sort((a,b)=>(b.initiative||0)-(a.initiative||0)).map(c=>(
                    <div key={c.id} className="init-item" style={c.id===currentUser?.uid?{borderColor:"var(--accent)"}:{}}>
                      <div className="init-num">{c.initiative>=0?"+":""}{c.initiative}</div>
                      <div className="init-name">{c.name}</div>
                      <div style={{fontSize:"0.85rem",color:c.hp.current===0?"#e74c3c":c.hp.current<c.hp.max/4?"#f39c12":"var(--muted)"}}>{c.hp.current}/{c.hp.max} HP</div>
                      <div className="badges">
                        {c.conditions?.map(cond=><span key={cond} className="badge badge-red" style={{padding:"2px 6px",fontSize:"0.65rem"}}>{lang==="it"?CONDITIONS_IT[CONDITIONS_EN.indexOf(cond)]:cond}</span>)}
                        {c.concentration&&<span className="badge badge-purple" style={{padding:"2px 6px",fontSize:"0.65rem"}}>⦿</span>}
                      </div>
                    </div>
                  ))}
                </div>
              }
            </div>
          )}

          {/* ══ DM: PLAYER SHEET VIEW ══ */}
          {screen==="dm"&&dmViewChar&&(()=>{
            const dc_char = dmViewChar.data;
            const dc_pb   = profBonus(dc_char.level||1);
            const dc_atk  = getAttackBonus(dc_char);
            const dc_dc   = getSpellSaveDC(dc_char);
            const dc_save = async(updated)=>{ await saveDmChar(updated); };
            // local wrappers that operate on dmViewChar instead of char
            const dcUpdateStat=(stat,val)=>{ dc_save({...dc_char,stats:{...dc_char.stats,[stat]:val}}); setEditStat(null); };
            const dcUpdateHp=(mode)=>{
              const amt=parseInt(hpInput)||0; if(!amt) return;
              let u={...dc_char};
              if(mode==="heal") u.hp={...dc_char.hp,current:Math.min(dc_char.hp.max,dc_char.hp.current+amt)};
              else{ let d=amt,tmp=Math.min(dc_char.hp.temp||0,d); d-=tmp; u.hp={...dc_char.hp,temp:(dc_char.hp.temp||0)-tmp,current:Math.max(0,dc_char.hp.current-d)}; }
              setHpInput(""); dc_save(u);
            };
            const dcToggleSkillProf=(key)=>dc_save({...dc_char,skillProfs:{...dc_char.skillProfs,[key]:!dc_char.skillProfs?.[key]}});
            const dcToggleSaveProf=(stat)=>dc_save({...dc_char,savingThrowProfs:{...dc_char.savingThrowProfs,[stat]:!dc_char.savingThrowProfs?.[stat]}});
            const dcToggleCondition=(cond)=>{ const c=dc_char.conditions.includes(cond)?dc_char.conditions.filter(x=>x!==cond):[...dc_char.conditions,cond]; dc_save({...dc_char,conditions:c}); };
            const dcAddInvItem=()=>{ if(!invInput.trim()) return; dc_save({...dc_char,inventory:[...(dc_char.inventory||[]),invInput.trim()]}); setInvInput(""); };
            const dcRemoveInvItem=(i)=>{ const inv=[...dc_char.inventory]; inv.splice(i,1); dc_save({...dc_char,inventory:inv}); };
            const dcAddEntry=(type,item)=>{
              const sanitized=type==="spell"?{...item,spellLevel:Number(item.spellLevel??0)}:item;
              if(type==="ability") dc_save({...dc_char,abilities:[...(dc_char.abilities||[]),sanitized]});
              else dc_save({...dc_char,spells:[...(dc_char.spells||[]),sanitized]});
              setShowAddModal(false);
            };
            const dcRemoveEntry=(type,id)=>{ if(type==="ability") dc_save({...dc_char,abilities:(dc_char.abilities||[]).filter(a=>a.id!==id)}); else dc_save({...dc_char,spells:(dc_char.spells||[]).filter(s=>s.id!==id)}); };
            const dcUpdateSpellSlot=(lv,used)=>dc_save({...dc_char,spellSlotsUsed:{...dc_char.spellSlotsUsed,[lv]:Math.max(0,Math.min(dc_char.spellSlots[lv],used))}});
            const dcToggleAction=(act)=>{ if(dc_char.actions?.[act]) dc_save({...dc_char,actions:{...dc_char.actions,[act]:false}}); else dc_save({...dc_char,actions:{...dc_char.actions,[act]:true}}); };
            const dcResetTurn=()=>dc_save({...dc_char,actions:{action:false,bonusAction:false,reaction:false,freeAction:false,movement:false}});
            const dcHandleUseConfirm=(item,type2,slotLevel)=>{ let u={...dc_char}; u.actions={...u.actions,[item.actionType]:true}; if(type2==="spell"&&item.spellLevel>0&&slotLevel!=null) u.spellSlotsUsed={...u.spellSlotsUsed,[slotLevel]:(u.spellSlotsUsed[slotLevel]||0)+1}; dc_save(u); setUseModal(null); };
            return(<>
              {/* DM banner + back button */}
              <div className="dm-banner">
                <span style={{flex:1}}>👁 {t.inspecting} <strong>{dc_char.name}</strong> — {t.dmEditBanner}</span>
                <button className="dm-back-btn" onClick={()=>{ setDmViewChar(null); setEditStat(null); setShowAddModal(false); setUseModal(null); }}>{t.backToDm}</button>
              </div>

              {/* Header */}
              <div className="card">
                <div className="char-header">
                  <div className="char-info">
                    <div className="char-name">{dc_char.name}</div>
                    <div className="char-sub">{dc_char.race} · {dc_char.class} · Lv {dc_char.level}</div>
                    {(dc_char.conditions.length>0||dc_char.concentration)&&(
                      <div className="badges" style={{marginTop:8}}>
                        {dc_char.conditions.map(c=><span key={c} className="badge badge-red">{c}</span>)}
                        {dc_char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
                      </div>
                    )}
                  </div>
                  <div className="meta-grid">
                    {[["ac",t.ac],["speed",t.speed],["initiative",t.initiative]].map(([k,lbl])=>(
                      <div key={k} className="meta-item">
                        <input type="number" style={{width:60,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1.4rem",textAlign:"center",fontWeight:700,outline:"none"}}
                          value={dc_char[k]} onChange={e=>dc_save({...dc_char,[k]:+e.target.value})}/>
                        <div className="meta-label">{lbl}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ability Scores */}
              <div className="card">
                <div className="card-title">{lang==="it"?"Caratteristiche":"Ability Scores"}</div>
                <div className="stat-grid">{STATS.map(s=><StatBox key={s} stat={s} value={dc_char.stats[s]} lang={lang} onClick={()=>setEditStat(s)}/>)}</div>
              </div>
              {editStat&&<EditStatModal stat={editStat} value={dc_char.stats[editStat]} lang={lang} onSave={v=>dcUpdateStat(editStat,v)} onClose={()=>setEditStat(null)}/>}

              {/* Quick Bonuses */}
              <div className="card">
                <div className="card-title">{lang==="it"?"Bonus Rapidi":"Quick Bonuses"}</div>
                <div className="quick-stats">
                  <div className="quick-stat-box"><div className="quick-stat-val green">{modStr(dc_pb)}</div><div className="quick-stat-label">{t.proficiencyBonus}</div></div>
                  <div className="quick-stat-box"><div className="quick-stat-val blue">{modStr(dc_atk)}</div><div className="quick-stat-label">{t.attackBonus}</div></div>
                  <div className="quick-stat-box"><div className="quick-stat-val purple">{dc_dc}</div><div className="quick-stat-label">{t.spellSaveDC}</div></div>
                </div>
                <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:16}}>
                  <div style={{flex:1,minWidth:140}}>
                    <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.spellcastingStat}</div>
                    <select value={dc_char.spellcastingStat||"INT"} onChange={e=>dc_save({...dc_char,spellcastingStat:e.target.value})}
                      style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}>
                      {STATS.map(s=><option key={s} value={s}>{lang==="it"?STAT_IT[s]:s}</option>)}
                    </select>
                  </div>
                  <div style={{flex:1,minWidth:140}}>
                    <div style={{fontSize:"0.7rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{t.attackBonusExtra}</div>
                    <input type="number" value={dc_char.attackBonusExtra||0} onChange={e=>dc_save({...dc_char,attackBonusExtra:+e.target.value})}
                      style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"8px 10px",borderRadius:8,fontFamily:"Lato,sans-serif",fontSize:"0.9rem",outline:"none"}}/>
                  </div>
                </div>
              </div>

              {/* Skills + Saving Throws */}
              <div className="two-col">
                <SkillsSection char={dc_char} lang={lang} onToggle={dcToggleSkillProf}/>
                <SavingThrowsSection char={dc_char} lang={lang} onToggle={dcToggleSaveProf}/>
              </div>

              {/* HP */}
              <div className="card">
                <div className="card-title">{t.hp}</div>
                <HpBar current={dc_char.hp.current} max={dc_char.hp.max}/>
                <div className="hp-row">
                  <div className="hp-nums" style={{color:dc_char.hp.current===0?"#e74c3c":dc_char.hp.current<dc_char.hp.max/4?"#f39c12":"var(--text)"}}>
                    {dc_char.hp.current} / {dc_char.hp.max}
                    {dc_char.hp.temp>0&&<span style={{fontSize:"0.9rem",color:"#9b7be0",marginLeft:8}}>+{dc_char.hp.temp} {t.temp}</span>}
                  </div>
                  <div className="quick-hp">
                    <input type="number" min={0} value={hpInput} onChange={e=>setHpInput(e.target.value)} placeholder={t.amount} onKeyDown={e=>e.key==="Enter"&&dcUpdateHp(hpMode)}/>
                    <button className="btn btn-green btn-sm" onClick={()=>{setHpMode("heal");dcUpdateHp("heal");}}>{t.heal}</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>{setHpMode("damage");dcUpdateHp("damage");}}>{t.damage}</button>
                  </div>
                </div>
                <div className="sep"/>
                <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                  <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>Max HP</div>
                    <input type="number" min={1} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}} value={dc_char.hp.max} onChange={e=>dc_save({...dc_char,hp:{...dc_char.hp,max:+e.target.value}})}/>
                  </div>
                  <div><div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:4}}>{t.temp}</div>
                    <input type="number" min={0} style={{width:70,background:"var(--bg)",border:"1px solid var(--border)",color:"var(--text)",padding:"4px 6px",borderRadius:6,fontFamily:"Cinzel,serif",fontSize:"1rem",textAlign:"center",outline:"none"}} value={dc_char.hp.temp||0} onChange={e=>dc_save({...dc_char,hp:{...dc_char.hp,temp:+e.target.value}})}/>
                  </div>
                </div>
              </div>

              {/* Combat actions */}
              <div className="card">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <span style={{fontFamily:"Cinzel,serif",fontSize:"0.75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1.5px"}}>{lang==="it"?"Turno":"Combat Turn"}</span>
                  <button className="btn btn-ghost btn-sm" onClick={dcResetTurn}>{t.resetTurn}</button>
                </div>
                <div className="action-row">
                  {ACTION_KEYS.map((key,i)=>{
                    const used=dc_char.actions?.[key]||false;
                    const c=actionColor(key);
                    return(
                      <div key={key} className={`action-btn${used?" consumed":""}`}
                        style={!used?{borderColor:c.border,background:c.bg,color:c.text}:{}}
                        onClick={()=>dcToggleAction(key)}>
                        <div className="action-dot" style={!used?{background:c.text}:{}}/>
                        <div className="action-label">{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</div>
                        <div className="action-status" style={{fontSize:"0.6rem",marginTop:3}}>{used?(lang==="it"?"✗ Usata":"✗ Used"):(lang==="it"?"✓ Disponibile":"✓ Available")}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Conditions */}
              <div className="card">
                <div className="card-title">{t.conditions}</div>
                <div className="cond-grid">
                  {condArr.map((c,i)=><div key={c} className={`cond-chip ${dc_char.conditions.includes(CONDITIONS_EN[i])?"active":""}`} onClick={()=>dcToggleCondition(CONDITIONS_EN[i])}>{c}</div>)}
                </div>
                <div className="sep"/>
                <div className="conc-toggle" onClick={()=>dc_save({...dc_char,concentration:!dc_char.concentration})}>
                  <div className={`toggle ${dc_char.concentration?"on":""}`}/>
                  <span>{t.concentration}</span>
                  {dc_char.concentration&&<span className="badge badge-purple">{t.conc}</span>}
                </div>
              </div>

              {/* Abilities */}
              <div className="card">
                <div className="section-header"><span className="section-title">{t.abilities}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAddModal("ability")}>+ {t.addAbility}</button></div>
                {(dc_char.abilities||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noAbilities}</p>
                  :<div className="ability-list">{(dc_char.abilities||[]).map(a=>(
                    <div key={a.id} className="ability-card">
                      <div className="ability-card-info"><div className="ability-card-name">{a.name}</div>{a.desc&&<div className="ability-card-desc">{a.desc}</div>}</div>
                      <div className="ability-card-meta">
                        <ActionTag actionKey={a.actionType} lang={lang}/>
                        <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>dcRemoveEntry("ability",a.id)}>×</button>
                      </div>
                    </div>
                  ))}</div>
                }
                {showAddModal==="ability"&&<AddAbilityModal lang={lang} type="ability" onSave={item=>dcAddEntry("ability",item)} onClose={()=>setShowAddModal(false)}/>}
              </div>

              {/* Spells */}
              <div className="card">
                <div className="section-header"><span className="section-title">{t.spells}</span><button className="btn btn-ghost btn-sm" onClick={()=>setShowAddModal("spell")}>+ {t.addSpell}</button></div>
                {(dc_char.spells||[]).length===0?<p style={{color:"var(--muted)",fontSize:"0.85rem"}}>{t.noSpells}</p>
                  :<div className="ability-list">{(dc_char.spells||[]).map(s=>(
                    <div key={s.id} className="ability-card">
                      <div className="ability-card-info"><div className="ability-card-name">{s.name}</div>{s.desc&&<div className="ability-card-desc">{s.desc}</div>}</div>
                      <div className="ability-card-meta">
                        <span style={{fontSize:"0.7rem",color:"var(--accent2)",fontWeight:700,background:"rgba(123,94,167,0.12)",padding:"3px 8px",borderRadius:99,border:"1px solid rgba(123,94,167,0.25)"}}>{s.spellLevel===0?(lang==="it"?"Trucchetto":"Cantrip"):`Lv ${s.spellLevel}`}</span>
                        <ActionTag actionKey={s.actionType} lang={lang}/>
                        <button style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:"1.1rem"}} onClick={()=>dcRemoveEntry("spell",s.id)}>×</button>
                      </div>
                    </div>
                  ))}</div>
                }
                {showAddModal==="spell"&&<AddAbilityModal lang={lang} type="spell" onSave={item=>dcAddEntry("spell",item)} onClose={()=>setShowAddModal(false)}/>}
              </div>

              {/* Spell Slots */}
              <div className="card">
                <div className="card-title">{t.spellSlots}</div>
                <div className="spell-grid">
                  {SPELL_SLOTS.map(lv=>(
                    <div key={lv} className="spell-slot">
                      <div className="spell-slot-label">Lv {lv}</div>
                      <div className="spell-pips">
                        {Array.from({length:dc_char.spellSlots[lv]||0}).map((_,i)=>(
                          <div key={i} className={`pip ${i<(dc_char.spellSlotsUsed[lv]||0)?"full":""}`} onClick={()=>dcUpdateSpellSlot(lv,i<(dc_char.spellSlotsUsed[lv]||0)?i:i+1)}/>
                        ))}
                        {(dc_char.spellSlots[lv]||0)===0&&<span style={{fontSize:"0.7rem",color:"var(--muted)"}}>—</span>}
                      </div>
                      <div className="slot-controls">
                        <button className="slot-btn" onClick={()=>dc_save({...dc_char,spellSlots:{...dc_char.spellSlots,[lv]:Math.max(0,(dc_char.spellSlots[lv]||0)-1)},spellSlotsUsed:{...dc_char.spellSlotsUsed,[lv]:Math.min(dc_char.spellSlotsUsed[lv]||0,Math.max(0,(dc_char.spellSlots[lv]||0)-1))}})}>−</button>
                        <span style={{flex:1,textAlign:"center",fontSize:"0.75rem",color:"var(--muted)"}}>{dc_char.spellSlots[lv]||0}</span>
                        <button className="slot-btn" onClick={()=>dc_save({...dc_char,spellSlots:{...dc_char.spellSlots,[lv]:(dc_char.spellSlots[lv]||0)+1}})}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Inventory */}
              <div className="card">
                <div className="card-title">{t.inventory}</div>
                <div className="inv-list">{(dc_char.inventory||[]).map((item,i)=><div key={i} className="inv-item"><span>{item}</span><button onClick={()=>dcRemoveInvItem(i)}>×</button></div>)}</div>
                <div className="inv-input-row">
                  <input className="inv-input" value={invInput} onChange={e=>setInvInput(e.target.value)} placeholder={t.addItem} onKeyDown={e=>e.key==="Enter"&&dcAddInvItem()}/>
                  <button className="btn btn-ghost btn-sm" onClick={dcAddInvItem}>+</button>
                </div>
              </div>

              {/* Notes */}
              <div className="card">
                <div className="card-title">{t.notes}</div>
                <textarea className="notes-area" value={dc_char.notes||""} onChange={e=>dc_save({...dc_char,notes:e.target.value})}/>
              </div>

              {/* UseModal for combat abilities */}
              {useModal&&<UseModal lang={lang} item={useModal.item} type={useModal.type} char={dc_char} onConfirm={(slot)=>dcHandleUseConfirm(useModal.item,useModal.type,slot)} onClose={()=>setUseModal(null)}/>}
            </>);
          })()}

          {/* ══ DM VIEW ══ */}
          {screen==="dm"&&!dmViewChar&&(<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h2 style={{fontFamily:"Cinzel,serif",color:"var(--accent)"}}>{t.allChars}</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadAllChars}>{lang==="it"?"Aggiorna":"Refresh"}</button>
            </div>
            <p style={{color:"var(--muted)",fontSize:"0.82rem",marginBottom:12}}>🖊 {lang==="it"?"Clicca su un personaggio per aprirne la scheda":"Click a character card to open their full sheet"}</p>
            {allChars.filter(c=>c.role!=="dm").length===0?<p style={{color:"var(--muted)"}}>{t.noChars}</p>
              :<div className="char-cards">
                {allChars.filter(c=>c.role!=="dm").map(c=>(
                  <div key={c.id} className="char-card char-card-clickable" onClick={()=>setDmViewChar({id:c.id,data:c})}>
                    <div className="char-card-name">{c.name}</div>
                    <div className="char-card-sub">{c.race} · {c.class} · Lv {c.level}</div>
                    <HpBar current={c.hp.current} max={c.hp.max}/>
                    <div style={{fontSize:"0.85rem",margin:"6px 0"}}>{c.hp.current}/{c.hp.max} HP{c.hp.temp>0?` (+${c.hp.temp})`:""}</div>
                    <div className="char-card-stats">
                      <div className="char-card-stat"><div className="char-card-stat-val">{c.ac}</div><div className="char-card-stat-label">{t.ac}</div></div>
                      <div className="char-card-stat"><div className="char-card-stat-val">{c.initiative>=0?"+":""}{c.initiative}</div><div className="char-card-stat-label">Init</div></div>
                      <div className="char-card-stat"><div className="char-card-stat-val">{modStr(profBonus(c.level||1))}</div><div className="char-card-stat-label">Prof</div></div>
                      <div className="char-card-stat"><div className="char-card-stat-val">{getSpellSaveDC(c)}</div><div className="char-card-stat-label">DC</div></div>
                    </div>
                    {c.conditions?.length>0&&<div className="badges" style={{marginTop:8}}>{c.conditions.map(cond=><span key={cond} className="badge badge-red">{lang==="it"?CONDITIONS_IT[CONDITIONS_EN.indexOf(cond)]:cond}</span>)}</div>}
                    {c.concentration&&<span className="badge badge-purple" style={{marginTop:6,display:"inline-block"}}>{t.conc}</span>}
                    {ACTION_KEYS.some(k=>c.actions?.[k])&&(
                      <div className="badges" style={{marginTop:8}}>
                        {ACTION_KEYS.map((k,i)=>c.actions?.[k]?<span key={k} className="badge" style={{background:"rgba(192,57,43,0.12)",color:"#e74c3c",border:"1px solid rgba(192,57,43,0.3)"}}>{lang==="it"?ACTION_TYPES_IT[i]:ACTION_TYPES_EN[i]}</span>:null)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            }
          </>)}

        </main>
      </div>

      {editStat&&<EditStatModal stat={editStat} value={char.stats[editStat]} lang={lang} onSave={v=>updateStat(editStat,v)} onClose={()=>setEditStat(null)}/>}
      {showCreateChar&&<CreateCharModal lang={lang} char={char} onSave={handleCreateChar} onClose={()=>setShowCreateChar(false)}/>}
      {showAddModal&&<AddAbilityModal lang={lang} type={showAddModal} onSave={item=>addEntry(showAddModal,item)} onClose={()=>setShowAddModal(false)}/>}
      {useModal&&<UseModal lang={lang} item={useModal.item} type={useModal.type} char={char} onConfirm={(slot)=>handleUseConfirm(useModal.item,useModal.type,slot)} onClose={()=>setUseModal(null)}/>}
      {reactivateModal&&(
        <div className="modal-overlay" onClick={()=>setReactivateModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
            <h3>{t.reactivateTitle}</h3>
            <div style={{background:"var(--bg)",border:`1px solid ${actionColor(reactivateModal).border}`,borderRadius:10,padding:14,marginBottom:18,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:12,height:12,borderRadius:"50%",background:actionColor(reactivateModal).text,flexShrink:0}}/>
              <span style={{fontFamily:"Cinzel,serif",fontWeight:700,color:actionColor(reactivateModal).text}}>
                {lang==="it"?ACTION_TYPES_IT[ACTION_KEYS.indexOf(reactivateModal)]:ACTION_TYPES_EN[ACTION_KEYS.indexOf(reactivateModal)]}
              </span>
            </div>
            <p style={{color:"var(--muted)",fontSize:"0.9rem",lineHeight:1.5,marginBottom:20}}>{t.reactivateMsg}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setReactivateModal(null)}>{t.cancel}</button>
              <button className="btn btn-primary" onClick={()=>{saveChar({...char,actions:{...char.actions,[reactivateModal]:false}});setReactivateModal(null);}}>{t.reactivate}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
