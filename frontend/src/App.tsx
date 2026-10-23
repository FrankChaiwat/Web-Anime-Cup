import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Flame, Gamepad2, Heart, LogIn, LogOut, Pencil, Plus, Search, Shield, Sparkles, Trash2, Trophy, Upload, UserPlus, UserRound, X } from "lucide-react";
import { api } from "./api";
import type { AdminUser, AuthUser, DraftOption, Quiz, QuizSummary, UserProfile } from "./types";

type View = "home" | "create" | "edit" | "play" | "auth" | "admin" | "users" | "user-edit" | "profile";
type SavedPage = {
  view: View;
  quizId?: number;
  editingQuizId?: number;
  editingUserId?: number;
  search?: string;
  userSearch?: string;
  returnView?: "profile" | "admin";
};
const PAGE_STORAGE_KEY = "quizzy-current-page";

function readSavedPage(): SavedPage {
  try {
    const saved = JSON.parse(localStorage.getItem(PAGE_STORAGE_KEY) || "null") as Partial<SavedPage> | null;
    const views: View[] = ["home", "create", "edit", "play", "auth", "admin", "users", "user-edit", "profile"];
    if (!saved || typeof saved.view !== "string" || !views.includes(saved.view as View)) return { view: "home" };
    return {
      view: saved.view as View,
      ...(Number.isInteger(saved.quizId) ? { quizId: saved.quizId } : {}),
      ...(Number.isInteger(saved.editingQuizId) ? { editingQuizId: saved.editingQuizId } : {}),
      ...(Number.isInteger(saved.editingUserId) ? { editingUserId: saved.editingUserId } : {}),
      ...(typeof saved.search === "string" ? { search: saved.search } : {}),
      ...(typeof saved.userSearch === "string" ? { userSearch: saved.userSearch } : {}),
      ...(saved.returnView === "profile" || saved.returnView === "admin" ? { returnView: saved.returnView } : {}),
    };
  } catch {
    return { view: "home" };
  }
}

const fallbackImage = (name: string) =>
  `https://placehold.co/600x600/ffe0ce/593f68?text=${encodeURIComponent(name || "Your image")}`;

