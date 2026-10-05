'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type CallRow = {
  id:string; created_at:string; title:string; manager_id?:string|null; manager_name:string|null; group_id?:string|null; department_id?:string|null; source_filename:string;
  status:string; duration_seconds:number|null; overall_score:number|null; summary:string|null; sale_outcome?:'won'|'lost'|'pending'|'unknown'
}
type Manager = { id:string; name:string; email?:string|null; is_active:boolean; group_id?:string|null; department_id?:string|null; created_at?:string }
type SalesGroup = { id:string; name:string; department_id:string; rg_name?:string }
type RoleInfo = { role:'rop'|'rg'; department_id:string; group_id?:string|null }
type Step = {
  call_id?:string; step_id:number; status:'passed'|'partial'|'failed'|'not_applicable'; score:number; comment:string;
  recommendation:string|null; evidence:Array<{quote?:string; start?:number; end?:number; speaker?:string}>;
  rubric_steps?:{title:string}
}
type Segment = {id:number; start_seconds:number; end_seconds:number; speaker:string|null; text:string}
type Insight = {
  id?:number|string; call_id?:string; insight_type:'praise'|'issue'|'pain'|'objection'|'objection_handled'|'objection_unhandled'|'product_link'|'goal'|'decision';
  label:string; detail:string; speaker?:string|null; start_seconds:number; end_seconds:number;
  related_start_seconds?:number|null; related_end_seconds?:number|null; severity:number; tags?:string[]
}

const statusLabels:Record<string,string> = {
  uploaded:'Загружен',queued:'В очереди',transcribing:'Транскрибация',transcribed:'Транскрибирован',analyzing:'Анализ',completed:'Готово',failed:'Ошибка'
}
const stepTitles = ['Приветствие / смол-толк','Присутствие родителя','План урока','Знакомство с Р и У','ВП','Практика','Постановка целей','Презентация продукта','Предзакрытие до тарифов','Тарифы / попытка сделки','Отработка возражений']
const mmss=(sec?:number|null)=>sec==null?'—':`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`

const DEMO_GROUPS:SalesGroup[] = [
  {id:'g1',name:'Группа Анны Петровой',department_id:'d1',rg_name:'Анна Петрова'},
  {id:'g2',name:'Группа Ильи Орлова',department_id:'d1',rg_name:'Илья Орлов'}
]
const DEMO_MANAGERS:Manager[] = [
  {id:'m1',name:'Екатерина',email:'ekaterina@example.com',is_active:true,group_id:'g1',department_id:'d1'},
  {id:'m2',name:'Алексей',email:'alexey@example.com',is_active:true,group_id:'g2',department_id:'d1'},
  {id:'m3',name:'Мария',email:'maria@example.com',is_active:true,group_id:'g1',department_id:'d1'}
]

const DEMO_CALLS:CallRow[] = [
  {id:'demo-1',created_at:new Date().toISOString(),title:'Диагностический урок — Анна',manager_id:'m1',manager_name:'Екатерина',group_id:'g1',department_id:'d1',source_filename:'demo.mp3',status:'completed',duration_seconds:3274,overall_score:74,summary:'Потребность выявлена хорошо, но менеджер пропустил предзакрытие и слишком быстро перешёл к цене.',sale_outcome:'lost'},
  {id:'demo-2',created_at:new Date(Date.now()-86400000).toISOString(),title:'Повторный звонок — Мария',manager_id:'m2',manager_name:'Алексей',group_id:'g2',department_id:'d1',source_filename:'demo2.mp3',status:'completed',duration_seconds:2810,overall_score:86,summary:'Сильная работа с болью и хорошее закрытие на следующий шаг.',sale_outcome:'won'},
  {id:'demo-3',created_at:new Date(Date.now()-2*86400000).toISOString(),title:'Первичная консультация — Илья',manager_id:'m1',manager_name:'Екатерина',group_id:'g1',department_id:'d1',source_filename:'demo3.mp3',status:'completed',duration_seconds:3012,overall_score:68,summary:'Слишком ранняя презентация продукта и слабая отработка цены.',sale_outcome:'lost'},
  {id:'demo-4',created_at:new Date(Date.now()-3*86400000).toISOString(),title:'Диагностика — София',manager_id:'m2',manager_name:'Алексей',group_id:'g2',department_id:'d1',source_filename:'demo4.mp3',status:'completed',duration_seconds:3440,overall_score:91,summary:'Структурный звонок с хорошим предзакрытием и сильной работой с возражениями.',sale_outcome:'won'}
]

