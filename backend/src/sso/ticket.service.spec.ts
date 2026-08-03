import 'reflect-metadata';
import { SSOTicketService } from './ticket.service';

describe('SSOTicketService', () => {
  let svc: SSOTicketService;
  beforeEach(() => {
    svc = new SSOTicketService();
  });

  it('generates base64 of a unix timestamp', () => {
    const t = svc.generateTicket();
    const decoded = Buffer.from(t, 'base64').toString();
    expect(Number(decoded)).toBeGreaterThan(1750000000);
  });

  it('builds kulon service url with ticket', () => {
    const url = svc.buildServiceUrl('kulon', 'MTIz');
    expect(url).toBe('https://kulon2.undip.ac.id/auth/oidc/?t=MTIz');
  });

  it('builds siap service url with ticket', () => {
    const url = svc.buildServiceUrl('siap', 'MTIz');
    expect(url).toBe('https://siap.undip.ac.id/sso/login?t=MTIz');
  });
});