import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 8000
});

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem('geoprophet-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function toAbsoluteAssetUrl(url?: string | null) {
  if (!url) {
    return '';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return `${API_ORIGIN}${url}`;
}
