export type Service = 'sso' | 'kulon' | 'siap';

export type FlowMode = 'auto' | 'semi';

export interface CookieFlags {
  hasSso: boolean;
  hasKulon: boolean;
  hasSiap: boolean;
}

export type OutboundStatus =
  | { status: 'ok'; accessToken: string }
  | { status: 'started'; mode: FlowMode; message?: string }
  | { status: 'error'; message: string };

export type InboundMessage =
  | { action: 'handoff' }
  | { action: 'ping' }
  | { action: 'logout' }
  | { action: 'status' }
  | { action: 'done' };

export interface HandoffRaw {
  ok: boolean;
  status: number;
  code?: string;
  reason?: string;
  message?: string;
  accessToken?: string;
  hasSso?: boolean;
  hasMicrosoft?: boolean;
  hasKulon?: boolean;
  hasSiap?: boolean;
}