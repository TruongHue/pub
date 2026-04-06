/**
 * Trỏ về backend trên cùng host với trang (localhost hoặc IP LAN khi mở http://192.168.x.x:4200).
 */
export function backendBaseUrl(port: number): string {
  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${window.location.hostname}:${port}`;
}
