export interface UserApp {
    id: string;
    userId: string;
    html: string;
    css: string;
    js: string;
    backendCode?: string;
    createdAt: number;
    expiresAt: number;
}

export interface PreviewSession {
    sessionId: string;
    appId: string;
    publicUrl: string;
    status: 'creating' | 'live' | 'expired' | 'failed';
}
