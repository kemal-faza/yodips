import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class WebDeviceDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^https:\/\//i, { message: 'endpoint harus https' })
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}
