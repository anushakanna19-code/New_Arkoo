import { auth } from './firebase';

export const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  ? (import.meta.env.VITE_API_URL || 'https://new-arkoo.onrender.com')
  : '';

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

export async function getAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
  } catch (err) {
    console.warn('[API] Could not attach auth token:', err);
  }

  return headers;
}

export async function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
  const url = getApiUrl(path);
  const authHeaders = await getAuthHeaders((options.headers as Record<string, string>) || {});
  
  return fetch(url, {
    ...options,
    headers: authHeaders,
  });
}
