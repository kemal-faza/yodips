import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorCopy, type ErrorCopy } from '../common/error-copy';
import { USER_MESSAGES } from '../common/user-messages';

/**
 * One place that decides what a failing HTTP request looks like on the wire.
 *
 * Before this filter the app leaked Nest's defaults: validation arrays in
 * English (`['notificationId must be a string']`), the bare `ThrottlerException`
 * text on 429, `Cannot GET /api/...` on unknown routes, and `Internal server
 * error` on unhandled failures. Clients rendered those strings verbatim.
 *
 * Rules:
 *  - an HttpException keeps its own body (services already write Indonesian,
 *    actionable copy and canonical `code`s) unless the body is a framework
 *    default, a validation array or the throttle dump;
 *  - the raw detail is logged here and never echoed;
 *  - unknown throwables become a generic 500 (no class name, no stack).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const copy: ErrorCopy = exception instanceof HttpException
      ? errorCopy(status, raw)
      : { message: USER_MESSAGES.SERVER };

    this.log(exception, status, request, copy);

    const body =
      exception instanceof HttpException && raw !== null && typeof raw === 'object'
        ? {
            message: copy.message,
            ...(copy.code === undefined ? {} : { code: copy.code }),
            statusCode: status,
          }
        : { statusCode: status, message: copy.message };

    response.status(status).json(body);
  }

  private log(
    exception: unknown,
    status: number,
    request: Request,
    copy: ErrorCopy,
  ): void {
    const path = `${request.method ?? '?'} ${request.originalUrl ?? request.url ?? '?'}`;
    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${path} -> ${status}`, stack);
      return;
    }
    if (copy.detail !== undefined) {
      // Validation fields / raw upstream text stay server-side.
      this.logger.warn(`${path} -> ${status}: ${copy.detail}`);
    }
  }
}
