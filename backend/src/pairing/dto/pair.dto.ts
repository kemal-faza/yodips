import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { CLIENT_ID_RE } from '../../session/session-contract';

export class ConsumeDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  /** Installation/surface ID of the device consuming the code. */
  @IsOptional()
  @Matches(CLIENT_ID_RE)
  clientId?: string;
}
