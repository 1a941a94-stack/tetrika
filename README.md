# Sales Call AI

Сервис контроля качества продаж: запись → транскрипция с разделением спикеров → анализ по 11 этапам → оценка и рекомендации.

## Что уже создано

- Supabase project: `sales-call-ai`
- приватный Storage bucket `sales-audio`
- таблицы `calls`, `transcript_segments`, `rubric_steps`, `analysis_step_results`, `analysis_runs`
- RLS: пользователь видит только свои записи
- Next.js веб-панель с magic-link входом и загрузкой аудио
- Python worker с FFmpeg, diarization и AI-анализом
- Docker Compose
- GitHub Actions workflow для автодеплоя на VPS

## Архитектура

```text
Browser / Next.js
  ├─ Supabase Auth
  ├─ Supabase Storage (private audio)
  └─ Supabase Postgres (queue/status/results)
             ↓
        Python worker
  ├─ FFmpeg normalization
  ├─ OpenAI gpt-4o-transcribe-diarize
  └─ OpenAI Responses API → structured sales QA
```

## Быстрый запуск

### 1. Web

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Публичный ключ Supabase уже указан в `.env.example`; его можно безопасно использовать в браузере вместе с RLS.

### 2. Worker

```bash
cd worker
cp .env.example .env
```

Заполните два серверных секрета:

- `SUPABASE_SECRET_KEY` — Supabase Dashboard → Project Settings → API Keys → Secret key. Никогда не размещайте его в браузере или Git.
- `OPENAI_API_KEY` — ключ OpenAI API.

Затем:

```bash
docker compose up -d --build
```

Из корня репозитория команда поднимет web на `:3000` и worker.

## Первый вход

В панели укажите email. Supabase отправит magic link. Для production укажите URL вашего сервиса в Supabase Auth → URL Configuration → Site URL / Redirect URLs.

## Методология анализа

1. Приветствие / смол-толк
2. Присутствие родителя
3. План урока
4. Знакомство с Р и У
5. ВП
6. Практика
7. Постановка целей
8. Презентация продукта
9. Предзакрытие **до тарифов**
10. Презентация тарифов / попытка сделки
11. Отработка возражений

Модель не должна засчитывать этап без подтверждения в транскрипте. Для каждого этапа сохраняются статус, балл, комментарий, рекомендация и цитаты-доказательства с таймкодами.

## Длинные записи

Worker автоматически пережимает большие записи FFmpeg в mono 24 kHz / 32 kbps перед отправкой, сохраняя временную шкалу. Оригинал остаётся в приватном Supabase Storage.

## Автодеплой из GitHub

Создайте secrets репозитория:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PROJECT_DIR`

На VPS один раз клонируйте репозиторий, создайте `web/.env.local` и `worker/.env`. После этого push в `main` запускает `docker compose build && docker compose up -d`.
