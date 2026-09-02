// ─── Common Types ──────────────────────────────────────────

export interface CorsOptions {
  allowedOrigins: string[];
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
