import { AuthLoginCoordinator } from "../auth/auth-login-coordinator.js";
import type { AuthStore } from "../auth/auth-store.js";
import type { CredentialCrypto } from "../auth/credential-crypto.js";
import { WebDkClient, WebDkError } from "../integrations/webdk.js";
import type { ScheduleLesson, ScheduleView, StudentProfile, StudentSubject } from "../types.js";
import type { StudentProfileStore } from "../profile/student-profile-store.js";
import { currentAcademicYear, tokenFingerprint, toStudentProfile } from "../profile/student-profile.js";
import { filterScheduleToStudentSubjects, studentSemesterChoices, type StudentSemesterChoice } from "./subject-filter.js";

interface CachedSchedule { token: string; expiresAt: number; lessons: ScheduleLesson[]; usedAt: number; }
interface CachedSubjects { token: string; expiresAt: number; subjects: StudentSubject[]; }
export interface ScheduleResult { lessons: ScheduleLesson[]; cached: boolean; view: ScheduleView; notice?: string; semesterName?: string; semesterId?: number; semesterChoices?: StudentSemesterChoice[]; needsSemesterSelection?: boolean; }

/** Centralizes token recovery and avoids duplicate upstream schedule calls. */
export class ScheduleService {
  private readonly cache = new Map<string, CachedSchedule>();
  private readonly subjectCache = new Map<string, CachedSubjects>();
  private readonly coordinator = new AuthLoginCoordinator();
  constructor(
    private readonly store: AuthStore,
    private readonly webDk: WebDkClient,
    private readonly crypto?: CredentialCrypto,
    private readonly profileStore?: StudentProfileStore,
    private readonly cacheMs = 300_000,
  ) {}

  async get(userId: string, dateFrom: string, dateTo: string, view: ScheduleView = "all", semesterId?: number): Promise<ScheduleResult> {
    const key = userId + "\u0000" + dateFrom + "\u0000" + dateTo;
    return this.coordinator.run(userId, async () => {
      const current = await this.store.get(userId);
      if (!current) throw new WebDkError("unauthorized", "No active session");
      const afterWait = this.cache.get(key);
      try {
        if (afterWait && afterWait.token === current.accessToken && afterWait.expiresAt > Date.now()) {
          afterWait.usedAt = Date.now();
          return await this.project(userId, current.accessToken, dateFrom, dateTo, afterWait.lessons, true, view, semesterId);
        }
        const lessons = await this.webDk.getSchedule(current.accessToken, dateFrom, dateTo);
        this.save(key, current.accessToken, lessons);
        return await this.project(userId, current.accessToken, dateFrom, dateTo, lessons, false, view, semesterId);
      } catch (error) {
        if (!(error instanceof WebDkError) || error.kind !== "unauthorized" || !current.rememberedCredentials || !this.crypto) throw error;
        let credentials;
        try { credentials = this.crypto.decrypt(userId, current.rememberedCredentials); }
        catch { await this.store.delete(userId, current.accessToken); throw new WebDkError("unauthorized", "Stored credentials cannot be read"); }
        let result;
        try { result = await this.webDk.login(credentials.email, credentials.password); }
        catch (loginError) {
          if (loginError instanceof WebDkError && loginError.kind === "credentials") await this.store.delete(userId, current.accessToken);
          throw loginError;
        }
        const replacement = { ...current, accessToken: result.accessToken };
        await this.store.set(userId, replacement);
        this.clear(userId);
        const lessons = await this.webDk.getSchedule(result.accessToken, dateFrom, dateTo);
        this.save(key, result.accessToken, lessons);
        return await this.project(userId, result.accessToken, dateFrom, dateTo, lessons, false, view, semesterId);
      }
    });
  }
  clear(userId: string): void {
    for (const key of this.cache.keys()) if (key.startsWith(userId + "\u0000")) this.cache.delete(key);
    for (const key of this.subjectCache.keys()) if (key.startsWith(userId + "\u0000")) this.subjectCache.delete(key);
  }
  private async project(userId: string, token: string, dateFrom: string, dateTo: string, lessons: ScheduleLesson[], cached: boolean, view: ScheduleView, requestedSemesterId?: number): Promise<ScheduleResult> {
    if (view === "all") return { lessons, cached, view };
    try {
      const key = userId + "\u0000" + token;
      let entry = this.subjectCache.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        const subjects = await this.webDk.getStudentSubjects(token);
        entry = { token, subjects, expiresAt: Date.now() + this.cacheMs };
        this.subjectCache.set(key, entry);
      }
      const profile = await this.getProfile(userId, token);
      const choices = studentSemesterChoices(profile.course, profile.academicYear);
      if (!requestedSemesterId) return { lessons, cached, view, semesterChoices: choices, needsSemesterSelection: true };
      const selected = choices.find((choice) => choice.id === requestedSemesterId);
      if (!selected) return { lessons, cached, view, semesterChoices: choices, needsSemesterSelection: true };
      const selectedId = selected.id;
      const filtered = filterScheduleToStudentSubjects(lessons, entry.subjects, selectedId);
      if (!filtered) return { lessons, cached, view: "all", notice: "Не вдалося перевірити обраний семестр. Показано загальний розклад." };
      return { lessons: filtered.lessons, cached, view, semesterName: selected.name, semesterId: selectedId };
    } catch (error) {
      if (error instanceof WebDkError && error.kind === "unauthorized") throw error;
      return { lessons, cached, view: "all", notice: "Не вдалося перевірити ваші предмети. Показано загальний розклад." };
    }
  }
  private save(key: string, token: string, lessons: ScheduleLesson[]): void {
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { token, lessons, expiresAt: Date.now() + this.cacheMs, usedAt: Date.now() });
  }
  private async getProfile(userId: string, token: string): Promise<StudentProfile> {
    if (!this.profileStore) throw new Error("Student profile storage is unavailable");
    const existing = await this.profileStore.get(userId);
    const fingerprint = tokenFingerprint(token);
    const year = currentAcademicYear();
    if (existing && existing.tokenFingerprint === fingerprint && existing.academicYear === year && Date.now() - existing.refreshedAt < 86_400_000) return existing;
    const profile = toStudentProfile(await this.webDk.getStudentProfile(token), token);
    await this.profileStore.set(userId, profile);
    return profile;
  }
}
