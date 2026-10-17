export type ConversationStage = "idle" | "choosing_start" | "choosing_end";
export type ScheduleView = "all" | "me";

export interface AuthSession {
  accessToken: string;
  expiresAt: number;
  /** Normalized WebDk login identity, saved only after successful authentication. */
  authenticatedEmail?: string;
  /** Present only after the user explicitly opted in to automatic login. */
  rememberedCredentials?: EncryptedCredentials;
}

export interface EncryptedCredentials {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface BotSession {
  stage: ConversationStage;
  selectedStart?: string;
  selectedScheduleView?: ScheduleView;
  calendarMessageId?: number;
  busy?: boolean;
  announcementComposer?: {
    id: string;
    step: "idle" | "text" | "media-question" | "media-type" | "media-source";
    mediaType?: "photo" | "video";
    revision: number;
  };
  touchedAt: number;
}

export interface ScheduleLesson {
  scheduleDate: string;
  studyTimeBegin: string;
  studyTimeEnd: string;
  studyTimeName?: string;
  disciplineName: string;
  studyTypeName?: string;
  cabinetNumber?: string;
  empFullName?: string;
  contingentName?: string;
  chairName?: string;
  contentNotes?: string;
  cntOneDay?: number;
}

export interface StudentSubject {
  disciplineName: string;
  semesterId: number;
  semesterName: string;
}

export type BachelorCourse = 1 | 2 | 3 | 4;

/** Minimal persisted academic context. Additional profile fields may be added later. */
export interface StudentProfile {
  course: BachelorCourse;
  academicYear: string;
  tokenFingerprint: string;
  refreshedAt: number;
}

export interface WebDkStudentProfile {
  courseName: string;
  educationLevelName?: string;
}

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}
