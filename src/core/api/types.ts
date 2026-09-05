/**
 * Slima API 類型定義
 */

// === 書籍相關 ===

// Mirrors Rails `Book::BOOK_TYPES`. 'knowledge' is a team's shared reference
// book — it is NOT a manuscript (excluded from word-count/streak machinery) and
// it is the only book type where some files can be present but withheld.
export type BookType = 'book' | 'script' | 'knowledge';

export interface Book {
  token: string;
  title: string;
  // 'book' = Writing Studio (free-form markdown tree)
  // 'script' = Script Studio (schema-driven screenwriting; MCP writes restricted to planning/)
  bookType?: BookType;
  /** 'personal' | 'team' — a team book's write rules follow team role, not ownership */
  ownershipType?: string;
  /** The caller's role on this book ('owner' | 'admin' | 'writer' | 'editor' | null) */
  myRole?: string | null;
  authorName?: string;
  description?: string;
  language?: string;
  totalWordCount?: number;
  manuscriptWordCount?: number;
  referenceWordCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Rails pagy_metadata — present on every paginated list endpoint. */
export interface PaginationMeta {
  total?: number;
  page?: number;
  perPage?: number;
  totalPages?: number;
}

export interface BooksPage {
  books: Book[];
  meta: PaginationMeta;
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
  referenceWordCount: number;
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
  bookToken?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  reportType: 'chapter' | 'opening' | 'full';
  personaCount: number;
  completedPersonaCount: number;
  personaTokens: string[];
  modelUsed?: string;
  temperature?: number;
  scopeConfig?: Record<string, unknown>;
  aggregatedMetrics?: AggregatedMetrics;
  individualFeedbacks?: IndividualFeedback[];
  creditsUsed?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface AggregatedMetrics {
  overall?: {
    avgContinueReading?: number;
    avgRecommendation?: number;
    avgWantMore?: number;
    dnfRisk?: 'low' | 'medium' | 'high';
    continueReadingDistribution?: Record<string, number>;
  };
  opening?: {
    avgHookEffectiveness?: number;
    avgOrientationSpeed?: number;
    interestCurveSummary?: Record<string, number>;
  };
  characters?: {
    avgProtagonistLikability?: number;
    avgMotivationClarity?: number;
    avgDialogueNaturalness?: number;
    characterScores?: Record<string, number>;
  };
  pacing?: {
    avgOverall?: number;
    consensus?: string;
    commonDnfTriggers?: Array<{ trigger: string; count: number; locations?: string[] }>;
    commonConfusingSections?: Array<{ location: string; reason: string; feeling?: string; suggestion?: string }>;
  };
  context?: {
    avgClarity?: number;
    avgInfoDensity?: number;
    infoDensityAssessment?: string;
    commonConsistencyIssues?: string[];
  };
  market?: {
    topComparableBooks?: Array<{ title: string; mentionedBy?: string[] }>;
    avgWordOfMouth?: number;
  };
  kindleRating?: {
    avgScore: number;
    distribution?: Record<string, number>;
    individualScores?: Array<{ score: number; confidence: string; personaName?: string }>;
  };
}

export interface IndividualFeedback {
  personaToken: string;
  personaName?: string;
  overall?: {
    continueReading?: number;
    recommendation?: number;
    wantMore?: number;
    dnfRisk?: string;
  };
  opening?: {
    hookEffectiveness?: number;
    orientationSpeed?: number;
    interestCurve?: string;
    firstImpression?: string;
  };
  characters?: {
    protagonistLikability?: number;
    motivationClarity?: number;
    dialogueNaturalness?: number;
    characterDetails?: Record<string, unknown>;
    dialogueFeedback?: string;
  };
  pacing?: {
    overall?: number;
    assessment?: string;
    dnfHotspots?: Array<{ location: string; reason: string }>;
    confusingSections?: Array<{ location: string; reason: string; feeling?: string; suggestion?: string }>;
  };
  context?: {
    clarity?: number;
    infoDensity?: number;
    infoDensityAssessment?: string;
    consistencyIssues?: string[];
  };
  market?: {
    comparableBooks?: string[];
    genrePositioning?: string;
    wordOfMouthPotential?: number;
  };
  emotionalJourney?: {
    emotionalArc?: string;
    peakMoments?: string[];
    overallMood?: string;
  };
  detailedFeedback?: {
    whatWorked?: string;
    whatDidntWork?: string;
    strongestElement?: string;
    weakestElement?: string;
    wouldYouBuy?: string;
    specificSuggestions?: string[];
    finalThoughts?: string;
  };
  kindleRating?: {
    score: number;
    rationale?: string;
    confidence?: 'low' | 'medium' | 'high';
  };
}

export interface ReaderTestProgress {
  token: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  completedPersonas: number;
  totalPersonas: number;
  errorMessage?: string;
}

export interface CreateReaderTestParams {
  personaTokens: string[];
  reportType?: 'chapter' | 'opening' | 'full';
  commitToken?: string;
  model?: string;
  scopeConfig?: {
    chapters?: string[];
  };
  content: string;
}

// === MCP File Operations ===

export interface McpFile {
  token: string;
  name: string;
  path: string;
  kind: string;
  fileType?: string;
  wordCount: number;
  blobHash?: string;
}

export interface McpFileReadResponse {
  file: McpFile;
  /** null when the content was withheld or the read budget was spent */
  content: string | null;
  /**
   * Phase KP §4.1 — a confidential team skill read by a non-manager. The AI can
   * still USE the skill (the server injects it as the team owner); it just may
   * not read the source. Rendering this as an empty file makes the model try to
   * "repair" a file it is forbidden to write.
   */
  contentWithheld?: boolean;
  withheldReason?: string;
  /** Phase KP §4.4 — the team's daily skill-read budget is spent. */
  throttled?: boolean;
  throttledReason?: string;
}

export interface McpFileVisualizeResponse {
  file: McpFile;
  /** 'png' when an image was produced, 'none' when only the summary is available */
  format: 'png' | 'none';
  /** base64 PNG; absent when format === 'none' */
  image?: string;
  /** Always present for a successful render — the part every client can use */
  summary?: string;
  stats?: {
    nodes: number;
    edges: number;
    groups: number;
    danglingEdges?: number;
  };
  imageUnavailable?: boolean;
  imageError?: string;
  /** Confidential team skill withheld from a non-manager (Phase KP) */
  contentWithheld?: boolean;
  withheldReason?: string;
  throttled?: boolean;
  throttledReason?: string;
}

export interface McpFileCreateResponse {
  commit: Commit;
  fileToken: string;
  /**
   * Present when the server replaced what was sent. Currently one case: a
   * structured type starts as an empty skeleton, so any `content` passed to
   * `create_file` is not stored. The tool MUST show these — a 201 that quietly
   * dropped the content leaves the model working from a file it never wrote.
   */
  notes?: string[];
}

export interface McpFileUpdateResponse {
  commit: Commit;
  /**
   * Present when the server replaced what was sent — currently only when
   * `create_file` makes an empty skeleton for a structured type. The tool MUST
   * surface these: a 201 that silently dropped the content is the worst shape
   * of failure, because the model then works from a file it thinks it wrote.
   */
  notes?: string[];
}

/** One operation the server applied, with the id it created (if any). */
export interface McpStructuredApplied {
  op: string;
  id?: string;
  op_ref?: string;
}

export interface McpStructuredResponse {
  commit: Commit;
  /**
   * New ids, in operation order. Without these the model has to re-read the
   * whole file just to learn what it just made.
   */
  applied: McpStructuredApplied[];
  /**
   * Side effects the model did not ask for but the author will notice —
   * "removing this act left 3 beats unassigned". Not errors; things to relay.
   */
  notes: string[];
}

export interface McpFileEditResponse {
  commit: Commit;
  /** How many replacements the SERVER actually applied (never a local guess) */
  replacements: number;
}

export interface McpFileDeleteResponse {
  commit: Commit;
  /** How many files/folders went with a recursive folder delete (0 for a plain file). */
  deletedDescendants?: number;
}

export interface McpFileAppendResponse {
  commit: Commit;
}

export interface McpSearchMatch {
  file: McpFile;
  snippets: Array<{
    text: string;
    highlightStart: number;
    highlightEnd: number;
  }>;
  matchCount: number;
}

export interface McpSearchResponse {
  matches: McpSearchMatch[];
  query: string;
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

// 特殊回應格式（API 回傳包裝物件）
export interface CommitsListResponse {
  commits: Commit[];
}

export interface BlobsDownloadResponse {
  blobs: Blob[];
  notFound: string[];
  truncated: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
