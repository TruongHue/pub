# AI Astrology Avatar Web App (Free Mode)

Full-stack app with a realtime astrology pipeline (free-friendly):

1. User submits profile + question.
2. Backend generates Vietnamese astrology text via [OpenRouter](https://openrouter.ai/) (`OPENROUTER_MODEL`).
3. Frontend reads the response using browser SpeechSynthesis (`vi-VN`).
4. Avatar panel animates while speaking to mimic livestream style.
5. Result streams back through Socket.io to Angular UI.

## Project Structure

```text
/backend
  /controllers
  /services
  /routes
  server.js

/frontend
  /src/app
    /components
      /chat
      /avatar
      /input-form
    /services
```

## Setup

### 1) Backend env

Copy and fill:

```bash
cd backend
copy .env.example .env
```

LLM (OpenRouter):

- `OPENROUTER_KEY` — bắt buộc nếu muốn gọi API; nếu thiếu hoặc mọi model đều lỗi, backend dùng bản horoscope fallback nội bộ.
- `OPENROUTER_MODEL` — mặc định `openai/gpt-4o-mini`. Các slug free (ví dụ `:free`, `openrouter/free`) thường bị giới hạn **free-models-per-day** → HTTP **429**. Cách xử lý: nạp credit trên OpenRouter, đổi sang model trả phí/rẻ, hoặc đặt `OPENROUTER_FALLBACK_MODEL` là model dự phòng.
- `OPENROUTER_FALLBACK_MODEL` — tùy chọn: thử thêm một model khi model chính trả 429 hoặc lỗi.

### 2) Run backend

```bash
cd backend
npm install
npm run dev
```

Backend listens on `http://localhost:3000`.

### 3) Run frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs on `http://localhost:4200`.

## API Integration Examples

### REST endpoint

`POST /api/horoscope`

Sample request:

```bash
curl -X POST http://localhost:3000/api/horoscope ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Linh\",\"birthDate\":\"2001-08-14\",\"birthTime\":\"08:30\",\"question\":\"Nam nay tinh yeu cua minh se ra sao?\"}"
```

Sample response shape:

```json
{
  "text": "Linh, ...",
  "mood": "mysterious"
}
```

### Socket.io events

- Client emits: `ask-horoscope`
- Server emits:
  - `ai-status`
  - `ai-response`
  - `ai-error`

Payload emitted by `ai-response`:

```json
{
  "text": "...",
  "mood": "mysterious"
}
```

## Notes

This version removes ElevenLabs and AKOOL so you can demo with near-zero cost. Voice runs in-browser and does not require paid TTS.
