import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Renew one upstream cookie without replacing the YoDips session. */
export class UpstreamSessionRenewalDto {
  @IsIn(['kulon', 'siap'])
  service!: 'kulon' | 'siap';

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  // Cookie headers must never contain control characters (including CR/LF).
  @Matches(/^[\x20-\x7e]+$/)
  cookie!: string;
}
