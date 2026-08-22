import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { KulonService } from './kulon.service';

/** True bila error berasal dari sesi upstream stale (-> dorong re-login). */
export function isStaleUpstreamError(e: unknown): boolean {
  return (
    e instanceof HttpException && e.getStatus() === HttpStatus.UNAUTHORIZED
  );
}

/**
 * Probe validitas sesi Kulon via sesskey /my/. Sebelumnya privat di
 * KulonController; diekstrak agar poller notifikasi memakai jalur deteksi
 * stale yang sama tanpa duplikasi logika redirect-loop/login-page.
 */
@Injectable()
export class KulonSessionProbe {
  private readonly logger = new Logger(KulonSessionProbe.name);

  constructor(private readonly kulonService: KulonService) {}

  async fetchSesskeyOrThrow(kulonCookie: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch('https://kulon2.undip.ac.id/my/', {
        headers: { Cookie: kulonCookie },
        redirect: 'follow',
      });
    } catch (e) {
      if (
        (e as Error)?.cause &&
        /redirect count exceeded/i.test(String((e as Error).cause))
      ) {
        throw new HttpException(
          { message: 'Session Kulon expired. Silakan login ulang via SSO' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.logger.error(
        `Kulon connection failed: ${(e as Error)?.message}`,
        (e as Error)?.stack,
      );
      throw new HttpException(
        { message: 'Gagal terhubung ke Kulon', detail: 'BAD_GATEWAY' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      throw new HttpException(
        { message: 'Kulon mengalami gangguan. Silakan login ulang via SSO' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const html = await res.text();
    try {
      return this.kulonService.parseSesskey(html);
    } catch (e) {
      if (this.isLoginPage(res.url, html)) {
        throw new HttpException(
          { message: 'Session Kulon expired. Silakan login ulang via SSO' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw e;
    }
  }

  private isLoginPage(finalUrl: string, html: string): boolean {
    if (/(login\.microsoftonline\.com|\/login\/)/i.test(finalUrl)) return true;
    return !/name="sesskey"/.test(html);
  }
}
