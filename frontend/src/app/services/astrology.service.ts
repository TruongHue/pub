import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export type Mood = 'mysterious' | 'warning' | 'positive';

export interface HoroscopePayload {
  name: string;
  birthDate: string;
  birthTime?: string;
  question: string;
}

export interface HoroscopeResult {
  text: string;
  audioUrl?: string | null;
  mood: Mood;
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
    this.socket = io('http://localhost:3000', { transports: ['websocket'] });
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
      this.errorMessage.set('Khong ket noi duoc backend. Hay kiem tra server.');
      this.loading.set(false);
    });
  }
}
