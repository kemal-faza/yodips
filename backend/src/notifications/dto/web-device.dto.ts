import {
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isBase64Url, validateWebPushEndpointShape } from '../endpoint-policy';

@ValidatorConstraint({ name: 'publicWebPushEndpoint', async: false })
class IsPublicWebPushEndpoint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return validateWebPushEndpointShape(value).ok;
  }
  defaultMessage(): string {
    return 'endpoint harus https tanpa kredensial/fragment/port eksplisit/IP mentah, dengan path';
  }
}

@ValidatorConstraint({ name: 'webPushBase64Url', async: false })
class IsWebPushBase64Url implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return isBase64Url(value);
  }
  defaultMessage(): string {
    return 'nilai harus base64url tanpa padding';
  }
}

export class WebDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @Validate(IsPublicWebPushEndpoint)
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Validate(IsWebPushBase64Url)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Validate(IsWebPushBase64Url)
  auth!: string;
}
