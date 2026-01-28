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
  content: string;
}

export interface McpFileCreateResponse {
  commit: Commit;
  fileToken: string;
}

export interface McpFileUpdateResponse {
  commit: Commit;
}

export interface McpFileDeleteResponse {
  commit: Commit;
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
