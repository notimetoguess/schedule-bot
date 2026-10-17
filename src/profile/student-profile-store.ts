import type { StudentProfile } from "../types.js";

export interface StudentProfileStore {
  get(userId: string): Promise<StudentProfile | undefined>;
  set(userId: string, profile: StudentProfile): Promise<void>;
  delete(userId: string): Promise<void>;
}

export class MemoryStudentProfileStore implements StudentProfileStore {
  private readonly profiles = new Map<string, StudentProfile>();
  async get(userId: string): Promise<StudentProfile | undefined> {
    const profile = this.profiles.get(userId);
    return profile ? { ...profile } : undefined;
  }
  async set(userId: string, profile: StudentProfile): Promise<void> { this.profiles.set(userId, { ...profile }); }
  async delete(userId: string): Promise<void> { this.profiles.delete(userId); }
}
