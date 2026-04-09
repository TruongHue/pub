import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink],
  template: `
    <main class="page-shell">
      <div class="cosmic-overlay"></div>
      <header class="topbar">
        <div class="brand">Celestial Resonance</div>
        <nav class="menu">
          <a class="active" href="#">Oracle</a>
          <a href="#">Birth Charts</a>
          <a href="#">Cosmos</a>
        </nav>
        <div class="top-icons">
          <span>🔔</span>
          <span>⚙️</span>
          <span class="avatar-dot">🧙</span>
        </div>
      </header>

      <section class="landing-shell">
        <div class="landing-card" role="region" aria-label="Chọn chế độ">
          <div class="landing-badge-row">
            <span class="landing-badge">Oracle Live</span>
            <span class="landing-badge landing-badge--subtle">An toàn chi phí</span>
          </div>
          <p class="landing-kicker">Chọn chế độ trước khi vào live</p>
          <h1 class="landing-title">AI Astrology Avatar</h1>
          <p class="landing-sub">
            Tránh tình trạng vào nhầm live rồi chạy dữ liệu giả/đọc TTS liên tục. Bạn chọn 1 trong 2 chế độ dưới đây.
          </p>

          <div class="landing-grid" role="list">
            <a
              class="mode-tile"
              role="listitem"
              [routerLink]="['/live']"
              [queryParams]="{ mode: 'fake' }"
            >
              <div class="mode-tile__icon" aria-hidden="true">🧪</div>
              <div class="mode-tile__body">
                <div class="mode-tile__top">
                  <h2 class="mode-tile__title">Demo comment giả</h2>
                  <span class="mode-tile__tag mode-tile__tag--safe">0 token</span>
                </div>
                <p class="mode-tile__desc">
                  Chỉ hiển thị comment mô phỏng để test UI/flow. Không gọi Oracle, không phát TTS thật.
                </p>
              </div>
            </a>

            <a
              class="mode-tile mode-tile--hot"
              role="listitem"
              [routerLink]="['/live']"
              [queryParams]="{ mode: 'real' }"
            >
              <div class="mode-tile__icon" aria-hidden="true">📡</div>
              <div class="mode-tile__body">
                <div class="mode-tile__top">
                  <h2 class="mode-tile__title">Live thật (socket)</h2>
                  <span class="mode-tile__tag mode-tile__tag--live">LIVE</span>
                </div>
                <p class="mode-tile__desc">
                  Kết nối socket + xử lý hàng chờ + gọi Oracle/TTS theo lượt. Dùng khi bạn đã sẵn sàng chạy thật.
                </p>
              </div>
            </a>
          </div>

          <p class="landing-note">
            Mẹo: Nếu TikTok hay ẩn bình luận, khuyến nghị thêm <code>@</code> ở đầu comment.
          </p>
        </div>
      </section>
    </main>
  `
})
export class LandingPageComponent {}

