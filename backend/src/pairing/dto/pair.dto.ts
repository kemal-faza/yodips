import { IsNotEmpty, IsString } from 'class-validator';

export class ConsumeDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}
