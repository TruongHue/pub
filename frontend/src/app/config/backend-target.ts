/**
 * 1 file cấu hình URL BE cho FE.
 *
 * Yêu cầu hiện tại:
 * - BE chính (xem vận mệnh) luôn gọi Render
 * - Live comments (list comment) dùng local và né xung đột cổng 3001 -> dùng 3002
 *
 * Khi cần chạy local full (cả BE chính + live comments), chỉ cần đổi/comment các dòng dưới.
 */

// ===== BE chính (socket ask-horoscope + /api/horoscope...) =====
export const MAIN_BACKEND_BASE = 'https://akool.onrender.com';
// export const MAIN_BACKEND_BASE = 'http://127.0.0.1:3000';

// ===== Live comments (socket live:join/live:state + /api/live/*) =====
export const LIVE_COMMENTS_BASE = 'http://127.0.0.1:3001';
// export const LIVE_COMMENTS_BASE = 'https://akool.onrender.com';