const DEMO_STEPS:Step[] = [
  [1,'partial',60,'Приветствие есть, но полноценного смол-толка почти нет.','Добавить 20–40 секунд естественного контакта до деловой части.',[{quote:'Анна, добрый вечер. Меня хорошо слышно?',start:3,end:12,speaker:'Менеджер'}]],
  [2,'passed',100,'Присутствие родителя обозначено в начале встречи.','Сохранить текущую формулировку.',[{quote:'Мама сегодня с нами, верно?',start:74,end:81,speaker:'Менеджер'}]],
  [3,'passed',90,'План встречи озвучен понятно.','После плана коротко сверять ожидания клиента.',[{quote:'Сначала познакомимся, потом посмотрим практику и в конце обсудим варианты.',start:28,end:41,speaker:'Менеджер'}]],
  [4,'passed',85,'Знакомство проведено последовательно.','Сделать переход к следующему этапу естественнее.',[]],
  [5,'passed',92,'Менеджер хорошо раскрыл мотивацию и текущую проблему.','Сохранять формулировки клиента для дальнейшей презентации.',[{quote:'Хотелось бы, чтобы она стала увереннее и могла заниматься без постоянных напоминаний.',start:50,end:70,speaker:'Клиент'}]],
  [6,'passed',80,'Практика связана с запросом ученика.','После практики явно проговаривать наблюдаемый результат.',[]],
  [7,'passed',88,'Цель сформулирована конкретно.','Зафиксировать приоритетную цель одной фразой.',[]],
  [8,'passed',84,'Продукт связан с ранее озвученной проблемой.','Чаще использовать формулировки самого клиента.',[{quote:'Мы постепенно даём ребёнку самостоятельность и фиксируем прогресс.',start:921,end:949,speaker:'Менеджер'}]],
  [9,'failed',20,'Перед тарифами нет вопроса предзакрытия — переход к цене происходит сразу.','Перед тарифами спросить: «Если программа закрывает эти задачи, готовы рассмотреть обучение?»',[{quote:'У нас есть три тарифа. Базовый стоит 4 900 рублей…',start:2412,end:2435,speaker:'Менеджер'}]],
  [10,'partial',65,'Тарифы представлены понятно, но попытка сделки размыта.','Завершать выбором из двух вариантов и конкретным следующим шагом.',[]],
  [11,'partial',68,'Возражение по цене принято, но причина сомнения не раскрыта.','Уточнить, что именно останавливает: сумма или ценность относительно результата.',[{quote:'Для нас это дороговато, я ожидала сумму поменьше.',start:2436,end:2450,speaker:'Клиент'}]]
].map(([step_id,status,score,comment,recommendation,evidence]:any)=>({step_id,status,score,comment,recommendation,evidence,rubric_steps:{title:stepTitles[step_id-1]}}))

const DEMO_SEGMENTS:Segment[] = [
  {id:1,start_seconds:3,end_seconds:12,speaker:'Менеджер',text:'Анна, добрый вечер. Меня хорошо слышно? Отлично, тогда предлагаю сначала познакомиться и понять вашу ситуацию.'},
  {id:2,start_seconds:13,end_seconds:27,speaker:'Клиент',text:'Да, всё хорошо. Хотим понять, подойдёт ли обучение дочери, потому что сейчас ей тяжело удерживать интерес.'},
  {id:3,start_seconds:28,end_seconds:49,speaker:'Менеджер',text:'Сначала познакомимся, потом посмотрим практику и в конце обсудим варианты. Расскажите, что сейчас получается хуже всего?'},
  {id:4,start_seconds:50,end_seconds:70,speaker:'Клиент',text:'Хотелось бы, чтобы она стала увереннее и могла заниматься без постоянных напоминаний.'},
  {id:5,start_seconds:74,end_seconds:90,speaker:'Менеджер',text:'Мама сегодня с нами, верно? Отлично. Тогда буду иногда обращаться и к вам тоже.'},
  {id:6,start_seconds:921,end_seconds:949,speaker:'Менеджер',text:'Тогда покажу, как программа решает именно эту задачу: мы постепенно даём ребёнку самостоятельность и фиксируем прогресс.'},
  {id:7,start_seconds:2412,end_seconds:2435,speaker:'Менеджер',text:'У нас есть три тарифа. Базовый стоит 4 900 рублей в месяц, следующий — 7 900.'},
  {id:8,start_seconds:2436,end_seconds:2450,speaker:'Клиент',text:'Для нас это дороговато, я ожидала сумму поменьше.'},
  {id:9,start_seconds:2451,end_seconds:2478,speaker:'Менеджер',text:'Понимаю. Там просто входит больше занятий и поддержка куратора. Можно рассмотреть базовый вариант.'}
]

