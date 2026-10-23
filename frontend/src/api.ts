import type { AdminUser, AuthUser, DraftOption, Quiz, QuizSummary, UserProfile } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const TOKEN_KEY = "quizzy-session-token";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์");
  return data as T;
}

export const api = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  getMe: () => request<{ user: AuthUser; token: string }>("/auth/me"),
  getProfile: () => request<UserProfile>("/profile"),
  getAdminUsers: (search = "") =>
    request<{ users: AdminUser[] }>(`/admin/users?search=${encodeURIComponent(search)}`),
  getAdminUser: (id: number) =>
    request<{ user: AdminUser }>(`/admin/users/${id}`),
  updateAdminUser: (id: number, payload: {
    email: string;
    displayName: string;
    role: AuthUser["role"];
    password?: string;
  }) => request<{ user: AdminUser; token?: string }>(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  deleteAdminUser: (id: number) =>
    request<{ message: string }>(`/admin/users/${id}`, { method: "DELETE" }),
  register: (payload: { displayName: string; email: string; password: string }) =>
    request<{ user: AuthUser; token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<{ user: AuthUser; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  uploadImage: async (file: File, quizTitle: string) => {
    const formData = new FormData();
    formData.append("quizTitle", quizTitle);
    formData.append("image", file);
    const result = await request<{ imageUrl: string }>("/uploads", {
      method: "POST",
      body: formData,
    });
    return { imageUrl: new URL(result.imageUrl, API_URL).toString() };
  },
  getHomepageSettings: () =>
    request<{ heroImageUrl: string; heroBackgroundUrl: string }>("/site-settings/homepage"),
  updateHomepageSettings: (settings: { heroImageUrl?: string; heroBackgroundUrl?: string }) =>
    request<{ heroImageUrl?: string; heroBackgroundUrl?: string; message: string }>("/site-settings/homepage", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getQuizzes: (search = "") =>
    request<QuizSummary[]>(`/quizzes?search=${encodeURIComponent(search)}`),
  getQuiz: (id: number) => request<Quiz>(`/quizzes/${id}`),
  createQuiz: (payload: {
    title: string;
    description: string;
    category: string;
    coverImageUrl: string;
    options: DraftOption[];
  }) => request<{ id: number; message: string }>("/quizzes", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  updateQuiz: (id: number, payload: {
    title: string;
    description: string;
    category: string;
    coverImageUrl: string;
    options: DraftOption[];
  }) => request<{ id: number; message: string }>(`/quizzes/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }),
  savePlay: (id: number, winnerOptionId: number) =>
    request<{ message: string }>(`/quizzes/${id}/plays`, {
      method: "POST",
      body: JSON.stringify({ winnerOptionId }),
    }),
  deleteQuiz: (id: number) =>
    request<{ message: string }>(`/quizzes/${id}`, { method: "DELETE" }),
};
