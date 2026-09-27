import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Only the Kulon renewal flow is currently supported by this endpoint. */
export class UpstreamSessionRenewalDto {
  @IsIn(['kulon'])
  service!: 'kulon';

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  // Cookie headers must never contain control characters (including CR/LF).
  @Matches(/^[\x20-\x7e]+$/)
  cookie!: string;
}
