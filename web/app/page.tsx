'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type CallRow = {
  id: string
  created_at: string
  title: string
  manager_name: string | null
  source_filename: string
  status: string
  duration_seconds: number | null
  overall_score: number | null
  summary: string | null
}

type Step = {
  step_id: number
  status: 'passed'|'partial'|'failed'|'not_applicable'
  score: number
  comment: string
  recommendation: string | null
  evidence: Array<{quote?: string; start?: number; end?: number; speaker?: string}>
  rubric_steps?: { title: string }
}

type Segment = { id:number; start_seconds:number; end_seconds:number; speaker:string|null; text:string }

const statusLabels: Record<string,string> = {
  uploaded:'Загружен', queued:'В очереди', transcribing:'Транскрибация', transcribed:'Транскрибирован', analyzing:'Анализ', completed:'Готово', failed:'Ошибка'
}

const DEMO_CALL: CallRow = {
  id:'demo-1',
  created_at:new Date().toISOString(),
  title:'Диагностический урок — Анна',
  manager_name:'Екатерина',
  source_filename:'demo.mp3',
  status:'completed',
  duration_seconds:3274,
  overall_score:74,
  summary:'Менеджер хорошо выявил потребность и связал продукт с целью клиента, но пропустил предзакрытие перед тарифами и слишком быстро перешёл к цене.'
}

const DEMO_STEPS: Step[] = [
  {step_id:1,status:'partial',score:60,comment:'Приветствие есть, но полноценного смол-толка нет.',recommendation:'Добавить 20–40 секунд естественного контакта до деловой части.',evidence:[],rubric_steps:{title:'Приветствие / смол-толк'}},
  {step_id:2,status:'passed',score:100,comment:'Присутствие родителя обозначено в начале встречи.',recommendation:'Сохранить текущую формулировку.',evidence:[],rubric_steps:{title:'Присутствие родителя'}},
  {step_id:3,status:'passed',score:90,comment:'План урока озвучен и клиент понимает последовательность встречи.',recommendation:'Коротко сверять ожидания клиента после плана.',evidence:[],rubric_steps:{title:'План урока'}},
  {step_id:4,status:'passed',score:85,comment:'Знакомство с Р и У проведено последовательно.',recommendation:'Можно сделать переход к следующему этапу чуть естественнее.',evidence:[],rubric_steps:{title:'Знакомство с Р и У'}},
  {step_id:5,status:'passed',score:92,comment:'Потребность выявлена глубоко: выяснены текущая ситуация, мотивация и ожидания.',recommendation:'Продолжать фиксировать ключевые формулировки клиента для презентации.',evidence:[],rubric_steps:{title:'ВП'}},
  {step_id:6,status:'passed',score:80,comment:'Практика проведена и связана с запросом ученика.',recommendation:'После практики явно проговаривать наблюдаемый результат.',evidence:[],rubric_steps:{title:'Практика'}},
  {step_id:7,status:'passed',score:88,comment:'Цели сформулированы конкретно и связаны со сроком.',recommendation:'Зафиксировать приоритетную цель одной фразой.',evidence:[],rubric_steps:{title:'Постановка целей'}},
  {step_id:8,status:'passed',score:84,comment:'Продукт презентован через выявленные потребности, а не только через функции.',recommendation:'Чаще использовать формулировки самого клиента.',evidence:[],rubric_steps:{title:'Презентация продукта'}},
  {step_id:9,status:'failed',score:20,comment:'Предзакрытие перед тарифами отсутствует: менеджер сразу переходит к стоимости.',recommendation:'До тарифов задать вопрос: «Если программа закрывает эти задачи, готовы рассмотреть обучение?»',evidence:[],rubric_steps:{title:'Предзакрытие до тарифов'}},
  {step_id:10,status:'partial',score:65,comment:'Тарифы представлены понятно, но попытка сделки недостаточно конкретная.',recommendation:'Завершать презентацию выбором из двух вариантов и конкретным следующим шагом.',evidence:[],rubric_steps:{title:'Тарифы / попытка сделки'}},
  {step_id:11,status:'partial',score:68,comment:'Возражение по цене принято, но не раскрыта причина сомнения.',recommendation:'Сначала уточнить: «Вас останавливает сама сумма или ценность относительно результата?»',evidence:[],rubric_steps:{title:'Отработка возражений'}}
]

