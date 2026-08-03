import { Injectable } from '@nestjs/common';

export type ServiceKey =
  | 'siap'
  | 'kulon'
  | 'mandala'
  | 'scholarship'
  | 'event';

const SERVICE_URLS: Record<ServiceKey, (t: string) => string> = {
  siap: (t) => `https://siap.undip.ac.id/sso/login?t=${t}`,
  kulon: (t) => `https://kulon2.undip.ac.id/auth/oidc/?t=${t}`,
  mandala: (t) => `https://mandala.undip.ac.id/login/azure?t=${t}`,
  scholarship: (t) => `https://beasiswa.undip.ac.id/sso/auth?t=${t}`,
  event: (t) => `https://event.bak.undip.ac.id/sso/login?t=${t}`,
};

@Injectable()
export class SSOTicketService {
  generateTicket(): string {
    return Buffer.from(String(Math.floor(Date.now() / 1000))).toString('base64');
  }

  buildServiceUrl(service: ServiceKey, ticket: string): string {
    return SERVICE_URLS[service](ticket);
  }
}