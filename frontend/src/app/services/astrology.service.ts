import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { MAIN_BACKEND_BASE } from '../config/backend-target';

export type Mood = 'mysterious' | 'warning' | 'positive';

export interface HoroscopePayload {
  name: string;
  birthDate: string;
  birthTime?: string;
  question: string;
}

export interface HoroscopeResult {
  text: string;
  /** Bản đọc TTS (có thể gồm phần nhắc lại người hỏi + câu hỏi). */
  ttsText?: string;
  audioUrl?: string | null;
  mood: Mood;
  /** Câu chốt hạ đầu tiên (Nên / Không nên / Có / Không …). */
  verdict?: string;
  hook: string;
  insight: string;
  warningOrOpportunity: string;
  action: string;
  luckyHint: string;
  funnyLine: string;
}

@Injectable({ providedIn: 'root' })
export class AstrologyService {
  private readonly socket: Socket;
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly latestResult = signal<HoroscopeResult | null>(null);

  constructor() {
    // BE chính: gọi Render thẳng (tránh xung đột local port)
    this.socket = io(MAIN_BACKEND_BASE, { transports: ['websocket'] });
    this.registerSocketEvents();
  }

  requestHoroscope(payload: HoroscopePayload): void {
    this.errorMessage.set(null);
    this.loading.set(true);
    this.socket.emit('ask-horoscope', payload);
  }

  private registerSocketEvents(): void {
    this.socket.on('ai-status', () => {
      this.loading.set(true);
      this.errorMessage.set(null);
    });

    this.socket.on('ai-response', (result: HoroscopeResult) => {
      this.latestResult.set(result);
      this.loading.set(false);
    });

    this.socket.on('ai-error', (error: { message?: string }) => {
      this.errorMessage.set(error?.message || 'Server error.');
      this.loading.set(false);
    });

    this.socket.on('connect_error', () => {
      this.errorMessage.set('Không kết nối được backend. Hãy kiểm tra server.');
      this.loading.set(false);
    });
  }
}
