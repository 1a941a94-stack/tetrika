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

  if (!user) return <main className="shell loginShell">
    <section className="loginCard">
      <div className="eyebrow">SALES CALL AI</div>
      <h1>Контроль качества продаж без ручной расшифровки</h1>
      <p>Загрузите запись — сервис выделит спикеров, расшифрует диалог и даст разбор по вашей методологии.</p>
      <form onSubmit={login} className="stack">
        <input type="email" placeholder="Рабочая почта" value={email} onChange={e=>setEmail(e.target.value)} required />
        <button>Получить ссылку для входа</button>
      </form>
      {message && <div className="notice">{message}</div>}
    </section>
  </main>

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">SALES CALL AI</div><strong>Разбор звонков</strong></div>
      <div className="userline"><span>{user.email}</span><button className="ghost" onClick={()=>db.auth.signOut()}>Выйти</button></div>
    </header>

    <section className="heroGrid">
      <div>
        <h1>Записи → транскрипт → разбор</h1>
        <p>11 этапов продажи, доказательства из диалога и точечные рекомендации руководителю.</p>
      </div>
      <form className="uploadCard" onSubmit={upload}>
        <input name="title" placeholder="Название звонка" />
        <input name="manager" placeholder="Менеджер" />
        <input name="file" type="file" accept="audio/*,video/mp4,video/webm" required />
        <button disabled={uploading}>{uploading ? 'Загрузка…' : 'Загрузить и проанализировать'}</button>
      </form>
    </section>
    {message && <div className="notice">{message}</div>}

    <section className="workspace">
      <div className="panel listPanel">
        <div className="panelHead"><h2>Звонки</h2><span>{calls.length}</span></div>
        <div className="callList">
          {calls.map(c=><button key={c.id} className={`callRow ${selected?.id===c.id?'active':''}`} onClick={()=>openCall(c)}>
            <div><strong>{c.title}</strong><small>{c.manager_name || 'Менеджер не указан'} · {new Date(c.created_at).toLocaleString('ru-RU')}</small></div>
            <div className="callMeta"><span className={`badge ${c.status}`}>{statusLabels[c.status] || c.status}</span><b>{c.overall_score == null ? '—' : `${Math.round(c.overall_score)}/100`}</b></div>
          </button>)}
          {!calls.length && <div className="empty">Пока нет записей.</div>}
        </div>
      </div>

      <div className="panel detailPanel">
        {!selected ? <div className="empty big">Выберите звонок слева</div> : <>
          <div className="detailHero">
            <div><span className="badge">{statusLabels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.manager_name || 'Менеджер не указан'} · {mmss(selected.duration_seconds)}</p></div>
            <div className="score">{selected.overall_score == null ? '—' : Math.round(selected.overall_score)}<small>/100</small></div>
          </div>
          {selected.summary && <div className="summary">{selected.summary}</div>}
          <h3>Методология</h3>
          <div className="steps">
            {steps.map((s,i)=><article className="step" key={s.step_id}>
              <div className="stepIndex">{i+1}</div>
              <div className="stepBody"><div className="stepTitle"><strong>{s.rubric_steps?.title || `Этап ${s.step_id}`}</strong><span className={`badge ${s.status}`}>{s.status==='passed'?'Выполнено':s.status==='partial'?'Частично':s.status==='failed'?'Не выполнено':'Н/П'}</span><b>{Math.round(s.score)}</b></div><p>{s.comment}</p>{s.recommendation && <small><b>Рекомендация:</b> {s.recommendation}</small>}</div>
            </article>)}
            {!steps.length && <div className="empty">Анализ появится после обработки.</div>}
          </div>
          <h3>Транскрипт</h3>
          <div className="transcript">
            {segments.map((s,i)=><div className="segment" key={s.id}><span>{s.speaker || `S${i+1}`}<small>{mmss(s.start_seconds)}</small></span><p>{s.text}</p></div>)}
            {!segments.length && <div className="empty">Транскрипт ещё не готов.</div>}
          </div>
        </>}
      </div>
    </section>
  </main>
}
