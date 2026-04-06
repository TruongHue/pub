import { Component, NgZone, OnDestroy, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
import { backendBaseUrl } from './utils/backend-base-url';

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
  private readonly liveApiUrl = backendBaseUrl(3001);
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
  private readonly sanitizer = inject(DomSanitizer);
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
      text: 'Livestream đã bật. Vũ trụ đang lắng nghe câu hỏi của bạn…',
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
  private prefillTypingToken = 0;
  private readonly prefillCharDelayMs = 16;
  private readonly commentScanStepMs = 260;
  /** Vị trí ký tự (exclusive) đã đọc tới trong TTS; đồng bộ boundary event. */
  readonly ttsHighlightCharEnd = signal(0);
  readonly availableVoices = signal<VoiceOption[]>([]);
  readonly selectedVoiceId = signal<string>('auto');
  readonly selectedVoiceName = signal('Default');
  readonly selectedVoicePreset = signal<VoicePreset>('female_clear');
  readonly bgmInput = signal('');
  readonly bgmError = signal('');
  readonly bgmVolume = signal(28);
  readonly bgmEmbedUrl = signal<SafeResourceUrl | null>(null);
  readonly operatorActive = signal(false);
  readonly operatorStage = signal('');
  readonly operatorField = signal<'' | 'name' | 'birthDate' | 'question'>('');
  readonly operatorPulse = signal(false);
  /** Vị trí khung hướng dẫn cú pháp (kéo thả); null = dùng góc mặc định trong CSS. */
  readonly syntaxGuideLeft = signal<number | null>(null);
  readonly syntaxGuideTop = signal<number | null>(null);
  private readonly syntaxGuideLayoutKey = 'syntaxGuide.float.v1';
  private readonly onVoicesChanged = () => {
    this.refreshVoiceOptions();
  };
  private readonly fakeComments = [
    'Họ tên: Minh An\nNgày sinh: 15/08/1999\nCâu hỏi: Tuần này tình cảm của mình thế nào?',
    'Họ tên: Gia Bảo\nNgày sinh: 2001-03-22\nCâu hỏi: Có nên đổi người yêu này không?',
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
        // Chỉ cần TTS/audio nói, không hiển thị popup nội dung (vì đã có khung live).
        this.resultPopupOpen.set(false);
        this.scrollReadingToTop();
        // Kết quả chỉ hiển thị trong popup giữa màn hình — không đẩy vào luồng chat như comment.
        this.playAudioOrSpeak(result.audioUrl, result.ttsText || result.text);
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
    this.loadSyntaxGuideLayout();
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
      (r.verdict && r.verdict.trim()) ||
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
      ['verdict', r.verdict || ''],
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
      let started = false;
      const fallbackTimer = window.setTimeout(() => {
        if (started) return;
        this.activeAudio = null;
        this.isSpeaking.set(false);
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // noop
        }
        this.speak(fallbackText);
      }, 1500);

      audio.onplay = () => {
        started = true;
        clearTimeout(fallbackTimer);
        this.isSpeaking.set(true);
      };
      audio.onended = () => {
        clearTimeout(fallbackTimer);
        this.isSpeaking.set(false);
        this.activeAudio = null;
        this.onHoroscopePlaybackFullyEnded();
      };
      audio.onerror = () => {
        clearTimeout(fallbackTimer);
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
      question: `${this.lastPayload.question} (xem tiếp vận mệnh và lời khuyên hành động)`
    };

    this.appendMessage({
      author: 'System',
      text: 'Xem tiếp vận mệnh: bạn đang mở khóa một tầng năng lượng mới.',
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
    this.prefillTypingToken += 1;
    this.clearOperatorPlayback();
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
    // Show hết comment (không cắt bớt lịch sử).
    this.chatMessages.update((prev) => [...prev, message]);
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
          text: `Đã kết nối live feed (session: ${this.liveSessionId.slice(0, 8)}…). Hiển thị toàn bộ comment. Chỉ những câu hợp lệ mới vào hàng chờ Oracle.`,
          type: 'live'
        });
      } catch (error) {
        this.liveConnected = false;
        this.startFallbackComments();
        const errorText = error instanceof Error ? error.message : 'unknown';
        this.appendMessage({
          author: 'System',
          text: `Không khởi tạo được phiên comment đã lọc (${errorText}). Đang chuyển sang comment mô phỏng.`,
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
      for (const rawItem of queue) {
        const parsed = parseStructuredLiveComment(rawItem.comment?.trim() || '');
        const item: LiveQueueItem = { ...rawItem, parsed: parsed || undefined };
        const key = this.commentKey(item);
        if (!key || this.liveSeenCommentIds.has(key)) continue;
        this.liveSeenCommentIds.add(key);

        // Luôn hiển thị full comment trong chat.
        this.appendMessage({
          author: rawItem.username || 'Viewer',
          text: rawItem.comment || '',
          type: 'live'
        });

        // Chỉ câu hợp lệ mới vào hàng chờ Oracle.
        if (item.parsed) {
          this.offerOracleQueue(item);
        }
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
          ? `🔔 Đang xem vận mệnh cho ${next.parsed.name}. Còn ${waiting} người trong hàng chờ.`
          : `🔔 Đang xem vận mệnh cho ${next.parsed.name}. Hàng chờ trống.`,
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

    const payload: HoroscopePayload = {
      name: parsed.name,
      birthDate,
      birthTime: this.lastPayload?.birthTime || '',
      question: parsed.question
    };
    if (fromQueue) {
      void this.animateQueuePrefillThenAsk(payload);
      return;
    }
    this.autoFillName.set(parsed.name);
    this.autoFillBirthDate.set(parsed.birthDateInput || '');
    this.autoFillQuestion.set(parsed.question);
    this.handleAsk(payload, { fromQueue: false });
  }

  private async animateQueuePrefillThenAsk(payload: HoroscopePayload): Promise<void> {
    this.clearOperatorPlayback();
    this.prefillTypingToken += 1;
    const token = this.prefillTypingToken;
    this.operatorActive.set(true);
    this.operatorStage.set('Đang rà bình luận…');
    this.autoFillName.set('');
    this.autoFillBirthDate.set('');
    this.autoFillQuestion.set('');

    await this.simulateCommentReview(token);
    if (token !== this.prefillTypingToken) return;

    this.operatorStage.set('Đang mở biểu mẫu…');
    this.scrollToInputForm();
    await this.sleep(320);
    if (token !== this.prefillTypingToken) return;

    this.operatorField.set('name');
    this.operatorStage.set('Đang nhập họ tên…');
    await this.typeSignal(this.autoFillName, payload.name || '', token, this.prefillCharDelayMs, true);
    await this.sleep(120);
    if (token !== this.prefillTypingToken) return;

    this.operatorField.set('birthDate');
    this.operatorStage.set('Đang nhập ngày sinh…');
    await this.typeSignal(this.autoFillBirthDate, payload.birthDate || '', token, 22, false);
    await this.sleep(110);
    if (token !== this.prefillTypingToken) return;

    this.operatorField.set('question');
    this.operatorStage.set('Đang nhập câu hỏi…');
    await this.typeSignal(this.autoFillQuestion, payload.question || '', token, this.prefillCharDelayMs, true);
    await this.sleep(180);
    if (token !== this.prefillTypingToken) return;

    this.operatorField.set('');
    this.operatorStage.set('Đang gửi yêu cầu xem…');
    await this.sleep(220);
    if (token !== this.prefillTypingToken) return;
    this.handleAsk(payload, { fromQueue: true });
    this.operatorStage.set('Đã gửi. Đang chờ Oracle phản hồi…');
    setTimeout(() => {
      if (token !== this.prefillTypingToken) return;
      this.clearOperatorPlayback();
    }, 1200);
  }

  private async typeSignal(
    target: { set: (value: string) => void },
    value: string,
    token: number,
    charDelayMs: number,
    humanize: boolean
  ): Promise<void> {
    const text = String(value || '');
    const typoIndex = humanize && text.length > 10 ? Math.floor(text.length * 0.55) : -1;
    const typoChar = 'x';
    let typoDone = false;

    for (let i = 1; i <= text.length; i += 1) {
      if (token !== this.prefillTypingToken) return;
      target.set(text.slice(0, i));
      this.blinkOperatorPulse(token);

      if (humanize && !typoDone && i === typoIndex) {
        target.set(text.slice(0, i) + typoChar);
        this.blinkOperatorPulse(token);
        await this.sleep(65);
        if (token !== this.prefillTypingToken) return;
        target.set(text.slice(0, i));
        typoDone = true;
      }

      // Nhịp gõ tự nhiên hơn: nghỉ nhẹ theo cụm và dấu câu.
      const ch = text[i - 1];
      const extraPause = /[,.!?]/.test(ch) ? 75 : i % 9 === 0 ? 45 : 0;
      await this.sleep(charDelayMs);
      if (extraPause > 0) {
        await this.sleep(extraPause);
      }
    }
  }

  private scrollToInputForm(): void {
    if (typeof document === 'undefined') return;
    const formWrap = document.getElementById('viewerInputPanel');
    if (!formWrap) return;
    formWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async simulateCommentReview(token: number): Promise<void> {
    if (typeof document === 'undefined') return;
    const chatBox = document.querySelector('.chat-scroll') as HTMLElement | null;
    const queueList = document.querySelector('.oracle-queue-list') as HTMLElement | null;

    // Lướt lên/lướt xuống vài nhịp để giả lập thao tác "đọc comment".
    await this.sweepScrollable(chatBox, token);
    if (token !== this.prefillTypingToken) return;
    await this.sweepScrollable(queueList, token);
    if (token !== this.prefillTypingToken) return;
    await this.sweepScrollable(chatBox, token, true);
  }

  private async sweepScrollable(
    el: HTMLElement | null,
    token: number,
    reverseFirst = false
  ): Promise<void> {
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max <= 10) return;
    const mid = Math.floor(max * 0.42);
    const hi = Math.floor(max * 0.85);
    const points = reverseFirst ? [mid, 0, hi, mid] : [hi, mid, 0, mid];

    for (const p of points) {
      if (token !== this.prefillTypingToken) return;
      el.scrollTo({ top: p, behavior: 'smooth' });
      await this.sleep(this.commentScanStepMs);
    }
  }

  private blinkOperatorPulse(token: number): void {
    this.operatorPulse.set(true);
    setTimeout(() => {
      if (token !== this.prefillTypingToken) return;
      this.operatorPulse.set(false);
    }, 80);
  }

  private clearOperatorPlayback(): void {
    this.operatorActive.set(false);
    this.operatorField.set('');
    this.operatorStage.set('');
    this.operatorPulse.set(false);
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

    pushPiece(result.verdict, -0.06, -0.08);
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
      'Chào bạn, đây là giọng AI avatar đang đọc thử. Nếu bạn nghe rõ và hợp tai, hãy giữ giọng này.';
    this.speak(previewText, { skipPopupClose: true });
  }

  replayLatest(): void {
    const latest = this.latestResult();
    if (!latest?.text) return;
    this.playAudioOrSpeak(latest.audioUrl, latest.ttsText || latest.text);
  }

  setVoicePreset(preset: VoicePreset): void {
    this.selectedVoicePreset.set(preset);
  }

  onSyntaxGuideDragStart(ev: PointerEvent): void {
    if (typeof window === 'undefined' || ev.button !== 0) return;
    ev.preventDefault();
    const handle = ev.currentTarget as HTMLElement;
    const panel = handle.closest('.syntax-guide-float') as HTMLElement | null;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    let left = this.syntaxGuideLeft();
    let top = this.syntaxGuideTop();
    if (left === null || top === null) {
      left = rect.left;
      top = rect.top;
      this.syntaxGuideLeft.set(left);
      this.syntaxGuideTop.set(top);
    }

    const startX = ev.clientX;
    const startY = ev.clientY;
    const startL = left;
    const startT = top;
    const w = rect.width;
    const h = rect.height;
    const margin = 8;

    handle.setPointerCapture(ev.pointerId);

    const onMove = (e: PointerEvent) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nl = Math.min(Math.max(margin, startL + (e.clientX - startX)), vw - w - margin);
      const nt = Math.min(Math.max(margin, startT + (e.clientY - startY)), vh - h - margin);
      this.syntaxGuideLeft.set(nl);
      this.syntaxGuideTop.set(nt);
    };

    const onUp = (e: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      this.persistSyntaxGuideLayout();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  private loadSyntaxGuideLayout(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(this.syntaxGuideLayoutKey);
      if (!raw) return;
      const p = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof p.left === 'number' && typeof p.top === 'number') {
        this.syntaxGuideLeft.set(p.left);
        this.syntaxGuideTop.set(p.top);
      }
    } catch {
      /* ignore */
    }
  }

  private persistSyntaxGuideLayout(): void {
    if (typeof window === 'undefined') return;
    const left = this.syntaxGuideLeft();
    const top = this.syntaxGuideTop();
    if (left === null || top === null) return;
    try {
      window.localStorage.setItem(this.syntaxGuideLayoutKey, JSON.stringify({ left, top }));
    } catch {
      /* ignore */
    }
  }

  setBgmInput(value: string): void {
    this.bgmInput.set(value || '');
  }

  setBgmVolume(value: number | string): void {
    const parsed = Number(value);
    const volume = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 28;
    this.bgmVolume.set(volume);
    this.pushYoutubeVolume();
  }

  applyBgmLink(): void {
    const raw = this.bgmInput().trim();
    const videoId = this.extractYoutubeVideoId(raw);
    if (!videoId) {
      this.bgmError.set('Link YouTube không hợp lệ. Dán link dạng watch, youtu.be, shorts, hoặc embed.');
      return;
    }

    this.bgmError.set('');
    const embed = `https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&controls=0&rel=0&modestbranding=1&enablejsapi=1&iv_load_policy=3`;
    this.bgmEmbedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(embed));
    // Wait one tick for iframe creation, then push desired volume.
    setTimeout(() => this.pushYoutubeVolume(), 650);
  }

  stopBgm(): void {
    this.bgmEmbedUrl.set(null);
  }

  onBgmPlayerLoad(): void {
    this.pushYoutubeVolume();
  }

  private pushYoutubeVolume(): void {
    if (typeof document === 'undefined') return;
    const frame = document.getElementById('bgmYoutubePlayer') as HTMLIFrameElement | null;
    if (!frame?.contentWindow) return;

    const volume = this.bgmVolume();
    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }),
      '*'
    );
    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: volume === 0 ? 'mute' : 'unMute', args: [] }),
      '*'
    );
  }

  private extractYoutubeVideoId(input: string): string | null {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    const plainId = /^[a-zA-Z0-9_-]{11}$/;
    if (plainId.test(trimmed)) return trimmed;

    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      if (host.includes('youtu.be')) {
        const id = url.pathname.replace(/^\/+/, '').split('/')[0];
        return plainId.test(id) ? id : null;
      }
      if (host.includes('youtube.com')) {
        const v = url.searchParams.get('v');
        if (v && plainId.test(v)) return v;
        const parts = url.pathname.split('/').filter(Boolean);
        const idx = parts.findIndex((x) => x === 'embed' || x === 'shorts' || x === 'live');
        if (idx >= 0 && parts[idx + 1] && plainId.test(parts[idx + 1])) return parts[idx + 1];
      }
    } catch {
      return null;
    }
    return null;
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
