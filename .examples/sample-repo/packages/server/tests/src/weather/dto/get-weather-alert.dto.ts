import { IsNotEmpty, IsString } from 'class-validator';

export class GetWeatherAlertDto {
  @IsNotEmpty()
  @IsString()
  location: string;
}