export default function App() {
  const [savedPage] = useState(readSavedPage);
  const [view, setView] = useState<View>(savedPage.view);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [search, setSearch] = useState(savedPage.search ?? "");
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [quizReturnView, setQuizReturnView] = useState<"profile" | "admin">("admin");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [heroBackgroundUrl, setHeroBackgroundUrl] = useState("");
  const [heroSettingsError, setHeroSettingsError] = useState("");
  const [heroImageSaving, setHeroImageSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState("");
  const [userSearch, setUserSearch] = useState(savedPage.userSearch ?? "");
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [restoringPage, setRestoringPage] = useState(true);
  const restoreStarted = useRef(false);

  async function loadQuizzes(query = search) {
    setLoading(true);
    setError("");
    try {
      setQuizzes(await api.getQuizzes(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : "เชื่อมต่อ API ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void loadQuizzes(savedPage.view === "home" ? savedPage.search ?? "" : "");
    void api.getHomepageSettings()
      .then((settings) => {
        setHeroImageUrl(settings.heroImageUrl);
        setHeroBackgroundUrl(settings.heroBackgroundUrl);
      })
      .catch((err) => setHeroSettingsError(err instanceof Error ? err.message : "โหลดภาพหน้าแรกไม่สำเร็จ"));
    void restorePage();
  }, []);

  useEffect(() => {
    if (restoringPage) return;
    const page: SavedPage = { view };
    if (view === "play" && activeQuiz) page.quizId = activeQuiz.id;
    if (view === "edit" && editingQuiz) page.editingQuizId = editingQuiz.id;
    if ((view === "create" || view === "edit") && quizReturnView === "profile") page.returnView = "profile";
    if (view === "user-edit" && editingUser) page.editingUserId = editingUser.id;
    if (view === "home" && search) page.search = search;
    if ((view === "users" || view === "user-edit") && userSearch) page.userSearch = userSearch;
    localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(page));
  }, [view, activeQuiz, editingQuiz, editingUser, search, userSearch, restoringPage]);

  async function restorePage() {
    let currentUser: AuthUser | null = null;
    try {
      if (api.getToken()) {
        try {
          const session = await api.getMe();
          currentUser = session.user;
          api.setToken(session.token);
          setUser(currentUser);
        } catch {
          api.clearToken();
        }
      }

      if (["admin", "users", "user-edit"].includes(savedPage.view) && currentUser?.role !== "admin") {
        setView("home");
        return;
      }
      if (["create", "edit"].includes(savedPage.view) && !currentUser) {
        setView("home");
        return;
      }
      if (savedPage.view === "profile" && !currentUser) {
        setView("home");
        return;
      }
      if (savedPage.view === "play") {
        if (!savedPage.quizId) {
          setView("home");
          return;
        }
        setActiveQuiz(await api.getQuiz(savedPage.quizId));
      } else if (savedPage.view === "edit") {
        if (!savedPage.editingQuizId) {
          setView(currentUser?.role === "admin" ? "admin" : "profile");
          return;
        }
        if (currentUser?.role !== "admin") {
          const profileData = await api.getProfile();
          setProfile(profileData);
          if (!profileData.ownedQuizzes.some((quiz) => quiz.id === savedPage.editingQuizId)) {
            setView("profile");
            return;
          }
        }
        setEditingQuiz(await api.getQuiz(savedPage.editingQuizId));
        setQuizReturnView(savedPage.returnView === "profile" || currentUser?.role !== "admin" ? "profile" : "admin");
      } else if (savedPage.view === "create") {
        setEditingQuiz(null);
        setQuizReturnView(savedPage.returnView === "profile" || currentUser?.role !== "admin" ? "profile" : "admin");
      } else if (savedPage.view === "users") {
        await loadAdminUsers(savedPage.userSearch ?? "");
      } else if (savedPage.view === "user-edit") {
        if (!savedPage.editingUserId) {
          setView("users");
          await loadAdminUsers(savedPage.userSearch ?? "");
          return;
        }
        const target = (await api.getAdminUser(savedPage.editingUserId)).user;
        setEditingUser(target);
      } else if (savedPage.view === "profile") {
        setProfile(await api.getProfile());
      }
    } catch (err) {
      setView("home");
      if (savedPage.view === "profile") {
        setProfileError(err instanceof Error ? err.message : "โหลดโปรไฟล์ไม่สำเร็จ");
      }
    } finally {
      setRestoringPage(false);
    }
  }

  function openCreate(returnView: "profile" | "admin" = "admin") {
    setError("");
    if (returnView === "profile") setProfileError("");
    if (!user) {
      setAuthMode("login");
      setNotice("เข้าสู่ระบบเพื่อสร้างควิซของคุณ");
      setView("auth");
      return;
    }
    setEditingQuiz(null);
    setQuizReturnView(returnView);
    setView("create");
  }

  function openAdmin() {
    setError("");
    setView("admin");
  }

  async function loadAdminUsers(search = userSearch) {
    setAdminUsersLoading(true);
    setAdminUsersError("");
    try {
      setAdminUsers((await api.getAdminUsers(search)).users);
      setUserSearch(search);
    } catch (err) {
      setAdminUsersError(err instanceof Error ? err.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
    } finally {
      setAdminUsersLoading(false);
    }
  }

  function openUsers() {
    setEditingUser(null);
    setUserSearch("");
    setView("users");
    void loadAdminUsers("");
  }

  function openUserEdit(target: AdminUser) {
    setEditingUser(target);
    setView("user-edit");
  }

  async function saveUser(targetId: number, payload: {
    email: string;
    displayName: string;
    role: AuthUser["role"];
    password?: string;
  }) {
    setAdminUsersError("");
    try {
      const result = await api.updateAdminUser(targetId, payload);
      if (targetId === user?.id) {
        if (result.token) api.setToken(result.token);
        setUser(result.user);
      }
      setEditingUser(null);
      setView("users");
      await loadAdminUsers(userSearch);
      setNotice("บันทึกข้อมูลผู้ใช้สำเร็จ");
    } catch (err) {
      setAdminUsersError(err instanceof Error ? err.message : "บันทึกข้อมูลผู้ใช้ไม่สำเร็จ");
    }
  }

  async function deleteUser(targetId: number) {
    setAdminUsersError("");
    try {
      await api.deleteAdminUser(targetId);
      await loadAdminUsers(userSearch);
      setNotice("ลบผู้ใช้สำเร็จ");
    } catch (err) {
      setAdminUsersError(err instanceof Error ? err.message : "ลบผู้ใช้ไม่สำเร็จ");
    }
  }

  async function openEdit(id: number, returnView: "profile" | "admin" = "admin") {
    setError("");
    if (returnView === "profile") setProfileError("");
    try {
      if (user?.role !== "admin" && !profile?.ownedQuizzes.some((quiz) => quiz.id === id)) {
        if (returnView === "profile") setProfileError("คุณแก้ไขได้เฉพาะควิซของตัวเอง");
        else setError("คุณแก้ไขได้เฉพาะควิซของตัวเอง");
        return;
      }
      setEditingQuiz(await api.getQuiz(id));
      setQuizReturnView(returnView);
      setView("edit");
    } catch (err) {
      const message = err instanceof Error ? err.message : "โหลดควิซเพื่อแก้ไขไม่สำเร็จ";
      if (returnView === "profile") setProfileError(message);
      else setError(message);
    }
  }

  async function openProfile() {
    setView("profile");
    setProfileLoading(true);
    setProfileError("");
    try {
      setProfile(await api.getProfile());
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "โหลดโปรไฟล์ไม่สำเร็จ");
    } finally {
      setProfileLoading(false);
    }
  }

  function handleAuthenticated(authUser: AuthUser, token: string) {
    api.setToken(token);
    setUser(authUser);
    setNotice(`ยินดีต้อนรับ ${authUser.displayName}`);
    setError("");
    setView(authUser.role === "admin" ? "admin" : "home");
  }

  function logout() {
    api.clearToken();
    setUser(null);
    setView("home");
    setNotice("ออกจากระบบแล้ว");
    setError("");
  }

  async function openQuiz(id: number) {
    setError("");
    setNotice("");
    try {
      const quiz = await api.getQuiz(id);
      if (quiz.options.length < 2) {
        setError("ควิซนี้มีตัวเลือกไม่พอสำหรับเล่น");
        return;
      }
      setActiveQuiz(quiz);
      setView("play");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปิดควิซไม่สำเร็จ");
    }
  }

  async function saveQuiz(payload: {
    title: string; description: string; category: string; coverImageUrl: string; options: DraftOption[];
  }, quizId?: number) {
    setError("");
    try {
      if (quizId === undefined) {
        await api.createQuiz(payload);
      } else {
        await api.updateQuiz(quizId, payload);
      }
      await loadQuizzes("");
      setEditingQuiz(null);
      if (quizReturnView === "profile") {
        setProfile(await api.getProfile());
        setProfileError("");
      }
      setView(quizReturnView);
      setNotice(quizId === undefined ? "สร้างควิซสำเร็จ" : "บันทึกการแก้ไขควิซสำเร็จ");
    } catch (err) {
      const message = err instanceof Error ? err.message : "สร้างควิซไม่สำเร็จ";
      if (quizReturnView === "profile") setProfileError(message);
      else setError(message);
    }
  }

  async function deleteQuiz(id: number, returnView: "profile" | "admin" = "admin") {
    setError("");
    try {
      await api.deleteQuiz(id);
      await loadQuizzes("");
      if (returnView === "profile") {
        setProfile(await api.getProfile());
        setProfileError("");
      }
      setNotice("ลบควิซสำเร็จ");
    } catch (err) {
      const message = err instanceof Error ? err.message : "ลบควิซไม่สำเร็จ";
      if (returnView === "profile") setProfileError(message);
      else setError(message);
    }
  }

  async function saveHeroImage(file: File, kind: "card" | "background") {
    if (file.size > 5 * 1024 * 1024) {
      setHeroSettingsError("ไฟล์ภาพต้องมีขนาดไม่เกิน 5 MB");
      return;
    }
    setHeroImageSaving(true);
    setHeroSettingsError("");
    try {
      const uploadTitle = kind === "card" ? "ภาพการ์ดหน้าแรก" : "ภาพพื้นหลังหน้าแรก";
      const uploaded = await api.uploadImage(file, uploadTitle);
      const settings = await api.updateHomepageSettings(
        kind === "card" ? { heroImageUrl: uploaded.imageUrl } : { heroBackgroundUrl: uploaded.imageUrl },
      );
      if (settings.heroImageUrl !== undefined) setHeroImageUrl(settings.heroImageUrl);
      if (settings.heroBackgroundUrl !== undefined) setHeroBackgroundUrl(settings.heroBackgroundUrl);
      setNotice(kind === "card" ? "เปลี่ยนภาพการ์ดหน้าแรกสำเร็จ" : "เปลี่ยนภาพพื้นหลังหน้าแรกสำเร็จ");
    } catch (err) {
      setHeroSettingsError(err instanceof Error ? err.message : "บันทึกภาพหน้าแรกไม่สำเร็จ");
    } finally {
      setHeroImageSaving(false);
    }
  }

  async function resetHeroImage(kind: "card" | "background") {
    setHeroImageSaving(true);
    setHeroSettingsError("");
    try {
      const settings = await api.updateHomepageSettings(
        kind === "card" ? { heroImageUrl: "" } : { heroBackgroundUrl: "" },
      );
      if (settings.heroImageUrl !== undefined) setHeroImageUrl(settings.heroImageUrl);
      if (settings.heroBackgroundUrl !== undefined) setHeroBackgroundUrl(settings.heroBackgroundUrl);
      setNotice(kind === "card" ? "คืนค่าภาพการ์ดเริ่มต้นแล้ว" : "คืนค่าพื้นหลังเริ่มต้นแล้ว");
    } catch (err) {
      setHeroSettingsError(err instanceof Error ? err.message : "คืนค่าภาพหน้าแรกไม่สำเร็จ");
    } finally {
      setHeroImageSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setView("home"); setNotice(""); }} aria-label="กลับหน้าแรก">
          <span className="brand-mark"><Sparkles size={22} /></span>
          <span>quizzy<span className="brand-dot">.</span></span>
        </button>
        <nav className="nav-links">
          <button className={view === "home" ? "nav-link active" : "nav-link"} onClick={() => { setView("home"); setError(""); }}>สำรวจควิซ</button>
          {user?.role === "admin" && <button className={view === "admin" || view === "create" || view === "edit" || view === "users" || view === "user-edit" ? "nav-link active" : "nav-link"} onClick={openAdmin}><Shield size={16} /> จัดการระบบ</button>}
        </nav>
        {user ? (
          <div className="account-actions">
            <button className="account-button profile-button" onClick={() => void openProfile()}><UserRound size={16} /><span>{user.displayName}</span></button>
            {user.role === "admin" && <button className="create-top" onClick={openAdmin}><Shield size={17} /> แอดมิน</button>}
            <button className="account-button" onClick={logout} aria-label="ออกจากระบบ"><LogOut size={17} /></button>
          </div>
        ) : (
          <div className="account-actions">
            <button className="account-button login-button" onClick={() => { setAuthMode("login"); setView("auth"); }}><LogIn size={16} /> เข้าสู่ระบบ</button>
            <button className="create-top" onClick={() => { setAuthMode("register"); setView("auth"); }}><UserPlus size={16} /> สมัครสมาชิก</button>
          </div>
        )}
      </header>

      <main>
        {view === "home" && (
          <>
            <section className="hero" style={heroBackgroundUrl ? {
              backgroundImage: `linear-gradient(90deg, rgba(73,43,128,.84) 0%, rgba(99,54,143,.68) 52%, rgba(196,75,120,.42) 100%), url("${heroBackgroundUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            } : undefined}>
              <div className="hero-copy">
                <div className="eyebrow"><Flame size={15} /> เกมสนุก ๆ เริ่มที่นี่</div>
                <h1>เลือกสิ่งที่ใช่<br /><span>ให้เป็นแชมป์!</span></h1>
                <p>ร่วมสนุกกับทัวร์นาเมนต์ เลือกตัวละครที่ชอบ แล้วค้นหาผู้ชนะในใจคุณ</p>
                <div className="hero-actions">
                  <button className="primary-btn" onClick={() => document.getElementById("quiz-list")?.scrollIntoView({ behavior: "smooth" })}>
                    <Gamepad2 size={18} /> เริ่มเล่นเลย
                  </button>
                  {user?.role === "admin" && <button className="secondary-btn" onClick={() => openCreate()}><Plus size={18} /> สร้างเกมใหม่</button>}
                </div>
                <div className="hero-proof"><span className="proof-avatars">✦ ♡ ★</span><span>จินตนาการได้ไม่จำกัด สนุกได้ทุกหมวด</span></div>
              </div>
              <div className="hero-art" aria-label="ภาพประกอบเกม">
                <div className="floating-chip chip-one">✨ CHOOSE YOUR CHAMPION</div>
                <div className="art-card art-card-back"><span>VS</span></div>
                <div className="art-card art-card-front">
                  {heroImageUrl ? <img className="hero-custom-image" src={heroImageUrl} alt="ภาพประกอบหน้าแรก" /> : (
                    <div className="art-champion" aria-label="ตัวอย่างตัวละครแชมป์">
                      <span className="champion-crown">👑</span>
                      <span className="champion-face">🦊</span>
                      <span className="champion-stars">✦　✦　✦</span>
                    </div>
                  )}
                  <div className="art-label"><Trophy size={17} /> YOUR CHAMPION</div>
                </div>
                <div className="floating-chip chip-two">🏆 WORLD CUP</div>
                <div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div>
              </div>
              <div className="hero-squiggle" />
            </section>

            <section className="feature-strip">
              <div><span className="feature-icon peach"><Gamepad2 size={21} /></span><span><b>เล่นง่าย</b><small>เลือกจากสองตัวเลือก</small></span></div>
              <div><span className="feature-icon lilac"><Trophy size={21} /></span><span><b>หาผู้ชนะ</b><small>แข่งจนเหลือหนึ่งเดียว</small></span></div>
              <div><span className="feature-icon mint"><Sparkles size={21} /></span><span><b>มีเกมให้เลือก</b><small>แอดมินเพิ่มควิซใหม่ให้เล่น</small></span></div>
            </section>

            <section className="quiz-section" id="quiz-list">
              <div className="section-heading">
                <div><div className="section-kicker">PICK YOUR FAVORITE</div><h2>ควิซที่น่าเล่น <span>♡</span></h2><p>เลือกเกมที่ใช่ แล้วเริ่มการแข่งขันได้เลย</p></div>
                {user?.role === "admin" && <button className="text-button" onClick={() => openCreate()}>สร้างควิซใหม่ <ArrowRight size={16} /></button>}
              </div>
              <form className="search-box" onSubmit={(e) => { e.preventDefault(); void loadQuizzes(search); }}>
                <Search size={19} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาควิซหรือหมวดหมู่..." />
                <button type="submit">ค้นหา</button>
              </form>
              {error && <div className="alert error-alert">{error}</div>}
              {notice && <div className="alert success-alert">{notice}</div>}
              {loading ? <div className="empty-state">กำลังโหลดควิซ...</div> : quizzes.length === 0 ? (
                <div className="empty-state"><span>🪄</span><h3>ยังไม่มีควิซที่ตรงกัน</h3><p>ลองค้นหาคำอื่นอีกครั้งในภายหลัง</p></div>
              ) : (
                <div className="quiz-grid">
                  {quizzes.map((quiz, index) => (
                    <article className="quiz-card" key={quiz.id}>
                      <button className={`quiz-cover cover-${index % 4}${quiz.coverImageUrl ? " has-cover" : ""}`} onClick={() => void openQuiz(quiz.id)} aria-label={`เล่น ${quiz.title}`}>
                        <span className="cover-sticker">{index === 0 ? "HOT PICK ✦" : quiz.category}</span>
                        {quiz.coverImageUrl ? (
                          <img className="cover-image" src={quiz.coverImageUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                        ) : <span className="cover-emoji">{["🌸", "🎮", "⭐", "💖"][index % 4]}</span>}
                        <span className="cover-shade" />
                        <span className="cover-title">{quiz.title}</span>
                        <span className="cover-play">PLAY <ArrowRight size={15} /></span>
                      </button>
                      <div className="quiz-card-info"><div><h3>{quiz.title}</h3><p>{quiz.category} · {quiz.option_count} ตัวเลือก</p></div><div className="play-count"><Gamepad2 size={14} /> {quiz.play_count}</div></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {(view === "create" || view === "edit") && user && <CreateQuiz
          key={view === "edit" ? `edit-${editingQuiz?.id}` : "create"}
          error={error}
          initialQuiz={view === "edit" ? editingQuiz : null}
          onCancel={() => {
            if (quizReturnView === "profile") void openProfile();
            else openAdmin();
          }}
          onSave={saveQuiz}
        />}
        {view === "auth" && <AuthPage
          mode={authMode}
          notice={notice}
          onModeChange={setAuthMode}
          onCancel={() => { setView("home"); setNotice(""); }}
          onAuthenticated={handleAuthenticated}
        />}
        {view === "admin" && user?.role === "admin" && <AdminDashboard
          quizzes={quizzes}
          error={error}
          notice={notice}
          heroImageUrl={heroImageUrl}
          heroBackgroundUrl={heroBackgroundUrl}
          heroSettingsError={heroSettingsError}
          heroImageSaving={heroImageSaving}
          onSaveHeroImage={(file) => saveHeroImage(file, "card")}
          onResetHeroImage={() => resetHeroImage("card")}
          onSaveHeroBackground={(file) => saveHeroImage(file, "background")}
          onResetHeroBackground={() => resetHeroImage("background")}
          onCreate={openCreate}
          onUsers={openUsers}
          onEdit={(id) => void openEdit(id)}
          onDelete={(id) => void deleteQuiz(id)}
          onPlay={(id) => void openQuiz(id)}
        />}
        {view === "users" && user?.role === "admin" && <AdminUsersPage
          users={adminUsers}
          search={userSearch}
          loading={adminUsersLoading}
          error={adminUsersError}
          notice={notice}
          currentUserId={user.id}
          onSearch={(value) => void loadAdminUsers(value)}
          onEdit={openUserEdit}
          onDelete={(target) => {
            if (window.confirm(`ต้องการลบผู้ใช้ ${target.email} หรือไม่? ประวัติการเล่นจะยังคงอยู่โดยไม่ระบุบัญชี`)) {
              void deleteUser(target.id);
            }
          }}
          onBack={openAdmin}
        />}
        {view === "user-edit" && user?.role === "admin" && editingUser && <AdminUserEditor
          target={editingUser}
          currentUserId={user.id}
          error={adminUsersError}
          onSave={saveUser}
          onCancel={() => setView("users")}
        />}
        {view === "profile" && user && <ProfilePage
          profile={profile}
          loading={profileLoading}
          error={profileError}
          notice={notice}
          onRefresh={() => void openProfile()}
          onBack={() => setView("home")}
          onCreateQuiz={() => openCreate("profile")}
          onEditQuiz={(id) => void openEdit(id, "profile")}
          onDeleteQuiz={(id) => {
            const quiz = profile?.ownedQuizzes.find((item) => item.id === id);
            if (quiz && window.confirm(`ต้องการลบควิซ “${quiz.title}” หรือไม่? การลบนี้ไม่สามารถย้อนกลับได้`)) {
              void deleteQuiz(id, "profile");
            }
          }}
        />}
        {view === "play" && activeQuiz && <WorldCup quiz={activeQuiz} isLoggedIn={!!user} onExit={() => { setView("home"); setNotice(""); void loadQuizzes(""); }} />}
      </main>

      <footer className="footer"><button className="brand footer-brand" onClick={() => setView("home")}><span className="brand-mark"><Sparkles size={18} /></span><span>quizzy<span className="brand-dot">.</span></span></button><span>เล่น World Cup เลือกตัวละครที่คุณชอบ ✦</span><span>Made for curious minds ♡</span></footer>
    </div>
  );
}

function AuthPage({ mode, notice, onModeChange, onCancel, onAuthenticated }: {
  mode: "login" | "register";
  notice: string;
  onModeChange: (mode: "login" | "register") => void;
  onCancel: () => void;
  onAuthenticated: (user: AuthUser, token: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = mode === "register"
        ? await api.register({ displayName, email, password })
        : await api.login({ email, password });
      onAuthenticated(result.user, result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <button className="back-button" onClick={onCancel}><ArrowLeft size={17} /> กลับหน้าแรก</button>
      <div className="auth-card panel">
        <div className="auth-icon">{mode === "register" ? <UserPlus size={25} /> : <LogIn size={25} />}</div>
        <div className="section-kicker">{mode === "register" ? "JOIN QUIZZY" : "WELCOME BACK"}</div>
        <h1>{mode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</h1>
        <p>{mode === "register" ? "สร้างบัญชีเพื่อเข้าร่วมชุมชน Quizzy" : "เข้าสู่ระบบเพื่อใช้งานบัญชีของคุณ"}</p>
        {notice && <div className="alert success-alert">{notice}</div>}
        <form onSubmit={(event) => void submit(event)}>
          {mode === "register" && <label className="field-label">ชื่อที่แสดง<input required minLength={2} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="ชื่อของคุณ" /></label>}
          <label className="field-label">อีเมล<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label className="field-label">รหัสผ่าน<input required type="password" minLength={mode === "register" ? 8 : undefined} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "อย่างน้อย 8 ตัวอักษร" : "รหัสผ่านของคุณ"} /></label>
          {error && <div className="alert error-alert">{error}</div>}
          <button className="primary-btn auth-submit" type="submit" disabled={submitting}>{submitting ? "กำลังดำเนินการ..." : mode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</button>
        </form>
        <div className="auth-switch">
          {mode === "register" ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?"}
          <button onClick={() => { setError(""); onModeChange(mode === "register" ? "login" : "register"); }}>
            {mode === "register" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </button>
        </div>
        <div className="admin-hint"><Shield size={16} /> บัญชีแอดมินกำหนดโดยผู้ดูแลระบบและไม่สามารถสมัครเป็นแอดมินจากหน้านี้ได้</div>
      </div>
    </section>
  );
}

function AdminDashboard({ quizzes, error, notice, heroImageUrl, heroBackgroundUrl, heroSettingsError, heroImageSaving, onSaveHeroImage, onResetHeroImage, onSaveHeroBackground, onResetHeroBackground, onCreate, onUsers, onEdit, onDelete, onPlay }: {
  quizzes: QuizSummary[];
  error: string;
  notice: string;
  heroImageUrl: string;
  heroBackgroundUrl: string;
  heroSettingsError: string;
  heroImageSaving: boolean;
  onSaveHeroImage: (file: File) => void;
  onResetHeroImage: () => void;
  onSaveHeroBackground: (file: File) => void;
  onResetHeroBackground: () => void;
  onCreate: () => void;
  onUsers: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onPlay: (id: number) => void;
}) {
  return (
    <section className="admin-page">
      <div className="admin-heading">
        <div><div className="section-kicker"><Shield size={14} /> ADMINISTRATION</div><h1>จัดการควิซ</h1><p>สร้างและดูแลรายการควิซ พร้อมอัปโหลดรูปภาพจริงจากอุปกรณ์</p></div>
        <div className="admin-heading-actions"><button className="secondary-btn" onClick={onUsers}><UserRound size={16} /> จัดการผู้ใช้</button><button className="primary-btn" onClick={onCreate}><Plus size={17} /> สร้างควิซ</button></div>
      </div>
      {error && <div className="alert error-alert">{error}</div>}
      {notice && <div className="alert success-alert">{notice}</div>}
      <section className="hero-image-settings">
        <div className="hero-settings-copy">
          <div className="section-kicker"><Sparkles size={14} /> HOMEPAGE APPEARANCE</div>
          <h2>ภาพประกอบหน้าแรก</h2>
          <p>เปลี่ยนรูปตัวละครบนการ์ดด้านขวาของหน้าแรก ภาพใหม่จะแสดงกับผู้เข้าชมทุกคน</p>
          {heroSettingsError && <div className="alert error-alert">{heroSettingsError}</div>}
          <div className="hero-settings-actions">
            <label className={`upload-field hero-image-upload${heroImageSaving ? " is-disabled" : ""}`}>
              <Upload size={15} /> {heroImageSaving ? "กำลังบันทึก..." : "เลือกรูปใหม่"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={heroImageSaving}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onSaveHeroImage(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {heroImageUrl && <button className="secondary-btn" type="button" disabled={heroImageSaving} onClick={onResetHeroImage}>ใช้ภาพเริ่มต้น</button>}
          </div>
          <small>รองรับ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB</small>
        </div>
        <div className="hero-settings-preview">
          {heroImageUrl ? <img src={heroImageUrl} alt="ภาพประกอบหน้าแรกปัจจุบัน" /> : (
            <div className="hero-settings-default"><span>👑</span><b>ภาพเริ่มต้น</b></div>
          )}
          <span className="hero-preview-caption">แสดงบนหน้าแรก</span>
        </div>
      </section>
      <section className="hero-image-settings hero-background-settings">
        <div className="hero-settings-copy">
          <div className="section-kicker"><Sparkles size={14} /> HERO BACKGROUND</div>
          <h2>พื้นหลังแถบหน้าแรก</h2>
          <p>เปลี่ยนภาพพื้นหลังขนาดเต็มของแถบต้อนรับด้านบน ระบบใส่ชั้นสีทับเพื่อช่วยให้ข้อความอ่านชัด</p>
          {heroSettingsError && <div className="alert error-alert">{heroSettingsError}</div>}
          <div className="hero-settings-actions">
            <label className={`upload-field hero-image-upload${heroImageSaving ? " is-disabled" : ""}`}>
              <Upload size={15} /> {heroImageSaving ? "กำลังบันทึก..." : "เลือกรูปพื้นหลัง"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={heroImageSaving}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onSaveHeroBackground(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {heroBackgroundUrl && <button className="secondary-btn" type="button" disabled={heroImageSaving} onClick={onResetHeroBackground}>คืนค่าพื้นหลังไล่สี</button>}
          </div>
          <small>แนะนำภาพแนวนอน รองรับ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB</small>
        </div>
        <div
          className={`hero-settings-preview hero-background-preview${heroBackgroundUrl ? " has-custom-background" : ""}`}
          style={heroBackgroundUrl ? { backgroundImage: `linear-gradient(90deg, rgba(73,43,128,.66), rgba(196,75,120,.3)), url("${heroBackgroundUrl}")` } : undefined}
        >
          {!heroBackgroundUrl && <div className="hero-settings-default"><span>🌈</span><b>พื้นหลังไล่สีเริ่มต้น</b></div>}
          <span className="hero-preview-caption">ตัวอย่างพื้นหลัง</span>
        </div>
      </section>
      <div className="admin-summary"><strong>{quizzes.length}</strong><span>ควิซในระบบ</span></div>
      {quizzes.length === 0 ? <div className="empty-state">ยังไม่มีควิซในระบบ</div> : (
        <div className="admin-quiz-list">
          {quizzes.map((quiz) => (
            <article className="admin-quiz-row" key={quiz.id}>
              <div><h2>{quiz.title}</h2><p>{quiz.category} · {quiz.option_count} ตัวเลือก · เล่น {quiz.play_count} ครั้ง</p></div>
              <div className="admin-quiz-actions">
                <button className="secondary-btn" onClick={() => onEdit(quiz.id)}><Pencil size={14} /> แก้ไข</button>
                <button className="secondary-btn" onClick={() => onPlay(quiz.id)}>ดูควิซ</button>
                <button className="delete-button" onClick={() => {
                  if (window.confirm(`ต้องการลบควิซ “${quiz.title}” หรือไม่?`)) onDelete(quiz.id);
                }} aria-label={`ลบ ${quiz.title}`}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminUsersPage({ users, search, loading, error, notice, currentUserId, onSearch, onEdit, onDelete, onBack }: {
  users: AdminUser[];
  search: string;
  loading: boolean;
  error: string;
  notice: string;
  currentUserId: number;
  onSearch: (search: string) => void;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState(search);
  useEffect(() => setQuery(search), [search]);

  return (
    <section className="admin-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> กลับหน้าจัดการระบบ</button>
      <div className="admin-heading">
        <div><div className="section-kicker"><UserRound size={14} /> USER MANAGEMENT</div><h1>จัดการผู้ใช้</h1><p>ค้นหาด้วยอีเมล แล้วแก้ไขข้อมูลบัญชีหรือสิทธิ์ผู้ใช้</p></div>
      </div>
      <form className="search-box user-search-box" onSubmit={(event) => { event.preventDefault(); onSearch(query.trim()); }}>
        <Search size={19} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาจากอีเมล..." aria-label="ค้นหาผู้ใช้จากอีเมล" />
        {query && <button className="clear-search" type="button" onClick={() => { setQuery(""); onSearch(""); }}>ล้าง</button>}
        <button type="submit" disabled={loading}>ค้นหา</button>
      </form>
      {error && <div className="alert error-alert">{error}</div>}
      {notice && <div className="alert success-alert">{notice}</div>}
      <div className="admin-summary"><strong>{users.length}</strong><span>{search ? `ผู้ใช้ที่ตรงกับ “${search}”` : "ผู้ใช้ล่าสุด"}</span></div>
      {loading ? <div className="empty-state">กำลังโหลดรายชื่อผู้ใช้...</div> : users.length === 0 ? (
        <div className="empty-state"><span>🔎</span><h3>ไม่พบผู้ใช้</h3><p>ลองตรวจสอบอีเมลที่ค้นหาอีกครั้ง</p></div>
      ) : (
        <div className="admin-user-list">
          {users.map((target) => (
            <article className="admin-user-row" key={target.id}>
              <div className="admin-user-avatar"><UserRound size={20} /></div>
              <div className="admin-user-info">
                <h2>{target.displayName} {target.id === currentUserId && <span className="self-user-label">คุณ</span>}</h2>
                <p>{target.email}</p>
                <span className={`role-badge ${target.role === "admin" ? "admin-role" : ""}`}>{target.role === "admin" ? "แอดมิน" : "สมาชิก"}</span>
              </div>
              <div className="admin-user-actions">
                <button className="secondary-btn" onClick={() => onEdit(target)}><Pencil size={14} /> แก้ไข</button>
                <button className="delete-button" disabled={target.id === currentUserId} onClick={() => onDelete(target)} aria-label={`ลบผู้ใช้ ${target.email}`} title={target.id === currentUserId ? "ไม่สามารถลบบัญชีที่กำลังใช้งานได้" : "ลบผู้ใช้"}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!search && users.length === 100 && <p className="user-list-note">แสดงผู้ใช้ล่าสุด 100 รายการ หากต้องการค้นหาผู้ใช้คนอื่น ให้ค้นหาด้วยอีเมล</p>}
    </section>
  );
}

function AdminUserEditor({ target, currentUserId, error, onSave, onCancel }: {
  target: AdminUser;
  currentUserId: number;
  error: string;
  onSave: (id: number, payload: { email: string; displayName: string; role: AuthUser["role"]; password?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(target.email);
  const [displayName, setDisplayName] = useState(target.displayName);
  const [role, setRole] = useState<AuthUser["role"]>(target.role);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(target.id, { email, displayName, role, ...(password ? { password } : {}) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-page">
      <button className="back-button" onClick={onCancel}><ArrowLeft size={17} /> กลับรายชื่อผู้ใช้</button>
      <div className="creator-heading"><div className="section-kicker">EDIT USER</div><h1>แก้ไขผู้ใช้ <span>✦</span></h1><p>บัญชี {target.email}</p></div>
      <form className="user-editor panel" onSubmit={(event) => void submit(event)}>
        <label className="field-label">ชื่อที่แสดง<input required minLength={2} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label className="field-label">อีเมล<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field-label">ระดับสิทธิ์<select value={role} disabled={target.id === currentUserId} onChange={(event) => setRole(event.target.value as AuthUser["role"])}><option value="member">สมาชิก</option><option value="admin">แอดมิน</option></select></label>
        {target.id === currentUserId && <div className="admin-hint"><Shield size={16} /> ไม่สามารถลดสิทธิ์บัญชีแอดมินที่กำลังใช้งานได้</div>}
        <label className="field-label">ตั้งรหัสผ่านใหม่ (ไม่บังคับ)<input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="เว้นว่างไว้หากไม่ต้องการเปลี่ยนรหัสผ่าน" /></label>
        {error && <div className="alert error-alert">{error}</div>}
        <div className="form-actions"><button type="button" className="secondary-btn" onClick={onCancel}>ยกเลิก</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกผู้ใช้"}</button></div>
      </form>
    </section>
  );
}

function ProfilePage({ profile, loading, error, notice, onRefresh, onBack, onCreateQuiz, onEditQuiz, onDeleteQuiz }: {
  profile: UserProfile | null;
  loading: boolean;
  error: string;
  notice: string;
  onRefresh: () => void;
  onBack: () => void;
  onCreateQuiz: () => void;
  onEditQuiz: (id: number) => void;
  onDeleteQuiz: (id: number) => void;
}) {
  return (
    <section className="profile-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> กลับหน้าแรก</button>
      {loading ? <div className="empty-state">กำลังโหลดโปรไฟล์...</div> : error ? (
        <div className="empty-state"><h2>โหลดโปรไฟล์ไม่สำเร็จ</h2><p>{error}</p><button className="primary-btn" onClick={onRefresh}>ลองอีกครั้ง</button></div>
      ) : profile ? (
        <>
          {notice && <div className="alert success-alert">{notice}</div>}
          <div className="profile-heading">
            <div className="profile-avatar"><UserRound size={34} /></div>
            <div><div className="section-kicker">YOUR PROFILE</div><h1>{profile.user.displayName}</h1><p>{profile.user.email}</p></div>
          </div>
          <section className="profile-section owned-quizzes-section">
            <div className="profile-section-heading">
              <div><div className="section-kicker"><Sparkles size={14} /> YOUR QUIZZES</div><h2>ควิซของฉัน</h2><p>ควิซที่คุณสร้าง จัดการแก้ไขหรือลบได้จากตรงนี้</p></div>
              <button className="primary-btn" onClick={onCreateQuiz}><Plus size={16} /> สร้างควิซ</button>
            </div>
            {profile.ownedQuizzes.length === 0 ? (
              <div className="empty-state"><span>🎮</span><h3>ยังไม่มีควิซของคุณ</h3><p>สร้างควิซแรก แล้วชวนคนอื่นมาเล่นได้เลย</p><button className="primary-btn" onClick={onCreateQuiz}><Plus size={16} /> สร้างควิซแรก</button></div>
            ) : (
              <div className="owned-quiz-list">
                {profile.ownedQuizzes.map((quiz) => (
                  <article className="owned-quiz-row" key={quiz.id}>
                    <div className="owned-quiz-cover">
                      {quiz.coverImageUrl ? <img src={quiz.coverImageUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span>🎯</span>}
                    </div>
                    <div className="owned-quiz-info">
                      <h3>{quiz.title}</h3>
                      <p>{quiz.category} · {quiz.option_count} ตัวเลือก · เล่น {quiz.play_count} ครั้ง</p>
                    </div>
                    <div className="owned-quiz-actions">
                      <button className="secondary-btn" onClick={() => onEditQuiz(quiz.id)}><Pencil size={14} /> แก้ไข</button>
                      <button className="delete-button" onClick={() => onDeleteQuiz(quiz.id)} aria-label={`ลบควิซ ${quiz.title}`} title="ลบควิซ"><Trash2 size={16} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="profile-section">
            <div className="profile-section-heading"><div><div className="section-kicker"><Heart size={14} /> MOST PICKED CHAMPIONS</div><h2>10 ตัวที่คุณชอบที่สุด</h2><p>จัดอันดับจากตัวละครที่คุณเลือกเป็นแชมป์ในเกมที่เล่นขณะเข้าสู่ระบบ</p></div></div>
            {profile.favorites.length === 0 ? (
              <div className="empty-state"><span>♡</span><h3>ยังไม่มีตัวละครในอันดับ</h3><p>เข้าสู่ระบบแล้วเล่นควิซเพื่อเก็บประวัติตัวละครที่คุณเลือก</p></div>
            ) : (
              <div className="favorite-grid">
                {profile.favorites.map((favorite, index) => (
                  <article className="favorite-card" key={favorite.id}>
                    <div className="favorite-rank">#{index + 1}</div>
                    <div className="favorite-image"><img src={favorite.imageUrl || fallbackImage(favorite.name)} alt={favorite.name} onError={(event) => { event.currentTarget.src = fallbackImage(favorite.name); }} /></div>
                    <div className="favorite-info"><h3>{favorite.name}</h3><p><Heart size={13} /> เลือกเป็นแชมป์ {favorite.playCount} ครั้ง</p></div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="profile-section history-section">
            <div className="profile-section-heading"><div><div className="section-kicker"><CalendarDays size={14} /> YOUR HISTORY</div><h2>เกมที่เล่นล่าสุด</h2></div><span className="count-pill">{profile.recentPlays.length} เกม</span></div>
            {profile.recentPlays.length === 0 ? (
              <div className="empty-state"><h3>ยังไม่มีประวัติการเล่น</h3><p>ผลการเล่นหลังเข้าสู่ระบบจะแสดงที่นี่</p></div>
            ) : (
              <div className="play-history-list">
                {profile.recentPlays.map((play, index) => (
                  <article className="play-history-row" key={`${play.quizId}-${play.playedAt}-${index}`}>
                    <div className="history-winner-image"><img src={play.winnerImageUrl || fallbackImage(play.winnerName || "Winner")} alt="" onError={(event) => { event.currentTarget.src = fallbackImage(play.winnerName || "Winner"); }} /></div>
                    <div className="history-details"><h3>{play.quizTitle || "ควิซที่ถูกลบ"}</h3><p>แชมป์ที่เลือก: {play.winnerName || "ไม่มีข้อมูล"}</p></div>
                    <time dateTime={play.playedAt}>{new Date(play.playedAt).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}</time>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function CreateQuiz({ error, initialQuiz, onCancel, onSave }: {
  error: string;
  initialQuiz: Quiz | null;
  onCancel: () => void;
  onSave: (payload: { title: string; description: string; category: string; coverImageUrl: string; options: DraftOption[] }, quizId?: number) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialQuiz?.title ?? "");
  const [description, setDescription] = useState(initialQuiz?.description ?? "");
  const [category, setCategory] = useState(initialQuiz?.category ?? "Anime");
  const [coverImageUrl, setCoverImageUrl] = useState(initialQuiz?.coverImageUrl ?? "");
  const [options, setOptions] = useState<Array<DraftOption & { key: string }>>(() =>
    initialQuiz
      ? initialQuiz.options.map((option) => ({ ...option, key: String(option.id) }))
      : [
          { key: "1", name: "", imageUrl: "" },
          { key: "2", name: "", imageUrl: "" },
          { key: "3", name: "", imageUrl: "" },
          { key: "4", name: "", imageUrl: "" },
        ],
  );
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [uploading, setUploading] = useState<Set<string>>(new Set());

  function updateOption(key: string, field: keyof DraftOption, value: string) {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, [field]: value } : option));
  }
  function getUploadTitle(): string | null {
    const quizTitle = title.trim();
    if (quizTitle.length < 3) {
      setLocalError("กรุณากรอกชื่อควิซอย่างน้อย 3 ตัวอักษรก่อนอัปโหลดรูป");
      return null;
    }
    if (quizTitle.length > 120) {
      setLocalError("ชื่อควิซต้องไม่เกิน 120 ตัวอักษร");
      return null;
    }
    return quizTitle;
  }
  async function uploadOptionImage(key: string, file?: File) {
    if (!file) return;
    const quizTitle = getUploadTitle();
    if (!quizTitle) return;
    if (file.size > 5 * 1024 * 1024) {
      setLocalError("ไฟล์ภาพต้องมีขนาดไม่เกิน 5 MB");
      return;
    }
    setLocalError("");
    setUploading((current) => new Set(current).add(key));
    try {
      const result = await api.uploadImage(file, quizTitle);
      updateOption(key, "imageUrl", result.imageUrl);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "อัปโหลดภาพไม่สำเร็จ");
    } finally {
      setUploading((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }
  async function uploadCoverImage(file?: File) {
    if (!file) return;
    const quizTitle = getUploadTitle();
    if (!quizTitle) return;
    if (file.size > 5 * 1024 * 1024) {
      setLocalError("ไฟล์ภาพต้องมีขนาดไม่เกิน 5 MB");
      return;
    }
    setLocalError("");
    setUploading((current) => new Set(current).add("cover"));
    try {
      const result = await api.uploadImage(file, quizTitle);
      setCoverImageUrl(result.imageUrl);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "อัปโหลดรูปปกไม่สำเร็จ");
    } finally {
      setUploading((current) => {
        const next = new Set(current);
        next.delete("cover");
        return next;
      });
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = options.filter((o) => o.name.trim()).map(({ key: _key, ...option }) => option);
    if (title.trim().length < 3) { setLocalError("ชื่อควิซต้องมีอย่างน้อย 3 ตัวอักษร"); return; }
    if (filled.length < 2) { setLocalError("เพิ่มตัวเลือกที่มีชื่ออย่างน้อย 2 ตัวเลือก"); return; }
    setLocalError("");
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim(), category, coverImageUrl: coverImageUrl.trim(), options: filled }, initialQuiz?.id);
    } finally { setSaving(false); }
  }

  return (
    <section className="creator-page">
      <button className="back-button" onClick={onCancel}><ArrowLeft size={17} /> กลับหน้าแรก</button>
      <div className="creator-heading"><div className="section-kicker">YOUR CONTENT</div><h1>{initialQuiz ? "แก้ไขควิซ" : "สร้างควิซใหม่"} <span>✦</span></h1><p>จัดการตัวเลือกและภาพประกอบของควิซให้ผู้เล่นเข้ามาเล่น</p></div>
      <form className="creator-layout" onSubmit={submit}>
        <div className="creator-main panel">
          <label className="field-label">ชื่อควิซ <span>*</span><input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ตัวละครอนิเมะที่คุณชอบที่สุด" /></label>
          <label className="field-label">รายละเอียด<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="เล่าให้ผู้เล่นรู้ว่าเกมนี้เกี่ยวกับอะไร..." /></label>
          <label className="field-label">หมวดหมู่<select value={category} onChange={(e) => setCategory(e.target.value)}><option>Anime</option><option>Gaming</option><option>Manga</option><option>Movies</option><option>Music</option><option>ทั่วไป</option></select></label>
          <div className="cover-editor">
            <div className="cover-editor-heading"><div><h2>รูปปกควิซ</h2><p>รูปนี้จะแสดงบนการ์ดควิซในหน้าแรก (JPEG, PNG หรือ WebP ไม่เกิน 5 MB)</p></div></div>
            <div className="cover-upload-preview">
              {coverImageUrl ? (
                <img src={coverImageUrl} alt="ตัวอย่างรูปปกควิซ" onError={(event) => { event.currentTarget.style.display = "none"; }} />
              ) : <div className="cover-placeholder"><Upload size={25} /><span>ยังไม่ได้เลือกรูปปก</span></div>}
              <div className="cover-upload-actions">
                <label className="upload-field"><Upload size={14} /><span>{uploading.has("cover") ? "กำลังอัปโหลด..." : coverImageUrl ? "เปลี่ยนรูปปก" : "อัปโหลดรูปปก"}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading.has("cover")} onChange={(event) => { void uploadCoverImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
                {coverImageUrl && <button className="remove-cover" type="button" onClick={() => setCoverImageUrl("")}><X size={14} /> นำรูปออก</button>}
              </div>
            </div>
            <label className="field-label cover-url-field">หรือใช้ URL รูปภาพ<input type="url" maxLength={2000} value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="https://example.com/cover.jpg" /></label>
          </div>
          <div className="options-heading"><div><h2>ตัวเลือกในทัวร์นาเมนต์</h2><p>อัปโหลดรูป JPEG, PNG หรือ WebP (สูงสุด 5 MB) หรือใส่ URL รูปภาพ · รูปที่อัปโหลดจะอยู่ในโฟลเดอร์ตามชื่อควิซ</p></div><span className="count-pill">{options.filter(o => o.name.trim()).length} รายการ</span></div>
          <div className="option-editor-list">
            {options.map((option, index) => (
              <div className="option-editor" key={option.key}>
                <div className="option-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="option-preview"><img src={option.imageUrl || fallbackImage(option.name || `Option ${index + 1}`)} alt="" onError={(e) => { e.currentTarget.src = fallbackImage(option.name); }} /></div>
                <div className="option-fields">
                  <input value={option.name} onChange={(e) => updateOption(option.key, "name", e.target.value)} maxLength={120} placeholder={`ชื่อตัวเลือก ${index + 1}`} />
                  <input value={option.imageUrl} onChange={(e) => updateOption(option.key, "imageUrl", e.target.value)} placeholder="https://... URL รูปภาพ (ไม่บังคับ)" />
                  <label className="upload-field"><Upload size={14} /><span>{uploading.has(option.key) ? "กำลังอัปโหลด..." : option.imageUrl ? "เปลี่ยนรูปภาพ" : "เลือกไฟล์ภาพ"}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading.has(option.key)} onChange={(event) => { void uploadOptionImage(option.key, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
                </div>
                {options.length > 2 && <button type="button" className="remove-option" onClick={() => setOptions(current => current.filter((item) => item.key !== option.key))} aria-label="ลบตัวเลือก"><X size={17} /></button>}
              </div>
            ))}
          </div>
          <button type="button" className="add-option" disabled={options.length >= 64} onClick={() => setOptions(current => [...current, { key: `${Date.now()}-${current.length}`, name: "", imageUrl: "" }])}><Plus size={17} /> เพิ่มตัวเลือก</button>
          {localError && <div className="alert error-alert">{localError}</div>}
          {error && <div className="alert error-alert">{error}</div>}
          <div className="form-actions"><button type="button" className="secondary-btn" onClick={onCancel}>ยกเลิก</button><button type="submit" className="primary-btn" disabled={saving || uploading.size > 0}>{saving || uploading.size > 0 ? "กำลังบันทึก..." : <><Sparkles size={17} /> {initialQuiz ? "บันทึกการแก้ไข" : "สร้างควิซ"}</>}</button></div>
        </div>
        <aside className="creator-aside"><div className="aside-illustration">🏆<span>✦</span></div><h3>พร้อมหาแชมป์หรือยัง?</h3><p>ผู้เล่นจะเลือกทีละคู่ จนเหลือตัวเลือกสุดท้ายที่เป็นผู้ชนะของทัวร์นาเมนต์</p><div className="aside-tip"><Sparkles size={17} /><span><b>เคล็ดลับ</b><br />ใส่ตัวเลือก 8, 16 หรือ 32 รายการ จะได้รอบการแข่งขันที่ลงตัว</span></div></aside>
      </form>
    </section>
  );
}

function WorldCup({ quiz, isLoggedIn, onExit }: { quiz: Quiz; isLoggedIn: boolean; onExit: () => void }) {
  const [roundOptions, setRoundOptions] = useState<Quiz["options"]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [nextRound, setNextRound] = useState<Quiz["options"]>([]);
  const [winner, setWinner] = useState<Quiz["options"][number] | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    const shuffled = [...quiz.options].sort(() => Math.random() - 0.5);
    // ถ้าจำนวนตัวเลือกเป็นเลขคี่ ให้ตัวเลือกสุดท้ายผ่านรอบโดยอัตโนมัติ (bye)
    const hasBye = shuffled.length % 2 === 1;
    setRoundOptions(hasBye ? shuffled.slice(0, -1) : shuffled);
    setRoundIndex(0);
    setNextRound(hasBye ? [shuffled[shuffled.length - 1]] : []);
    setWinner(null);
    setSaveStatus("idle");
  }, [quiz.id]);

  const totalMatches = Math.max(1, Math.ceil(quiz.options.length / 2));
  const completedMatches = Math.min(roundIndex, totalMatches);
  const currentPair = useMemo(() => roundOptions.slice(roundIndex * 2, roundIndex * 2 + 2), [roundOptions, roundIndex]);

  function choose(option: Quiz["options"][number]) {
    const next = [...nextRound, option];
    if (roundIndex + 1 < roundOptions.length / 2) {
      setNextRound(next);
      setRoundIndex((n) => n + 1);
      return;
    }
    if (next.length === 1) {
      setWinner(next[0]);
      setSaveStatus("saving");
      void api.savePlay(quiz.id, next[0].id)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("failed"));
      return;
    }
    const hasBye = next.length % 2 === 1;
    setRoundOptions(hasBye ? next.slice(0, -1) : next);
    setNextRound(hasBye ? [next[next.length - 1]] : []);
    setRoundIndex(0);
  }

  function restart() {
    const shuffled = [...quiz.options].sort(() => Math.random() - 0.5);
    const hasBye = shuffled.length % 2 === 1;
    setRoundOptions(hasBye ? shuffled.slice(0, -1) : shuffled);
    setRoundIndex(0);
    setNextRound(hasBye ? [shuffled[shuffled.length - 1]] : []);
    setWinner(null);
    setSaveStatus("idle");
  }

  return (
    <section className="play-page">
      <button className="back-button" onClick={onExit}><ArrowLeft size={17} /> กลับไปเลือกควิซ</button>
      <div className="play-header"><div className="section-kicker">WORLD CUP MODE</div><h1>{quiz.title}</h1><p>{quiz.description || "เลือกตัวเลือกที่คุณชอบที่สุดในแต่ละคู่"}</p></div>
      {winner ? (
        <div className="winner-panel">
          <div className="winner-confetti">✦　✧　★　✦　✧</div><div className="winner-crown">🏆</div><div className="section-kicker">THE CHAMPION</div><h2>ผู้ชนะของคุณคือ...</h2>
          <div className="winner-image"><img src={winner.imageUrl || fallbackImage(winner.name)} alt={winner.name} onError={(e) => { e.currentTarget.src = fallbackImage(winner.name); }} /></div><h3>{winner.name}</h3><p>แชมป์ประจำทัวร์นาเมนต์นี้!</p>
          <p className="winner-save-status">{saveStatus === "saving" ? "กำลังบันทึกผล..." : saveStatus === "failed" ? "บันทึกผลไม่สำเร็จ กรุณาลองเล่นใหม่อีกครั้ง" : isLoggedIn ? "บันทึกผลไว้ในประวัติโปรไฟล์แล้ว" : "เข้าสู่ระบบก่อนเล่นเพื่อเก็บประวัติไว้ในโปรไฟล์"}</p>
          <div className="winner-actions"><button className="primary-btn" onClick={restart}><Sparkles size={17} /> เล่นอีกครั้ง</button><button className="secondary-btn" onClick={onExit}>เลือกควิซอื่น</button></div>
        </div>
      ) : currentPair.length === 2 ? (
        <div className="match-area">
          <div className="round-bar"><span className="round-label"><Trophy size={17} /> ROUND {Math.floor(Math.log2(Math.max(2, roundOptions.length))) + 1}</span><span>คู่ที่ {roundIndex + 1}</span><div className="progress-track"><span style={{ width: `${Math.min(100, ((roundIndex + 1) / Math.ceil(roundOptions.length / 2)) * 100)}%` }} /></div></div>
          <div className="versus-grid">
            {currentPair.map((option, index) => (
              <button className={`competitor competitor-${index}`} key={`${option.id}-${roundIndex}`} onClick={() => choose(option)}>
                <div className="competitor-image"><img src={option.imageUrl || fallbackImage(option.name)} alt={option.name} onError={(e) => { e.currentTarget.src = fallbackImage(option.name); }} /><span className="choose-overlay"><Check size={25} /> เลือกคนนี้!</span></div>
                <div className="competitor-name"><span>{index === 0 ? "CONTENDER A" : "CONTENDER B"}</span><h2>{option.name}</h2></div>
              </button>
            ))}
            <div className="versus-badge">VS</div>
          </div>
          <p className="choose-hint"><Sparkles size={16} /> แตะรูปตัวละครที่คุณชอบ เพื่อให้ผ่านเข้ารอบต่อไป</p>
        </div>
      ) : <div className="empty-state">กำลังเตรียมทัวร์นาเมนต์...</div>}
    </section>
  );
}