const DEMO_SEGMENTS: Segment[] = [
  {id:1,start_seconds:3,end_seconds:12,speaker:'Менеджер',text:'Анна, добрый вечер. Меня хорошо слышно? Отлично, тогда предлагаю сначала познакомиться и понять вашу ситуацию.'},
  {id:2,start_seconds:13,end_seconds:27,speaker:'Клиент',text:'Да, всё хорошо. Хотим понять, подойдёт ли обучение дочери, потому что сейчас ей тяжело удерживать интерес.'},
  {id:3,start_seconds:28,end_seconds:49,speaker:'Менеджер',text:'Расскажите, пожалуйста, что сейчас получается хуже всего и какой результат вы хотели бы увидеть через несколько месяцев?'},
  {id:4,start_seconds:50,end_seconds:70,speaker:'Клиент',text:'Хотелось бы, чтобы она стала увереннее и могла заниматься без постоянных напоминаний.'},
  {id:5,start_seconds:921,end_seconds:949,speaker:'Менеджер',text:'Тогда покажу, как программа решает именно эту задачу: мы постепенно даём ребёнку самостоятельность и фиксируем прогресс.'},
  {id:6,start_seconds:2412,end_seconds:2435,speaker:'Менеджер',text:'У нас есть три тарифа. Базовый стоит 4 900 рублей в месяц, следующий — 7 900.'},
  {id:7,start_seconds:2436,end_seconds:2450,speaker:'Клиент',text:'Для нас это дороговато, я ожидала сумму поменьше.'},
  {id:8,start_seconds:2451,end_seconds:2478,speaker:'Менеджер',text:'Понимаю. Там просто входит больше занятий и поддержка куратора. Можно рассмотреть базовый вариант.'}
]

