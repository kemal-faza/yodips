import { IsOptional, IsString, Matches } from 'class-validator';
import { CLIENT_ID_RE } from '../../session/session-contract';

export class HandoffDto {
  @IsString()
  kulonCookie: string;

  @IsOptional()
  @IsString()
  ssoCookie?: string;

  @IsOptional()
  @IsString()
  microsoftCookie?: string;

  @IsOptional()
  @IsString()
  siapCookie?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  identity?: string;

  /** Installation/surface ID. Optional during P1 (legacy fallback). */
  @IsOptional()
  @Matches(CLIENT_ID_RE)
  clientId?: string;
}
