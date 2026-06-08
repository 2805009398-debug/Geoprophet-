import axios, { type InternalAxiosRequestConfig } from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 8000
});

export const analysisApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000
});

function attachAuthToken(config: InternalAxiosRequestConfig) {
  const token = window.localStorage.getItem('geoprophet-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

api.interceptors.request.use(attachAuthToken);
analysisApi.interceptors.request.use(attachAuthToken);

export function toAbsoluteAssetUrl(url?: string | null) {
  if (!url) {
    return '';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return `${API_ORIGIN}${url}`;
}
