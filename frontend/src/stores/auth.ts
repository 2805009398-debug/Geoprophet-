import { defineStore } from 'pinia';
import { api } from '../lib/api';
import type { LoginProviders, UserProfile } from '../types';

interface AuthState {
  token: string;
  user: UserProfile | null;
  providers: LoginProviders['providers'] | null;
  demoAccounts: LoginProviders['demoAccounts'];
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: window.localStorage.getItem('geoprophet-token') ?? '',
    user: null,
    providers: null,
    demoAccounts: []
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token)
  },
  actions: {
    async fetchProviders() {
      const { data } = await api.get<LoginProviders>('/auth/providers');
      this.providers = data.providers;
      this.demoAccounts = data.demoAccounts;
    },
    async login(payload: { username: string; password: string }) {
      const { data } = await api.post<{ token: string; user: UserProfile }>('/auth/login', payload);
      this.token = data.token;
      this.user = data.user;
      window.localStorage.setItem('geoprophet-token', data.token);
    },
    async fetchMe() {
      if (!this.token) {
        return;
      }

      const { data } = await api.get<{ user: UserProfile }>('/auth/me');
      this.user = data.user;
    },
    logout() {
      this.token = '';
      this.user = null;
      window.localStorage.removeItem('geoprophet-token');
    }
  }
});

