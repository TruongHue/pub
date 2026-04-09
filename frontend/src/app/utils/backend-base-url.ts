/**
 * Trỏ về backend trên cùng host với trang (localhost hoặc IP LAN khi mở http://192.168.x.x:4200).
 */
export function backendBaseUrl(port: number): string {
  // BE chính: ép gọi Render để tránh xung đột local port (xem cấu hình ở `config/backend-target.ts`)
  void port;
  return `https://akool.onrender.com`;
}
