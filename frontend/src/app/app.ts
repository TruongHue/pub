import { Component, NgZone, OnDestroy, effect, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { InputFormComponent } from './components/input-form/input-form.component';
import { AvatarComponent } from './components/avatar/avatar.component';
import { ChatComponent, ChatMessage } from './components/chat/chat.component';
import { AstrologyService, HoroscopePayload, HoroscopeResult } from './services/astrology.service';
import {
  isReasonableOracleQuestion,
  normalizeQuestionForDedupe,
  normalizeVietnameseBirthDate,
  parseStructuredLiveComment,
  StructuredLiveFields
} from './utils/structured-live-comment';

interface LiveQueueItem {
  id?: string;
  username?: string;
  comment?: string;
  timestamp?: string | number;
  parsed?: StructuredLiveFields;
}

interface LiveStatePayload {
  mainQueue?: LiveQueueItem[];
}

interface VoiceOption {
  id: string;
  name: string;
  lang: string;
}

type VoicePreset = 'female_clear' | 'male_deep' | 'energetic';

interface OracleQueueRow {
  trackId: string;
  position: number;
  fullName: string;
  viewer: string;
  birthDisplay: string;
  questionPreview: string;
}

interface TtsChunkPlan {
  text: string;
  rate: number;
  pitch: number;
  absStart: number;
}

@Component({
  selector: 'app-root',
  imports: [InputFormComponent, AvatarComponent, ChatComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  private readonly liveApiUrl = 'http://localhost:3001';
  private readonly liveSocket: Socket;
  private liveSessionId: string = crypto.randomUUID();
  private readonly liveSeenCommentIds = new Set<string>();
  private readonly queuedOracleKeys = new Set<string>();
  /** key -> thời điểm ghi nhận; chống lặp câu hỏi (theo viewer + flood toàn cục ngắn). */
  private readonly oracleQuestionFirstSeen = new Map<string, number>();
  private readonly dedupeViewerQuestionMs = 20 * 60 * 1000;
  private readonly dedupeGlobalQuestionMs = 3 * 60 * 1000;
  private readonly oracleQueue: LiveQueueItem[] = [];
  private queueDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private liveFallbackTimer: ReturnType<typeof setInterval> | null = null;
  private liveConnected = false;
  private lastHoroscopeLoading = false;
  /** Đang chờ phản hồi API cho job lấy từ hàng chờ (để xử lý tuần tự). */
  readonly expectQueueCompletion = signal(false);
  /** Luỹ tiến hàng chờ: chờ đọc (TTS/audio) xong + cooldown ngắn trước người kế tiếp. */
  readonly awaitingQueueReadingPlayback = signal(false);
  readonly oracleQueueSize = signal(0);
  readonly oracleQueueRows = signal<OracleQueueRow[]>([]);
  /** Popup kết quả giữa màn hình. */
  readonly resultPopupOpen = signal(false);
  /** Câu hỏi (và tên) khớp với lượt xem đang hiển thị trong popup. */
  readonly resultPopupUserQuestion = signal('');
  readonly resultPopupUserName = signal('');
  private queueTurnNeedsPlaybackGate = false;
  private queueAfterReadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly astrologyService = inject(AstrologyService);
  readonly loading = this.astrologyService.loading;
  readonly latestResult = this.astrologyService.latestResult;
  readonly errorMessage = this.astrologyService.errorMessage;
  readonly isSpeaking = signal(false);
  readonly autoFillName = signal('');
  readonly autoFillBirthDate = signal('');
  readonly autoFillQuestion = signal('');
  readonly chatMessages = signal<ChatMessage[]>([
    {
      author: 'System',
      text: 'Livestream da bat. Vu tru dang lang nghe cau hoi cua ban...',
      type: 'live'
    }
  ]);
  private lastPayload: HoroscopePayload | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private vietnameseVoice: SpeechSynthesisVoice | null = null;
  private readonly ngZone = inject(NgZone);
  /** Chuỗi đang / vừa đọc TTS (khớp `latestResult().text`) — dùng map highlight theo từng mục. */
  private ttsActivePlain = '';
  private readonly ttsSegmentStarts = new Map<string, number>();
  private ttsViewportRaf: number | null = null;
  /** Vị trí ký tự (exclusive) đã đọc tới trong TTS; đồng bộ boundary event. */
  readonly ttsHighlightCharEnd = signal(0);
  readonly availableVoices = signal<VoiceOption[]>([]);
  readonly selectedVoiceId = signal<string>('auto');
  readonly selectedVoiceName = signal('Default');
  readonly selectedVoicePreset = signal<VoicePreset>('female_clear');
  private readonly onVoicesChanged = () => {
    this.refreshVoiceOptions();
  };
  private readonly fakeComments = [
    'Họ tên: Minh An\nNgày sinh: 15/08/1999\nCâu hỏi: Tuần này tình cảm của mình thế nào?',
    'Họ tên: Gia Bảo\nNgày sinh: 2001-03-22\nCâu hỏi: Có nên đổi việc trong tháng này không?',
    'Họ tên: Thu Hà\nNgày sinh: 07/12/1995\nCâu hỏi: Người cũ có quay lại không?',
    'Họ tên: Quốc Huy\nNgày sinh: 01/01/2000\nCâu hỏi: 6 tháng tới mình cần tránh điều gì?',
    'Họ tên: Lan Chi\nNgày sinh: 28/02/1998\nCâu hỏi: Cơ hội công việc đang đến không?',
    'Họ tên: Đức Anh\nNgày sinh: 11/11/1997\nCâu hỏi: Hôm nay vận may tài lộc ra sao?',
    'Họ tên: Ngọc Trâm\nNgày sinh: 03/09/2002\nCâu hỏi: Nên đầu tư hay giữ tiền lúc này?'
  ];

  constructor() {
    this.liveSocket = io(this.liveApiUrl);
    this.initLiveCommentsFlow();
    this.initSpeechVoices();
    effect(() => {
      const result = this.latestResult();
      if (result) {
        if (this.queueTurnNeedsPlaybackGate) {
          this.awaitingQueueReadingPlayback.set(true);
          this.queueTurnNeedsPlaybackGate = false;
        }
        this.resultPopupOpen.set(true);
        this.scrollReadingToTop();
        // Ket qua chi hien trong popup giua man hinh — khong day vao luong chat nhu comment.
        this.playAudioOrSpeak(result.audioUrl, result.text);
      }
    });
    effect(() => {
      const busy = this.loading();
      const err = this.errorMessage();
      void err;
      if (busy) {
        this.lastHoroscopeLoading = true;
        return;
      }

      const wasBusy = this.lastHoroscopeLoading;
      this.lastHoroscopeLoading = false;

      if (!wasBusy) {
        if (
          this.oracleQueueSize() > 0 &&
          !this.expectQueueCompletion() &&
          !this.awaitingQueueReadingPlayback()
        ) {
          this.scheduleQueueDrain(0);
        }
        return;
      }

      const pendingQueueJob = this.expectQueueCompletion();
      if (pendingQueueJob) {
        this.expectQueueCompletion.set(false);
        if (this.errorMessage()) {
          this.queueTurnNeedsPlaybackGate = false;
          this.clearQueueAfterReadingPause();
          this.awaitingQueueReadingPlayback.set(false);
          if (this.oracleQueueSize() > 0) {
            this.scheduleQueueDrain(600);
          }
        }
        // Thành công: chờ latestResult + đọc + cooldown trong onOracleReadingPlaybackEnded.
        return;
      }

      if (this.oracleQueueSize() > 0 && !this.awaitingQueueReadingPlayback()) {
        this.scheduleQueueDrain(400);
      }
    });
  }

  private readonly queueReadingCooldownMs = 5_000;

  private clearQueueAfterReadingPause(): void {
    if (!this.queueAfterReadTimer) return;
    clearTimeout(this.queueAfterReadTimer);
    this.queueAfterReadTimer = null;
  }

  /** Sau khi TTS / audio đọc kết quả xong; nếu đang lượt hàng chờ thì chờ thêm vài giây rồi gọi người tiếp theo. */
  private onOracleReadingPlaybackEnded(): void {
    if (!this.awaitingQueueReadingPlayback()) return;
    this.clearQueueAfterReadingPause();
    this.queueAfterReadTimer = window.setTimeout(() => {
      this.queueAfterReadTimer = null;
      this.awaitingQueueReadingPlayback.set(false);
      this.tryDrainOracleQueue();
    }, this.queueReadingCooldownMs);
  }

  /** Đóng popup và xử lý hàng chờ (nếu có) sau khi đọc xong. */
  private onHoroscopePlaybackFullyEnded(): void {
    this.resultPopupOpen.set(false);
    this.resetReadingHighlight();
    this.onOracleReadingPlaybackEnded();
  }

  private resetReadingHighlight(): void {
    this.ttsHighlightCharEnd.set(0);
    this.ttsActivePlain = '';
    this.ttsSegmentStarts.clear();
    if (this.ttsViewportRaf !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.ttsViewportRaf);
      this.ttsViewportRaf = null;
    }
  }

  private scrollReadingToTop(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const body = document.querySelector('.result-popup-body') as HTMLElement | null;
      if (!body) return;
      body.scrollTop = 0;
    });
  }

  /** Auto-scroll theo tiến độ ký tự đang đọc để khung popup luôn "trượt" theo nội dung. */
  private syncReadingViewportToTts(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.ttsViewportRaf !== null) {
      window.cancelAnimationFrame(this.ttsViewportRaf);
      this.ttsViewportRaf = null;
    }
    this.ttsViewportRaf = window.requestAnimationFrame(() => {
      this.ttsViewportRaf = null;
      const body = document.querySelector('.result-popup-body') as HTMLElement | null;
      if (!body) return;
      const maxScroll = body.scrollHeight - body.clientHeight;
      if (maxScroll <= 0) return;
      const totalChars = Math.max(1, this.ttsActivePlain.length);
      const progress = Math.min(1, Math.max(0, this.ttsHighlightCharEnd() / totalChars));
      body.scrollTop = maxScroll * progress;
    });
  }

  closeResultPopup(): void {
    this.resultPopupOpen.set(false);
    this.resetReadingHighlight();
  }

  /** Độ dài phần đã đọc trong một mục (slice cho template). */
  segmentReadEnd(segmentKey: string, content: string): number {
    if (!content) return 0;
    const plain = this.ttsActivePlain;
    if (!plain) return 0;
    const lr = this.latestResult();
    if (!lr || lr.text.trim() !== plain) return 0;
    const start = this.ttsSegmentStarts.get(segmentKey);
    if (start === undefined || start < 0) return 0;
    const end = this.ttsHighlightCharEnd();
    return Math.min(content.length, Math.max(0, end - start));
  }

  private refreshTtsSegmentLayout(tts: string, r: HoroscopeResult): void {
    this.ttsSegmentStarts.clear();
    const hasStruct = !!(
      (r.hook && r.hook.trim()) ||
      (r.insight && r.insight.trim()) ||
      (r.warningOrOpportunity && r.warningOrOpportunity.trim()) ||
      (r.action && r.action.trim()) ||
      (r.luckyHint && r.luckyHint.trim()) ||
      (r.funnyLine && r.funnyLine.trim())
    );
    if (!hasStruct) {
      this.ttsSegmentStarts.set('__full', 0);
      return;
    }
    let pos = 0;
    const fields: [string, string][] = [
      ['hook', r.hook || ''],
      ['insight', r.insight || ''],
      ['warningOrOpportunity', r.warningOrOpportunity || ''],
      ['action', r.action || ''],
      ['luckyHint', r.luckyHint || ''],
      ['funnyLine', r.funnyLine || '']
    ];
    for (const [key, val] of fields) {
      const seg = val.trim();
      if (!seg) continue;
      let idx = tts.indexOf(seg, pos);
      if (idx === -1) idx = tts.indexOf(seg);
      if (idx !== -1) {
        this.ttsSegmentStarts.set(key, idx);
        pos = idx + seg.length;
      }
    }
  }

  private playAudioOrSpeak(audioUrl: string | null | undefined, text: string): void {
    const t = text?.trim() || '';
    if (!audioUrl && !t) {
      this.onHoroscopePlaybackFullyEnded();
      return;
    }
    if (audioUrl) {
      this.playCloudAudio(audioUrl, t);
      return;
    }
    this.speak(t);
  }

  private playCloudAudio(audioUrl: string, fallbackText: string): void {
    this.stopSpeech();
    try {
      const audio = new Audio(audioUrl);
      this.activeAudio = audio;
      audio.onplay = () => this.isSpeaking.set(true);
      audio.onended = () => {
        this.isSpeaking.set(false);
        this.activeAudio = null;
        this.onHoroscopePlaybackFullyEnded();
      };
      audio.onerror = () => {
        this.isSpeaking.set(false);
        this.activeAudio = null;
        // If cloud audio fails on browser side, fallback to local TTS.
        this.speak(fallbackText);
      };
      void audio.play();
    } catch {
      this.activeAudio = null;
      this.speak(fallbackText);
    }
  }


  handleAsk(payload: HoroscopePayload, opts?: { fromQueue?: boolean }): void {
    if (opts?.fromQueue) {
      this.lastPayload = payload;
      this.resultPopupUserName.set((payload.name || '').trim());
      this.resultPopupUserQuestion.set((payload.question || '').trim());
      this.appendMessage({ author: payload.name, text: payload.question, type: 'user' });
      this.astrologyService.requestHoroscope(payload);
      return;
    }
    this.lastPayload = payload;
    this.appendMessage({ author: payload.name, text: payload.question, type: 'user' });
    const item = this.buildQueueItemFromForm(payload);
    this.offerOracleQueue(item, { skipReasonableCheck: true });
  }

  handleAskMore(): void {
    if (!this.lastPayload) return;
    const followupPayload: HoroscopePayload = {
      ...this.lastPayload,
      question: `${this.lastPayload.question} (xem tiep van menh va loi khuyen hanh dong)`
    };

    this.appendMessage({
      author: 'System',
      text: 'Xem tiep van menh: ban dang mo khoa mot tang nang luong moi.',
      type: 'live'
    });
    this.lastPayload = followupPayload;
    const item = this.buildQueueItemFromForm(followupPayload);
    this.offerOracleQueue(item, { skipReasonableCheck: true });
  }

  private buildQueueItemFromForm(payload: HoroscopePayload): LiveQueueItem {
    const birthRaw = (payload.birthDate || '').trim();
    const birthDateInput = normalizeVietnameseBirthDate(birthRaw) || birthRaw;
    const parsed: StructuredLiveFields = {
      name: payload.name.trim(),
      birthDate: birthRaw,
      question: payload.question.trim(),
      birthDateInput: /^\d{4}-\d{2}-\d{2}$/.test(birthDateInput) ? birthDateInput : null
    };
    return {
      id: crypto.randomUUID(),
      username: 'You',
      comment: `Họ tên: ${parsed.name}\nNgày sinh: ${parsed.birthDate}\nCâu hỏi: ${parsed.question}`,
      parsed
    };
  }

  handleManualLiveMessage(message: string): void {
    const trimmed = message.trim();
    const parsed = parseStructuredLiveComment(trimmed);
    if (parsed && isReasonableOracleQuestion(parsed)) {
      const item: LiveQueueItem = { username: 'You', comment: trimmed, parsed };
      this.offerOracleQueue(item);
    }
    this.appendMessage({
      author: 'You',
      text: trimmed,
      type: 'live'
    });
  }

  ngOnDestroy(): void {
    this.stopSpeech();
    this.liveSocket.disconnect();
    this.stopFallbackComments();
    this.clearQueueDrainTimer();
    this.clearQueueAfterReadingPause();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.removeEventListener('voiceschanged', this.onVoicesChanged);
    }
  }

  private appendMessage(message: ChatMessage): void {
    this.chatMessages.update((prev) => [...prev.slice(-45), message]);
  }

  private initLiveCommentsFlow(): void {
    this.liveSocket.on('connect', async () => {
      try {
        const activeSessionId = await this.findActiveSessionId();
        if (activeSessionId) {
          this.liveSessionId = activeSessionId;
        } else {
          await this.startLiveSession();
        }
        this.liveConnected = true;
        this.stopFallbackComments();
        this.liveSocket.emit('live:join', { sessionId: this.liveSessionId });
        this.appendMessage({
          author: 'System',
          text: `Da ket noi comment loc (session: ${this.liveSessionId.slice(0, 8)}...). Chi hien thi dung cu phap "Họ tên:" / "Ngày sinh:" / "Câu hỏi:". Binh luan hop le duoc them vao hang cho, Oracle tra loi tuan tu.`,
          type: 'live'
        });
      } catch (error) {
        this.liveConnected = false;
        this.startFallbackComments();
        const errorText = error instanceof Error ? error.message : 'unknown';
        this.appendMessage({
          author: 'System',
          text: `Khong khoi tao duoc phien comment da loc (${errorText}). Dang chuyen sang comment mo phong.`,
          type: 'live'
        });
      }
    });

    this.liveSocket.on('connect_error', () => {
      if (this.liveConnected) return;
      this.startFallbackComments();
    });

    this.liveSocket.on('live:state', (state: LiveStatePayload) => {
      const queue = state?.mainQueue || [];
      const structuredItems: LiveQueueItem[] = [];
      for (const item of queue) {
        const parsed = parseStructuredLiveComment(item.comment?.trim() || '');
        if (!parsed) continue;
        structuredItems.push({ ...item, parsed });
      }
      for (const item of structuredItems) {
        const key = this.commentKey(item);
        if (!key || this.liveSeenCommentIds.has(key)) continue;
        this.liveSeenCommentIds.add(key);
        const parsed = item.parsed!;
        if (this.isCurrentlyDuplicateOracleQuestion(item, parsed)) {
          continue;
        }
        this.appendMessage({
          author: item.username || 'Viewer',
          text: item.comment || '',
          type: 'live'
        });
        this.offerOracleQueue(item);
      }

      // Keep memory bounded for long sessions.
      if (this.liveSeenCommentIds.size > 1000) {
        this.liveSeenCommentIds.clear();
      }
    });
  }

  private syncOracleQueueSize(): void {
    this.oracleQueueSize.set(this.oracleQueue.length);
    this.oracleQueueRows.set(this.buildOracleQueueRows());
  }

  private buildOracleQueueRows(): OracleQueueRow[] {
    return this.oracleQueue
      .filter((item): item is LiveQueueItem & { parsed: StructuredLiveFields } => Boolean(item.parsed))
      .map((item, index) => {
      const p = item.parsed;
      const q = p.question.trim();
      const preview = q.length > 88 ? `${q.slice(0, 88)}…` : q;
      return {
        trackId: this.queueDedupeKey(item),
        position: index + 1,
        fullName: p.name,
        viewer: item.username?.trim() || '—',
        birthDisplay: p.birthDateInput || p.birthDate,
        questionPreview: preview
      };
    });
  }


  private clearQueueDrainTimer(): void {
    if (!this.queueDrainTimer) return;
    clearTimeout(this.queueDrainTimer);
    this.queueDrainTimer = null;
  }

  private scheduleQueueDrain(delayMs: number): void {
    this.clearQueueDrainTimer();
    this.queueDrainTimer = window.setTimeout(() => {
      this.queueDrainTimer = null;
      this.tryDrainOracleQueue();
    }, delayMs);
  }

  private offerOracleQueue(item: LiveQueueItem, opts?: { skipReasonableCheck?: boolean }): void {
    if (!item.parsed) return;
    if (!opts?.skipReasonableCheck && !isReasonableOracleQuestion(item.parsed)) return;
    if (this.isCurrentlyDuplicateOracleQuestion(item, item.parsed)) return;
    const qKey = this.queueDedupeKey(item);
    if (!qKey || this.queuedOracleKeys.has(qKey)) return;
    this.queuedOracleKeys.add(qKey);
    this.oracleQueue.push(item);
    this.registerOracleQuestionFingerprints(item, item.parsed);
    this.syncOracleQueueSize();
    this.appendMessage({
      author: 'System',
      text: `📥 ${item.parsed.name} vao hang cho Oracle (vi tri #${this.oracleQueue.length}).`,
      type: 'live'
    });
    this.tryDrainOracleQueue();
  }

  private queueDedupeKey(item: LiveQueueItem): string {
    if (item.id) return `id:${item.id}`;
    return this.commentKey(item);
  }

  private pruneOracleQuestionDedupeMap(now: number): void {
    const maxAge = Math.max(this.dedupeViewerQuestionMs, this.dedupeGlobalQuestionMs) + 120_000;
    for (const [k, t] of this.oracleQuestionFirstSeen) {
      if (now - t > maxAge) {
        this.oracleQuestionFirstSeen.delete(k);
      }
    }
  }

  /** Đã có cùng câu hỏi (theo viewer hoặc flood gần đây) — không hiển thị / không xếp hàng. */
  private isCurrentlyDuplicateOracleQuestion(
    item: LiveQueueItem,
    parsed: StructuredLiveFields
  ): boolean {
    const normQ = normalizeQuestionForDedupe(parsed.question);
    if (normQ.length < 12) return false;
    const viewer = (item.username || '').trim().toLowerCase() || '_viewer';
    const now = Date.now();
    this.pruneOracleQuestionDedupeMap(now);
    const vKey = `v:${viewer}|${normQ}`;
    const gKey = `g:${normQ}`;
    const vAt = this.oracleQuestionFirstSeen.get(vKey);
    if (vAt !== undefined && now - vAt < this.dedupeViewerQuestionMs) return true;
    const gAt = this.oracleQuestionFirstSeen.get(gKey);
    if (gAt !== undefined && now - gAt < this.dedupeGlobalQuestionMs) return true;
    return false;
  }

  private registerOracleQuestionFingerprints(item: LiveQueueItem, parsed: StructuredLiveFields): void {
    const normQ = normalizeQuestionForDedupe(parsed.question);
    if (normQ.length < 12) return;
    const viewer = (item.username || '').trim().toLowerCase() || '_viewer';
    const now = Date.now();
    this.oracleQuestionFirstSeen.set(`v:${viewer}|${normQ}`, now);
    this.oracleQuestionFirstSeen.set(`g:${normQ}`, now);
  }

  private tryDrainOracleQueue(): void {
    if (this.astrologyService.loading()) return;
    if (this.expectQueueCompletion()) return;
    if (this.awaitingQueueReadingPlayback()) return;
    if (!this.oracleQueue.length) return;
    this.processOracleQueueHead();
  }

  private processOracleQueueHead(): void {
    if (this.astrologyService.loading()) return;
    const next = this.oracleQueue.shift();
    this.syncOracleQueueSize();
    if (!next?.parsed) return;

    const qKey = this.queueDedupeKey(next);
    this.queuedOracleKeys.delete(qKey);

    const waiting = this.oracleQueue.length;
    this.appendMessage({
      author: 'System',
      text:
        waiting > 0
          ? `🔔 Dang xem van menh cho ${next.parsed.name}. Con ${waiting} nguoi trong hang cho.`
          : `🔔 Dang xem van menh cho ${next.parsed.name}. Hang cho trong.`,
      type: 'live'
    });

    this.queueTurnNeedsPlaybackGate = true;
    this.expectQueueCompletion.set(true);
    this.triggerViewerReading(next, true);
  }

  private triggerViewerReading(item: LiveQueueItem, fromQueue: boolean): void {
    const parsed = item.parsed;
    if (!parsed) return;

    const birthDate =
      parsed.birthDateInput || this.lastPayload?.birthDate?.trim() || this.defaultBirthDate();

    this.autoFillName.set(parsed.name);
    this.autoFillBirthDate.set(parsed.birthDateInput || '');
    this.autoFillQuestion.set(parsed.question);

    const payload: HoroscopePayload = {
      name: parsed.name,
      birthDate,
      birthTime: this.lastPayload?.birthTime || '',
      question: parsed.question
    };
    this.handleAsk(payload, { fromQueue });
  }

  private defaultBirthDate(): string {
    return '2000-01-01';
  }

  private async startLiveSession(): Promise<void> {
    const payload = {
      sessionId: this.liveSessionId,
      username: 'astro-room',
      filters: {
        language: 'vi',
        removeSpam: true
      }
    };

    const response = await fetch(`${this.liveApiUrl}/api/live/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.json();
        detail = data?.error || '';
      } catch {
        detail = '';
      }
      throw new Error(detail || `Live session start failed (${response.status})`);
    }
  }

  private async findActiveSessionId(): Promise<string | null> {
    try {
      const response = await fetch(`${this.liveApiUrl}/api/live/sessions`);
      if (!response.ok) return null;
      const data = await response.json();
      const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
      const firstActive = sessions.find((s: { sessionId?: string }) => typeof s?.sessionId === 'string');
      return firstActive?.sessionId || null;
    } catch {
      return null;
    }
  }

  private commentKey(item: LiveQueueItem): string {
    if (item.id) return item.id;
    const username = item.username || 'viewer';
    const comment = item.comment || '';
    const timestamp = item.timestamp || '';
    return `${username}-${timestamp}-${comment}`;
  }

  private startFallbackComments(): void {
    if (this.liveFallbackTimer) return;
    this.liveFallbackTimer = setInterval(() => {
      const randomLine = this.fakeComments[Math.floor(Math.random() * this.fakeComments.length)];
      const parsed = parseStructuredLiveComment(randomLine);
      if (parsed) {
        const item: LiveQueueItem = { username: 'Viewer', comment: randomLine, parsed };
        this.offerOracleQueue(item);
      }
      this.appendMessage({ author: 'Viewer', text: randomLine, type: 'live' });
    }, 6000);
  }

  private stopFallbackComments(): void {
    if (!this.liveFallbackTimer) return;
    clearInterval(this.liveFallbackTimer);
    this.liveFallbackTimer = null;
  }

  private speak(text: string, opts?: { skipPopupClose?: boolean }): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const trimmed = text?.trim() || '';
    if (!trimmed) {
      if (!opts?.skipPopupClose) {
        this.onHoroscopePlaybackFullyEnded();
      }
      return;
    }
    this.stopSpeech();

    this.ttsActivePlain = trimmed;
    const lr = this.latestResult();
    if (lr && lr.text.trim() === trimmed) {
      this.refreshTtsSegmentLayout(trimmed, lr);
    } else {
      this.ttsSegmentStarts.clear();
      this.ttsSegmentStarts.set('__full', 0);
    }

    const chunks = this.buildToneMappedChunks(trimmed, lr);
    let chunkIndex = 0;

    const speakNextChunk = (): void => {
      const plan = chunks[chunkIndex];
      if (!plan) {
        this.ngZone.run(() => {
          this.isSpeaking.set(false);
          this.ttsHighlightCharEnd.set(trimmed.length);
          this.syncReadingViewportToTts();
          if (!opts?.skipPopupClose) {
            this.onHoroscopePlaybackFullyEnded();
          }
        });
        return;
      }

      const message = new SpeechSynthesisUtterance(plan.text);
      message.lang = 'vi-VN';
      message.voice = this.getSelectedVoice();
      message.rate = plan.rate;
      message.pitch = plan.pitch;
      message.volume = 1;

      message.onstart = () => {
        this.ngZone.run(() => {
          this.isSpeaking.set(true);
          if (chunkIndex === 0) {
            this.ttsHighlightCharEnd.set(0);
          }
          this.syncReadingViewportToTts();
        });
      };
      message.onboundary = (ev: SpeechSynthesisEvent) => {
        this.ngZone.run(() => {
          const localEnd =
            ev.charLength > 0 ? ev.charIndex + ev.charLength : Math.min(plan.text.length, ev.charIndex + 1);
          const absoluteEnd = Math.min(trimmed.length, plan.absStart + localEnd);
          this.ttsHighlightCharEnd.update((v) => Math.max(v, absoluteEnd));
          this.syncReadingViewportToTts();
        });
      };
      message.onend = () => {
        this.ngZone.run(() => {
          this.ttsHighlightCharEnd.update((v) => Math.max(v, Math.min(trimmed.length, plan.absStart + plan.text.length)));
          this.syncReadingViewportToTts();
        });
        chunkIndex += 1;
        speakNextChunk();
      };
      message.onerror = () => {
        this.ngZone.run(() => {
          this.isSpeaking.set(false);
          if (!opts?.skipPopupClose) {
            this.onHoroscopePlaybackFullyEnded();
          }
        });
      };

      this.utterance = message;
      window.speechSynthesis.speak(message);
    };

    speakNextChunk();
  }

  private buildToneMappedChunks(text: string, result: HoroscopeResult | null): TtsChunkPlan[] {
    const base = this.getPresetTuning();
    const clampRate = (v: number) => Math.min(1.3, Math.max(0.7, v));
    const clampPitch = (v: number) => Math.min(1.5, Math.max(0.7, v));

    if (!result || result.text.trim() !== text) {
      return [{ text, rate: base.rate, pitch: base.pitch, absStart: 0 }];
    }

    const pieces: Array<{ value: string; rateDelta: number; pitchDelta: number }> = [];
    const pushPiece = (value: string | undefined, rateDelta: number, pitchDelta: number) => {
      const v = (value || '').trim();
      if (!v) return;
      pieces.push({ value: v, rateDelta, pitchDelta });
    };

    pushPiece(result.hook, 0.01, 0.08);
    pushPiece(result.insight, -0.02, -0.02);
    pushPiece(result.warningOrOpportunity, -0.08, -0.13);
    pushPiece(result.action, 0, 0.03);
    pushPiece(result.luckyHint, 0.06, 0.14);
    pushPiece(result.funnyLine, 0.08, 0.18);

    if (!pieces.length) {
      return [{ text, rate: base.rate, pitch: base.pitch, absStart: 0 }];
    }

    const plans: TtsChunkPlan[] = [];
    let cursor = 0;
    for (const piece of pieces) {
      let start = text.indexOf(piece.value, cursor);
      if (start === -1) start = text.indexOf(piece.value);
      if (start === -1) continue;
      plans.push({
        text: piece.value,
        absStart: start,
        rate: clampRate(base.rate + piece.rateDelta),
        pitch: clampPitch(base.pitch + piece.pitchDelta)
      });
      cursor = start + piece.value.length;
    }

    if (!plans.length) {
      return [{ text, rate: base.rate, pitch: base.pitch, absStart: 0 }];
    }

    return plans;
  }

  testSelectedVoice(): void {
    const previewText =
      'Chao ban, day la giong AI avatar dang doc thu. Neu ban nghe ro va hop tai, hay giu giong nay.';
    this.speak(previewText, { skipPopupClose: true });
  }

  replayLatest(): void {
    const latest = this.latestResult();
    if (!latest?.text) return;
    this.playAudioOrSpeak(latest.audioUrl, latest.text);
  }

  setVoicePreset(preset: VoicePreset): void {
    this.selectedVoicePreset.set(preset);
  }

  private initSpeechVoices(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.refreshVoiceOptions();
    window.speechSynthesis.addEventListener('voiceschanged', this.onVoicesChanged);
  }

  setSelectedVoice(voiceId: string): void {
    this.selectedVoiceId.set(voiceId || 'auto');
    const selected = this.getSelectedVoice();
    this.selectedVoiceName.set(selected?.name || 'Default');
  }

  private refreshVoiceOptions(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices();
    const normalized = voices.map((voice) => ({
      id: voice.voiceURI || `${voice.name}-${voice.lang}`,
      name: voice.name,
      lang: voice.lang || ''
    }));
    this.availableVoices.set(normalized);

    this.vietnameseVoice = this.pickVietnameseVoice();

    // Keep existing manual selection if still available.
    if (this.selectedVoiceId() !== 'auto') {
      const exists = normalized.some((v) => v.id === this.selectedVoiceId());
      if (!exists) {
        this.selectedVoiceId.set('auto');
      }
    }

    const selected = this.getSelectedVoice();
    this.selectedVoiceName.set(selected?.name || 'Default');
  }

  private getSelectedVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const manualId = this.selectedVoiceId();
    if (manualId && manualId !== 'auto') {
      const manualVoice = voices.find((v) => (v.voiceURI || `${v.name}-${v.lang}`) === manualId);
      if (manualVoice) return manualVoice;
    }
    return this.vietnameseVoice || this.pickVietnameseVoice();
  }

  private getPresetTuning(): { rate: number; pitch: number } {
    const preset = this.selectedVoicePreset();
    switch (preset) {
      case 'male_deep':
        return { rate: 0.92, pitch: 0.9 };
      case 'energetic':
        return { rate: 1.05, pitch: 1.18 };
      case 'female_clear':
      default:
        return { rate: 0.95, pitch: 1.12 };
    }
  }

  private pickVietnameseVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const viVoices = voices.filter((v) => {
      const lang = v.lang?.toLowerCase() || '';
      return lang === 'vi-vn' || lang.startsWith('vi') || /vietnam|viet|việt/i.test(v.name);
    });
    if (!viVoices.length) return null;

    // Prefer female-like voices to avoid unclear male timbre.
    const femaleLike = viVoices.find((v) => /female|nu|nữ|girl|woman/i.test(v.name));
    if (femaleLike) return femaleLike;

    const neuralLike = viVoices.find((v) => /neural|natural|enhanced/i.test(v.name));
    if (neuralLike) return neuralLike;

    const exactVi = viVoices.find((v) => (v.lang?.toLowerCase() || '') === 'vi-vn');
    return exactVi || viVoices[0];
  }

  private stopSpeech(): void {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking.set(false);
    this.utterance = null;
    this.resetReadingHighlight();
  }
}
