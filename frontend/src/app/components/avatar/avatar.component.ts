import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';

@Component({
  selector: 'app-avatar',
  imports: [CommonModule],
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.css'
})
export class AvatarComponent implements AfterViewInit, OnChanges {
  @Input() text = '';
  @Input() mood: 'mysterious' | 'warning' | 'positive' = 'mysterious';
  @Input() speaking = false;
  @Input() loading = false;

  floatLeft = 24;
  floatTop = 96;
  floatWidth = 355;
  floatHeight = 435;

  private readonly minFloatWidth = 220;
  private readonly minFloatHeight = 260;
  private readonly dragMargin = 8;
  private readonly floatTopMin = 72;
  private readonly floatStorageKey = 'avatar.waitingFloat.v1';

  private get aspectRatio(): number {
    return this.floatWidth / Math.max(1, this.floatHeight);
  }

  @ViewChild('waitingVideo', { static: false })
  waitingVideoEl?: ElementRef<HTMLVideoElement>;

  /** File gốc đặt trong thư mục `frontend/video/` (cùng cấp `src/`); build copy sang `/assets/video/`. */
  private static readonly waitingVideoFile = 'grok-video-c438d8ff-413a-4eb3-a6f9-67cee7a5b1e4 (1).mp4';

  waitingVideoSrc = `/assets/video/${encodeURIComponent(AvatarComponent.waitingVideoFile)}`;

  private waitingPlaybackRate = 0.85;
  private lastShouldPlay: boolean | null = null;

  ngAfterViewInit() {
    this.loadFloatLayout();
    this.repositionInitialIfNeeded();
    this.syncWaitingVideo();
  }

  ngOnChanges(_changes: SimpleChanges) {
    this.syncWaitingVideo();
  }

  private repositionInitialIfNeeded() {
    if (typeof window === 'undefined') return;

    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;

    const maxW = Math.floor(vw * (vw < 480 ? 0.78 : 0.42));
    const maxH = Math.floor(vh * (vw < 480 ? 0.62 : 0.62));

    if (this.floatWidth > maxW || this.floatHeight > maxH) {
      const ratio = this.aspectRatio;
      const clampedW = Math.max(this.minFloatWidth, Math.min(this.floatWidth, maxW));
      const clampedH = Math.max(this.minFloatHeight, Math.min(this.floatHeight, maxH));

      const byW = { w: clampedW, h: Math.floor(clampedW / ratio) };
      const byH = { h: clampedH, w: Math.floor(clampedH * ratio) };

      const fitsByW = byW.w <= maxW && byW.h <= maxH;
      const fitsByH = byH.w <= maxW && byH.h <= maxH;

      if (fitsByW) {
        this.floatWidth = byW.w;
        this.floatHeight = byW.h;
      } else if (fitsByH) {
        this.floatWidth = byH.w;
        this.floatHeight = byH.h;
      } else {
        this.floatWidth = Math.max(this.minFloatWidth, maxW);
        this.floatHeight = Math.max(this.minFloatHeight, Math.floor(this.floatWidth / ratio));
      }
    }

    const maxLeft = Math.max(0, vw - this.floatWidth - this.dragMargin);
    const maxTop = Math.max(0, vh - this.floatHeight - this.dragMargin);

    this.floatLeft = Math.min(Math.max(16, this.floatLeft), maxLeft);
    const topMin = vw < 480 ? 56 : this.floatTopMin;
    this.floatTop = Math.min(Math.max(topMin, this.floatTop), maxTop);
  }

  private loadFloatLayout() {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(this.floatStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        left: number;
        top: number;
        width: number;
        height: number;
      }>;
      if (typeof parsed.left === 'number') this.floatLeft = parsed.left;
      if (typeof parsed.top === 'number') this.floatTop = parsed.top;
      if (typeof parsed.width === 'number') this.floatWidth = parsed.width;
      if (typeof parsed.height === 'number') this.floatHeight = parsed.height;
    } catch {
      // ignore
    }
  }

  private persistFloatLayout() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        this.floatStorageKey,
        JSON.stringify({
          left: this.floatLeft,
          top: this.floatTop,
          width: this.floatWidth,
          height: this.floatHeight
        })
      );
    } catch {
      // ignore
    }
  }

  private syncWaitingVideo() {
    const el = this.waitingVideoEl?.nativeElement;
    if (!el) return;

    const shouldPlay = true;
    if (this.lastShouldPlay !== shouldPlay) {
      this.lastShouldPlay = shouldPlay;
    }

    if (shouldPlay) {
      el.loop = true;
      el.muted = true;
      el.playbackRate = this.waitingPlaybackRate;
      if (el.paused) {
        el.play().catch(() => {});
      }
    } else {
      el.pause();
    }
  }

  onDragStart(ev: PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof window === 'undefined') return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const startLeft = this.floatLeft;
    const startTop = this.floatTop;

    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const maxLeft = Math.max(0, vw - this.floatWidth - this.dragMargin);
    const maxTop = Math.max(0, vh - this.floatHeight - this.dragMargin);

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.floatLeft = Math.min(Math.max(0, startLeft + dx), maxLeft);
      this.floatTop = Math.min(Math.max(0, startTop + dy), maxTop);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.persistFloatLayout();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  onResizeStart(ev: PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof window === 'undefined') return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const startW = this.floatWidth;
    const startH = this.floatHeight;
    const ratio = startW / startH;

    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;

    const maxWByViewport = Math.max(this.minFloatWidth, vw - this.floatLeft - this.dragMargin);
    const maxHByViewport = Math.max(this.minFloatHeight, vh - this.floatTop - this.dragMargin);

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;

      let newW = startW + dx;
      newW = Math.min(Math.max(this.minFloatWidth, newW), maxWByViewport);

      let newH = newW / ratio;
      newH = Math.min(Math.max(this.minFloatHeight, newH), maxHByViewport);

      newW = newH * ratio;
      newW = Math.min(Math.max(this.minFloatWidth, newW), maxWByViewport);

      this.floatWidth = Math.round(newW);
      this.floatHeight = Math.round(newH);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.persistFloatLayout();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
