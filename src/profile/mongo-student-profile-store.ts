import type { Collection } from "mongodb";
import type { StudentProfile } from "../types.js";
import type { StudentProfileStore } from "./student-profile-store.js";

interface StudentProfileDocument {
  _id: string;
  profile: StudentProfile;
}

/** Profiles deliberately outlive authorization sessions, but never retain WebDK tokens. */
export class MongoStudentProfileStore implements StudentProfileStore {
  constructor(private readonly collection: Collection<StudentProfileDocument>) {}
  async get(userId: string): Promise<StudentProfile | undefined> {
    const document = await this.collection.findOne({ _id: userId }, { timeoutMS: 10_000 });
    return document ? { ...document.profile } : undefined;
  }
  async set(userId: string, profile: StudentProfile): Promise<void> {
    await this.collection.updateOne({ _id: userId }, { $set: { profile: { ...profile } } }, { upsert: true, timeoutMS: 10_000 });
  }
  async delete(userId: string): Promise<void> {
    await this.collection.deleteOne({ _id: userId }, { timeoutMS: 10_000 });
  }
}