const DEMO_INSIGHTS:Insight[] = [
  {id:'i1',insight_type:'issue',label:'Смол-толк слишком короткий',detail:'После приветствия менеджер почти сразу переходит к структуре встречи.',speaker:'Менеджер',start_seconds:3,end_seconds:12,severity:2,tags:['смол-толк']},
  {id:'i2',insight_type:'pain',label:'Клиент озвучил ключевую боль',detail:'Ребёнку не хватает самостоятельности и уверенности.',speaker:'Клиент',start_seconds:50,end_seconds:70,related_start_seconds:921,related_end_seconds:949,severity:3,tags:['самостоятельность','уверенность']},
  {id:'i3',insight_type:'praise',label:'Сильная связка «боль → продукт»',detail:'Менеджер возвращается к формулировке клиента и объясняет продукт через самостоятельность.',speaker:'Менеджер',start_seconds:921,end_seconds:949,related_start_seconds:50,related_end_seconds:70,severity:2,tags:['презентация','боль']},
  {id:'i4',insight_type:'issue',label:'Предзакрытие пропущено',detail:'Переход к стоимости происходит без промежуточного согласия клиента.',speaker:'Менеджер',start_seconds:2412,end_seconds:2435,severity:3,tags:['предзакрытие']},
  {id:'i5',insight_type:'objection_unhandled',label:'Возражение «дорого» раскрыто не полностью',detail:'Менеджер отвечает аргументом, но не уточняет источник сомнения.',speaker:'Клиент',start_seconds:2436,end_seconds:2450,related_start_seconds:2451,related_end_seconds:2478,severity:3,tags:['дорого','цена']}
]

