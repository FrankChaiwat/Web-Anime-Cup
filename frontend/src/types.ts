export type QuizSummary = {
  id: number;
  title: string;
  description: string;
  category: string;
  coverImageUrl: string;
  created_at: string;
  play_count: number;
  option_count: number;
};

export type QuizOption = {
  id: number;
  name: string;
  imageUrl: string;
  position: number;
};

export type Quiz = {
  id: number;
  title: string;
  description: string;
  category: string;
  coverImageUrl: string;
  play_count: number;
  options: QuizOption[];
};

export type DraftOption = {
  id?: number;
  name: string;
  imageUrl: string;
};

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: "member" | "admin";
};

export type FavoriteOption = {
  id: string;
  name: string;
  imageUrl: string;
  playCount: number;
  lastPlayed: string;
};

export type RecentPlay = {
  quizId: number | null;
  quizTitle: string;
  winnerName: string | null;
  winnerImageUrl: string;
  playedAt: string;
};

export type OwnedQuiz = QuizSummary & {
  ownerUserId: number;
};

export type UserProfile = {
  user: AuthUser;
  favorites: FavoriteOption[];
  recentPlays: RecentPlay[];
  ownedQuizzes: OwnedQuiz[];
};

export type AdminUser = AuthUser & {
  createdAt: string;
};
