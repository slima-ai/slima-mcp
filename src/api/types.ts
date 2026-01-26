/**
 * Slima API 類型定義
 */

// === 書籍相關 ===

export interface Book {
  token: string;
  title: string;
  authorName?: string;
  description?: string;
  language?: string;
  totalWordCount?: number;
  manuscriptWordCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// === 版本控制相關 ===

export interface Commit {
  token: string;
  parentToken?: string;
  name: string;
  message?: string;
  commitType: 'manual' | 'auto';
  fileCount: number;
  totalWordCount: number;
  manuscriptWordCount: number;
  deviceId?: string;
  deviceName?: string;
  createdAt: string;
  filesSnapshot: FileSnapshot[];
}

export interface FileSnapshot {
  token: string;
  name: string;
  kind: 'file' | 'folder';
  blobHash?: string;
  wordCount?: number;
  isManuscript?: boolean;
  position: number;
  children?: FileSnapshot[];
}

export interface Branch {
  token: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isArchived: boolean;
  color?: string;
  headCommitToken?: string;
  branchedFromCommitToken?: string;
}

export interface Blob {
  hash: string;
  content: string;
  size: number;
}

// === Persona 相關 ===

export interface Persona {
  token: string;
  slug: string;
  isSystem: boolean;
  genreTags?: string[];
  demographics?: {
    gender?: string;
    ageRange?: string;
    occupation?: string;
  };
  psychographics?: {
    personality?: string;
    values?: string[];
  };
  readingBehavior?: {
    pacePreference?: string;
    focusAreas?: string[];
  };
  preferences?: Record<string, unknown>;
  avatarUrl?: string;
  source: 'manual' | 'ai';
  displayLabels?: {
    zh?: string;
    en?: string;
  };
}

// === Reader Test 相關 ===

export interface ReaderTest {
  token: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  personaResults?: PersonaResult[];
  createdAt: string;
}

export interface PersonaResult {
  persona?: Persona;
  overallImpression?: string;
  emotionalResponse?: string;
  characterFeedback?: string;
  suggestions?: string;
}

export interface ReaderTestProgress {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
}

export interface CreateReaderTestParams {
  personaTokens: string[];
  commitToken?: string;
  scopeConfig?: {
    chapters?: string[];
  };
  content?: string;
}

// === API 回應 ===

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    perPage?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
