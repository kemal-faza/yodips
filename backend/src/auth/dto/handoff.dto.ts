import { IsOptional, IsString, Matches } from 'class-validator';

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
}