function mmss(sec?: number | null) {
  if (!sec && sec !== 0) return '—'
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2,'0')}`
}

export default function Home() {
  const db = useMemo(() => supabase(), [])
  const [user, setUser] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [calls, setCalls] = useState<CallRow[]>([])
  const [selected, setSelected] = useState<CallRow|null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [uploading, setUploading] = useState(false)

  async function refreshUser() {
    const { data } = await db.auth.getUser()
    setUser(data.user ?? null)
  }

  async function loadCalls() {
    const { data } = await db.from('calls').select('id,created_at,title,manager_name,source_filename,status,duration_seconds,overall_score,summary').order('created_at',{ascending:false})
    setCalls((data ?? []) as CallRow[])
    if (selected) {
      const fresh = (data ?? []).find((c:any)=>c.id===selected.id)
      if (fresh) setSelected(fresh as CallRow)
    }
  }

  async function openCall(call: CallRow) {
    setSelected(call)
    const [{data:s},{data:a}] = await Promise.all([
      db.from('transcript_segments').select('*').eq('call_id',call.id).order('segment_index'),
      db.from('analysis_step_results').select('step_id,status,score,comment,recommendation,evidence,rubric_steps(title)').eq('call_id',call.id).order('step_id')
    ])
    setSegments((s ?? []) as Segment[])
    setSteps((a ?? []) as unknown as Step[])
  }

  useEffect(()=>{
    refreshUser().then(loadCalls)
    const { data: sub } = db.auth.onAuthStateChange(()=>refreshUser().then(loadCalls))
    return ()=>sub.subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if (!user) return
    const t = setInterval(()=>loadCalls(), 5000)
    return ()=>clearInterval(t)
  },[user, selected?.id])

  async function login(e: React.FormEvent) {
    e.preventDefault(); setMessage('')
    const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setMessage(error ? error.message : 'Ссылка для входа отправлена на почту.')
  }

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!user) return
    const form = new FormData(e.currentTarget)
    const file = form.get('file') as File
    const title = String(form.get('title') || file?.name || 'Новый звонок')
    const manager = String(form.get('manager') || '')
    if (!file || !file.size) return
    setUploading(true); setMessage('')
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const path = `${user.id}/${crypto.randomUUID()}-${safe}`
      const up = await db.storage.from('sales-audio').upload(path,file,{upsert:false,contentType:file.type || 'application/octet-stream'})
      if (up.error) throw up.error
      const ins = await db.from('calls').insert({
        user_id:user.id,title,manager_name:manager || null,source_filename:file.name,storage_path:path,mime_type:file.type || null,status:'queued'
      })
      if (ins.error) throw ins.error
      e.currentTarget.reset(); await loadCalls(); setMessage('Запись загружена и поставлена в очередь.')
    } catch (err:any) { setMessage(err.message || 'Ошибка загрузки') }
    finally { setUploading(false) }
  }

  const demoMode = !user
  const visibleCalls = demoMode ? [DEMO_CALL] : calls
  const visibleSelected = demoMode ? DEMO_CALL : selected
  const visibleSteps = demoMode ? DEMO_STEPS : steps
  const visibleSegments = demoMode ? DEMO_SEGMENTS : segments

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">SALES CALL AI</div><strong>Разбор звонков</strong></div>
      <div className="userline"><span>{demoMode ? 'Демо-режим' : user.email}</span>{demoMode ? <span className="badge partial">Без авторизации</span> : <button className="ghost" onClick={()=>db.auth.signOut()}>Выйти</button>}</div>
    </header>

    <section className="heroGrid">
      <div>
        <h1>Записи → транскрипт → разбор</h1>
        <p>11 этапов продажи, доказательства из диалога и точечные рекомендации руководителю.</p>
      </div>
      {demoMode ? <div className="uploadCard"><div className="eyebrow" style={{gridColumn:'1/-1'}}>DEMO PREVIEW</div><p style={{gridColumn:'1/-1',margin:0}}>Авторизация временно обойдена только для просмотра интерфейса. Реальные записи и загрузка по-прежнему закрыты Supabase RLS.</p><button type="button" disabled>Загрузка доступна после входа</button></div> : <form className="uploadCard" onSubmit={upload}>
        <input name="title" placeholder="Название звонка" />
        <input name="manager" placeholder="Менеджер" />
        <input name="file" type="file" accept="audio/*,video/mp4,video/webm" required />
        <button disabled={uploading}>{uploading ? 'Загрузка…' : 'Загрузить и проанализировать'}</button>
      </form>}
    </section>
    {message && <div className="notice">{message}</div>}

    <section className="workspace">
      <div className="panel listPanel">
        <div className="panelHead"><h2>Звонки</h2><span>{visibleCalls.length}</span></div>
        <div className="callList">
          {visibleCalls.map(c=><button key={c.id} className={`callRow ${visibleSelected?.id===c.id?'active':''}`} onClick={()=>{ if(!demoMode) openCall(c) }}>
            <div><strong>{c.title}</strong><small>{c.manager_name || 'Менеджер не указан'} · {new Date(c.created_at).toLocaleString('ru-RU')}</small></div>
            <div className="callMeta"><span className={`badge ${c.status}`}>{statusLabels[c.status] || c.status}</span><b>{c.overall_score == null ? '—' : `${Math.round(c.overall_score)}/100`}</b></div>
          </button>)}
          {!visibleCalls.length && <div className="empty">Пока нет записей.</div>}
        </div>
      </div>

      <div className="panel detailPanel">
        {!visibleSelected ? <div className="empty big">Выберите звонок слева</div> : <>
          <div className="detailHero">
            <div><span className="badge">{statusLabels[visibleSelected.status]}</span><h2>{visibleSelected.title}</h2><p>{visibleSelected.manager_name || 'Менеджер не указан'} · {mmss(visibleSelected.duration_seconds)}</p></div>
            <div className="score">{visibleSelected.overall_score == null ? '—' : Math.round(visibleSelected.overall_score)}<small>/100</small></div>
          </div>
          {visibleSelected.summary && <div className="summary">{visibleSelected.summary}</div>}
          <h3>Методология</h3>
          <div className="steps">
            {visibleSteps.map((s,i)=><article className="step" key={s.step_id}>
              <div className="stepIndex">{i+1}</div>
              <div className="stepBody"><div className="stepTitle"><strong>{s.rubric_steps?.title || `Этап ${s.step_id}`}</strong><span className={`badge ${s.status}`}>{s.status==='passed'?'Выполнено':s.status==='partial'?'Частично':s.status==='failed'?'Не выполнено':'Н/П'}</span><b>{Math.round(s.score)}</b></div><p>{s.comment}</p>{s.recommendation && <small><b>Рекомендация:</b> {s.recommendation}</small>}</div>
            </article>)}
            {!visibleSteps.length && <div className="empty">Анализ появится после обработки.</div>}
          </div>
          <h3>Транскрипт</h3>
          <div className="transcript">
            {visibleSegments.map((s,i)=><div className="segment" key={s.id}><span>{s.speaker || `S${i+1}`}<small>{mmss(s.start_seconds)}</small></span><p>{s.text}</p></div>)}
            {!visibleSegments.length && <div className="empty">Транскрипт ещё не готов.</div>}
          </div>
        </>}
      </div>
    </section>
  </main>
}