export default function Home(){
  const db=useMemo(()=>supabase(),[])
  const [user,setUser]=useState<any>(null)
  const [calls,setCalls]=useState<CallRow[]>([])
  const [selected,setSelected]=useState<CallRow|null>(null)
  const [segments,setSegments]=useState<Segment[]>([])
  const [steps,setSteps]=useState<Step[]>([])
  const [insights,setInsights]=useState<Insight[]>([])
  const [allInsights,setAllInsights]=useState<Insight[]>([])
  const [view,setView]=useState<'overview'|'managers'|'calls'>('overview')
  const [managers,setManagers]=useState<Manager[]>([])
  const [groups,setGroups]=useState<SalesGroup[]>([])
  const [roleInfo,setRoleInfo]=useState<RoleInfo|null>(null)
  const [demoRole,setDemoRole]=useState<'rop'|'rg'>('rop')
  const [selectedGroup,setSelectedGroup]=useState<string>('all')
  const [allSteps,setAllSteps]=useState<Step[]>([])
  const [selectedManager,setSelectedManager]=useState<string>('all')
  const [managerDraft,setManagerDraft]=useState('')
  const [managerEmailDraft,setManagerEmailDraft]=useState('')
  const [activeTime,setActiveTime]=useState<number|null>(null)
  const [uploading,setUploading]=useState(false)
  const transcriptRef=useRef<HTMLDivElement|null>(null)

  const demo=!user
  const effectiveRole:RoleInfo = demo ? {role:demoRole,department_id:'d1',group_id:demoRole==='rg'?'g1':null} : (roleInfo || {role:'rg',department_id:'',group_id:null})
  const visibleGroups=(demo?DEMO_GROUPS:groups).filter(g=>effectiveRole.role==='rop'||g.id===effectiveRole.group_id)
  const scopeGroup=effectiveRole.role==='rg' ? (effectiveRole.group_id||'all') : selectedGroup
  const allManagers=demo?DEMO_MANAGERS:managers
  const visibleManagers=allManagers.filter(m=>scopeGroup==='all'||m.group_id===scopeGroup)
  const scopedBaseCalls=(demo?DEMO_CALLS:calls).filter(c=>scopeGroup==='all'||c.group_id===scopeGroup)
  const baseCalls=scopedBaseCalls
  const visibleCalls=selectedManager==='all'?baseCalls:baseCalls.filter(c=>c.manager_id===selectedManager || (!c.manager_id && c.manager_name===visibleManagers.find(m=>m.id===selectedManager)?.name))
  const current=demo?(selected||DEMO_CALLS[0]):selected
  const visibleSegments=demo?DEMO_SEGMENTS:segments
  const visibleSteps=demo?DEMO_STEPS:steps
  const visibleInsights=demo?DEMO_INSIGHTS:insights
  const aggregateInsights=demo?DEMO_INSIGHTS:allInsights

  async function refreshUser(){const {data}=await db.auth.getUser();setUser(data.user??null)}
  async function loadCalls(){
    const [{data:callData},{data:all},{data:managerData},{data:groupData},{data:roleData},{data:stepData}]=await Promise.all([
      db.from('calls').select('id,created_at,title,manager_id,manager_name,group_id,department_id,source_filename,status,duration_seconds,overall_score,summary,sale_outcome').order('created_at',{ascending:false}),
      db.from('call_insights').select('*'),
      db.from('managers').select('id,name,email,is_active,group_id,department_id,created_at').order('name'),
      db.from('sales_groups').select('id,name,department_id').order('name'),
      db.from('user_roles').select('role,department_id,group_id').maybeSingle(),
      db.from('analysis_step_results').select('call_id,step_id,status,score,comment,recommendation,evidence')
    ])
    setCalls((callData??[]) as CallRow[])
    setAllInsights((all??[]) as Insight[])
    setManagers((managerData??[]) as Manager[])
    setGroups((groupData??[]) as SalesGroup[])
    setRoleInfo((roleData??null) as RoleInfo|null)
    setAllSteps((stepData??[]) as Step[])
  }

  async function createManager(e:React.FormEvent){
    e.preventDefault(); if(!user || !managerDraft.trim()) return
    const groupId=effectiveRole.role==='rg'?effectiveRole.group_id:(selectedGroup==='all'?null:selectedGroup)
    if(!groupId) throw new Error('Сначала выберите группу')
    const group=groups.find(g=>g.id===groupId)
    const {error}=await db.from('managers').insert({owner_user_id:user.id,name:managerDraft.trim(),email:managerEmailDraft.trim()||null,group_id:groupId,department_id:group?.department_id||effectiveRole.department_id})
    if(error) throw error
    setManagerDraft(''); setManagerEmailDraft(''); await loadCalls()
  }
  async function openCall(call:CallRow){
    setSelected(call); setView('calls')
    if(demo) return
    const [{data:s},{data:a},{data:i}]=await Promise.all([
      db.from('transcript_segments').select('*').eq('call_id',call.id).order('segment_index'),
      db.from('analysis_step_results').select('step_id,status,score,comment,recommendation,evidence,rubric_steps(title)').eq('call_id',call.id).order('step_id'),
      db.from('call_insights').select('*').eq('call_id',call.id).order('start_seconds')
    ])
    setSegments((s??[]) as Segment[]); setSteps((a??[]) as unknown as Step[]); setInsights((i??[]) as Insight[])
  }
  useEffect(()=>{refreshUser().then(loadCalls);const {data:sub}=db.auth.onAuthStateChange(()=>refreshUser().then(loadCalls));return()=>sub.subscription.unsubscribe()},[])
  useEffect(()=>{if(!user)return;const t=setInterval(loadCalls,5000);return()=>clearInterval(t)},[user])

  function jumpTo(sec?:number|null){
    if(sec==null)return
    setActiveTime(sec);setView('calls')
    requestAnimationFrame(()=>{
      const nodes=Array.from(document.querySelectorAll<HTMLElement>('[data-start]'))
      const target=nodes.reduce((best,n)=>Math.abs(Number(n.dataset.start)-sec)<Math.abs(Number(best?.dataset.start??999999)-sec)?n:best,nodes[0])
      target?.scrollIntoView({behavior:'smooth',block:'center'})
      setTimeout(()=>setActiveTime(null),2200)
    })
  }

  async function upload(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!user)return
    const form=new FormData(e.currentTarget),file=form.get('file') as File
    if(!file?.size)return
    setUploading(true)
    try{
      const path=`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`
      const up=await db.storage.from('sales-audio').upload(path,file,{contentType:file.type||'application/octet-stream'})
      if(up.error)throw up.error
      const managerId=String(form.get('manager_id')||'')||null
      const manager=managers.find(m=>m.id===managerId)
      const managerName=manager?.name||null
      const ins=await db.from('calls').insert({user_id:user.id,title:String(form.get('title')||file.name),manager_id:managerId,manager_name:managerName,group_id:manager?.group_id||effectiveRole.group_id||null,department_id:manager?.department_id||effectiveRole.department_id,source_filename:file.name,storage_path:path,mime_type:file.type||null,status:'queued'})
      if(ins.error)throw ins.error
      e.currentTarget.reset();await loadCalls();setView('calls')
    }finally{setUploading(false)}
  }

  const scores=visibleCalls.filter(c=>c.overall_score!=null).map(c=>Number(c.overall_score))
  const avg=Math.round(scores.reduce((a,b)=>a+b,0)/(scores.length||1))
  const objections=aggregateInsights.filter(i=>i.insight_type.includes('objection'))
  const handled=aggregateInsights.filter(i=>i.insight_type==='objection_handled').length
  const unhandled=aggregateInsights.filter(i=>i.insight_type==='objection_unhandled').length
  const issueCounts=Object.entries(aggregateInsights.filter(i=>i.insight_type==='issue'||i.insight_type==='objection_unhandled').reduce((acc:any,i)=>{const k=i.tags?.[0]||i.label;acc[k]=(acc[k]||0)+1;return acc},{})).sort((a:any,b:any)=>b[1]-a[1])
  const lostCallIds=new Set(visibleCalls.filter(c=>c.sale_outcome==='lost').map(c=>c.id))
  const lostUnhandled=aggregateInsights.filter(i=>i.insight_type==='objection_unhandled' && (!i.call_id || lostCallIds.has(String(i.call_id))))
  const topLostObjection=Object.entries(lostUnhandled.reduce((acc:any,i)=>{const k=i.tags?.[0]||i.label;acc[k]=(acc[k]||0)+1;return acc},{})).sort((a:any,b:any)=>Number(b[1])-Number(a[1]))[0] as [string,number]|undefined
  const scopeCallIds=new Set(visibleCalls.map(c=>c.id))
  const scopeSteps=(demo?DEMO_STEPS:allSteps).filter(s=>demo||!s.call_id||scopeCallIds.has(String(s.call_id)))
  const stepAgg=stepTitles.map((title,idx)=>{const arr=scopeSteps.filter(s=>s.step_id===idx+1);return {title,avg:arr.length?Math.round(arr.reduce((a,s)=>a+Number(s.score),0)/arr.length):0,count:arr.length}}).sort((a,b)=>a.avg-b.avg)
  const weakest=stepAgg.filter(x=>x.count||demo).slice(0,3)
  const strongest=[...stepAgg].filter(x=>x.count||demo).sort((a,b)=>b.avg-a.avg).slice(0,3)
  const won=visibleCalls.filter(c=>c.sale_outcome==='won').length
  const lost=visibleCalls.filter(c=>c.sale_outcome==='lost').length

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark">S</div><div><strong>Sales Call AI</strong><small>{demo?`Demo · ${demoRole.toUpperCase()}`:effectiveRole.role.toUpperCase()}</small></div></div>
      <nav>
        <button className={view==='overview'?'navActive':''} onClick={()=>setView('overview')}>Обзор</button>
        <button className={view==='managers'?'navActive':''} onClick={()=>setView('managers')}>Менеджеры <span>{visibleManagers.length}</span></button>
        <button className={view==='calls'?'navActive':''} onClick={()=>setView('calls')}>Звонки <span>{visibleCalls.length}</span></button>
      </nav>
      <div className="sideBottom">{demo?<><div className="roleSwitch"><button className={demoRole==='rg'?'on':''} onClick={()=>{setDemoRole('rg');setSelectedGroup('g1')}}>РГ</button><button className={demoRole==='rop'?'on':''} onClick={()=>{setDemoRole('rop');setSelectedGroup('all')}}>РОП</button></div><div className="demoNote">Переключи роль, чтобы увидеть разные уровни доступа.</div></>:<button className="ghost" onClick={()=>db.auth.signOut()}>Выйти</button>}</div>
    </aside>

    <section className="mainArea">
      <header className="appTop">
        <div><div className="eyebrow">{view==='overview'?'КОМАНДА / АНАЛИТИКА':view==='managers'?'КОМАНДА / МЕНЕДЖЕРЫ':'ЗВОНОК / QA'}</div><h1>{view==='overview'?'Контроль качества продаж':view==='managers'?'Менеджеры':'Разбор звонка'}</h1></div>
        {!demo&&view!=='managers'&&<form className="miniUpload" onSubmit={upload}><input name="title" placeholder="Название"/><select name="manager_id" defaultValue=""><option value="">Менеджер</option>{managers.filter(m=>m.is_active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><input name="file" type="file" accept="audio/*,video/*" required/><button disabled={uploading}>{uploading?'…':'Загрузить'}</button></form>}
      </header>

      {view==='overview'?<div className="overview">
        <div className="filterBar"><strong>{effectiveRole.role==='rop'?'Группа:':'Менеджер:'}</strong>{effectiveRole.role==='rop'&&<><button className={selectedGroup==='all'?'filterActive':''} onClick={()=>{setSelectedGroup('all');setSelectedManager('all')}}>Весь отдел</button>{visibleGroups.map(g=><button key={g.id} className={selectedGroup===g.id?'filterActive':''} onClick={()=>{setSelectedGroup(g.id);setSelectedManager('all')}}>{g.rg_name||g.name}</button>)}</>}<button className={selectedManager==='all'?'filterActive':''} onClick={()=>setSelectedManager('all')}>{effectiveRole.role==='rop'?'Все менеджеры':'Вся группа'}</button>{visibleManagers.map(m=><button key={m.id} className={selectedManager===m.id?'filterActive':''} onClick={()=>setSelectedManager(m.id)}>{m.name}</button>)}</div>
        <section className="metricGrid">
          <article><span>Средний балл</span><strong>{avg}</strong><small>по {visibleCalls.length} звонкам</small></article>
          <article><span>Встреч проведено</span><strong>{visibleCalls.length}</strong><small>{won} продаж · {lost} без продажи</small></article>
          <article><span>Неотработанное возражение</span><strong className="textMetric">{topLostObjection?.[0]||'—'}</strong><small>{topLostObjection?topLostObjection[1]+' раз после него не было продажи':'нет данных'}</small></article>
          <article><span>Лучший результат</span><strong>{Math.max(...scores,0)}</strong><small>{visibleCalls.slice().sort((a,b)=>(b.overall_score||0)-(a.overall_score||0))[0]?.manager_name||'—'}</small></article>
        </section>

        {effectiveRole.role==='rop'&&selectedGroup==='all'&&<section className="groupCompare">
          <div className="cardHead"><div><span className="eyebrow">РГ / СРАВНЕНИЕ</span><h2>Группы отдела</h2></div></div>
          <div className="groupGrid">{visibleGroups.map(g=>{const gc=(demo?DEMO_CALLS:calls).filter(x=>x.group_id===g.id);const gs=gc.filter(x=>x.overall_score!=null).map(x=>Number(x.overall_score));const ga=Math.round(gs.reduce((a,b)=>a+b,0)/(gs.length||1));const gw=gc.filter(x=>x.sale_outcome==='won').length;return <button className="groupCard" key={g.id} onClick={()=>setSelectedGroup(g.id)}><div><strong>{g.rg_name||g.name}</strong><small>{g.name}</small></div><div><b>{ga||'—'}</b><span>ср. балл</span></div><div><b>{gc.length}</b><span>встреч</span></div><div><b>{gw}</b><span>продаж</span></div></button>})}</div>
        </section>}
        <section className="qualityGrid">
          <div className="card"><div className="cardHead"><div><span className="eyebrow">ПРОВАЛЬНЫЕ ЭТАПЫ</span><h2>Требуют внимания</h2></div></div><div className="stageRank">{weakest.map((x,i)=><div key={x.title}><span>{i+1}</span><strong>{x.title}</strong><b>{x.avg}</b></div>)}</div></div>
          <div className="card"><div className="cardHead"><div><span className="eyebrow">СИЛЬНЫЕ ЭТАПЫ</span><h2>Что получается лучше</h2></div></div><div className="stageRank good">{strongest.map((x,i)=><div key={x.title}><span>{i+1}</span><strong>{x.title}</strong><b>{x.avg}</b></div>)}</div></div>
        </section>
        <section className="overviewGrid">
          <div className="card">
            <div className="cardHead"><div><span className="eyebrow">ЗВОНКИ</span><h2>Последние разборы</h2></div><button className="linkBtn" onClick={()=>setView('calls')}>Все звонки →</button></div>
            <div className="tableList">{visibleCalls.map(c=><button key={c.id} onClick={()=>openCall(c)} className="tableRow"><div><strong>{c.title}</strong><small>{c.manager_name||'—'} · {new Date(c.created_at).toLocaleDateString('ru-RU')}</small></div><div className="scorePill">{Math.round(c.overall_score||0)}</div></button>)}</div>
          </div>
          <div className="card">
            <div className="cardHead"><div><span className="eyebrow">ПРОБЛЕМЫ</span><h2>Что чаще всего проседает</h2></div></div>
            <div className="rankList">{issueCounts.length?issueCounts.slice(0,5).map(([name,count]:any,i)=><div key={name}><span>{i+1}</span><div><strong>{name}</strong><small>{count} эпизод{count===1?'':'а'}</small></div><b>{count}</b></div>):<div className="empty">Пока недостаточно данных</div>}</div>
          </div>
          <div className="card wide">
            <div className="cardHead"><div><span className="eyebrow">ВОЗРАЖЕНИЯ</span><h2>Отработанные и неотработанные</h2></div></div>
            <div className="insightGrid">{aggregateInsights.filter(i=>i.insight_type==='objection_handled'||i.insight_type==='objection_unhandled').map((i,idx)=><button key={idx} className={'insightCard '+i.insight_type} onClick={()=>{setSelected(DEMO_CALLS[0]);jumpTo(i.start_seconds)}}><span className="insightType">{i.insight_type==='objection_handled'?'Отработано':'Не отработано'}</span><strong>{i.label}</strong><p>{i.detail}</p><small>{mmss(i.start_seconds)} → открыть фрагмент</small></button>)}
              {!aggregateInsights.some(i=>i.insight_type.includes('objection_'))&&<div className="empty">Сводка появится после первых обработанных звонков.</div>}
            </div>
          </div>
        </section>
      </div>:view==='managers'?<div className="managersView">
        {!demo&&<form className="managerCreate" onSubmit={createManager}><div><span className="eyebrow">НОВЫЙ МЕНЕДЖЕР</span><h2>Добавить сотрудника</h2></div><input value={managerDraft} onChange={e=>setManagerDraft(e.target.value)} placeholder="Имя менеджера" required/><input value={managerEmailDraft} onChange={e=>setManagerEmailDraft(e.target.value)} placeholder="Email, необязательно"/><button>Добавить</button></form>}
        <div className="managerGrid">{visibleManagers.map(m=>{
          const mc=baseCalls.filter(c=>c.manager_id===m.id || (!c.manager_id&&c.manager_name===m.name))
          const ms=mc.filter(c=>c.overall_score!=null).map(c=>Number(c.overall_score))
          const mav=Math.round(ms.reduce((a,b)=>a+b,0)/(ms.length||1))
          const today=mc.filter(c=>new Date(c.created_at).toDateString()===new Date().toDateString()).length
          const best=Math.max(...ms,0)
          return <article className="managerCard" key={m.id}>
            <div className="managerHead"><div className="avatar">{m.name.slice(0,1).toUpperCase()}</div><div><strong>{m.name}</strong><small>{m.email||'Без email'}</small></div><span className={m.is_active?'activeDot':'inactiveDot'}>{m.is_active?'Активен':'Выключен'}</span></div>
            <div className="managerStats"><div><span>Средний балл</span><b>{mav||'—'}</b></div><div><span>Сегодня</span><b>{today}</b></div><div><span>Всего уроков</span><b>{mc.length}</b></div><div><span>Лучший</span><b>{best||'—'}</b></div></div>
            <div className="managerActions"><button onClick={()=>{setSelectedManager(m.id);setView('overview')}}>Статистика</button><button onClick={()=>{setSelectedManager(m.id);setView('calls')}}>Звонки →</button></div>
          </article>
        })}</div>
      </div>:<div className="callsView">
        <aside className="callRail">
          <div className="railHead"><div><strong>Звонки</strong><select value={selectedManager} onChange={e=>setSelectedManager(e.target.value)}><option value="all">Весь отдел</option>{visibleManagers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div><span>{visibleCalls.length}</span></div>
          {visibleCalls.map(c=><button key={c.id} className={current?.id===c.id?'railCall active':''} onClick={()=>openCall(c)}><div><strong>{c.title}</strong><small>{c.manager_name||'—'} · {mmss(c.duration_seconds)}</small></div><b>{Math.round(c.overall_score||0)}</b></button>)}
        </aside>

        <section className="callContent">
          {!current?<div className="empty big">Выберите звонок</div>:<>
            <div className="callHero"><div><span className="status">{statusLabels[current.status]}</span><h2>{current.title}</h2><p>{current.manager_name||'—'} · {mmss(current.duration_seconds)}</p></div><div className="bigScore">{Math.round(current.overall_score||0)}<small>/100</small></div></div>
            <div className="split">
              <div className="analysisPane">
                <div className="paneTitle"><div><span className="eyebrow">АНАЛИЗ</span><h3>Что произошло в звонке</h3></div></div>
                <div className="summaryBox">{current.summary}</div>

                <div className="momentList">
                  {visibleInsights.map((i,idx)=><article key={i.id||idx} className={'moment '+i.insight_type}>
                    <div className="momentTop"><span>{i.insight_type==='praise'?'Сильный момент':i.insight_type==='pain'?'Боль клиента':i.insight_type==='product_link'?'Связка с продуктом':i.insight_type.includes('objection')?'Возражение':'Точка роста'}</span><button onClick={()=>jumpTo(i.start_seconds)}>{mmss(i.start_seconds)} ↗</button></div>
                    <strong>{i.label}</strong><p>{i.detail}</p>
                    {i.related_start_seconds!=null&&i.related_start_seconds!==i.start_seconds&&<button className="relation" onClick={()=>jumpTo(i.related_start_seconds)}>Связанный фрагмент · {mmss(i.related_start_seconds)} →</button>}
                  </article>)}
                </div>

                <h3 className="sectionTitle">11 этапов</h3>
                <div className="stepList">{visibleSteps.map(s=><article className="stepCard" key={s.step_id}>
                  <div className="stepTop"><span>{s.step_id}</span><strong>{s.rubric_steps?.title||stepTitles[s.step_id-1]}</strong><b className={'state '+s.status}>{s.status==='passed'?'✓':s.status==='partial'?'~':s.status==='failed'?'!':'—'} {Math.round(s.score)}</b></div>
                  <p>{s.comment}</p>
                  {s.evidence?.length>0&&<div className="evidenceRow">{s.evidence.map((e,j)=><button key={j} onClick={()=>jumpTo(e.start)}>«{e.quote?.slice(0,55)}{(e.quote?.length||0)>55?'…':''}» <span>{mmss(e.start)}</span></button>)}</div>}
                  {s.recommendation&&<small><b>Рекомендация:</b> {s.recommendation}</small>}
                </article>)}</div>
              </div>

              <div className="transcriptPane" ref={transcriptRef}>
                <div className="paneTitle sticky"><div><span className="eyebrow">ТРАНСКРИПТ</span><h3>Диалог по таймкодам</h3></div><span className="legend">Клик из анализа переносит сюда</span></div>
                <div className="transcriptList">{visibleSegments.map((s,i)=>{
                  const near=activeTime!=null&&Math.abs(s.start_seconds-activeTime)<35
                  const marks=visibleInsights.filter(x=>x.start_seconds>=s.start_seconds-2&&x.start_seconds<=s.end_seconds+2)
                  return <div key={s.id} data-start={s.start_seconds} className={'segmentRow '+(near?'flash ':'')+(s.speaker==='Клиент'?'client':'manager')}>
                    <div className="segMeta"><span>{mmss(s.start_seconds)}</span><strong>{s.speaker||`S${i+1}`}</strong></div>
                    <div className="segText"><p>{s.text}</p>{marks.length>0&&<div className="segMarks">{marks.map((m,k)=><button key={k} onClick={()=>jumpTo(m.related_start_seconds??m.start_seconds)} className={m.insight_type}>{m.label}{m.related_start_seconds&&m.related_start_seconds!==m.start_seconds?' ↔':''}</button>)}</div>}</div>
                  </div>
                })}</div>
              </div>
            </div>
          </>}
        </section>
      </div>}
    </section>
  </main>
}
