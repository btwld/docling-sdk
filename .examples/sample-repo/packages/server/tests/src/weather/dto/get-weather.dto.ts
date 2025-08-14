import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum Units {
  METRIC = 'metric',
  IMPERIAL = 'imperial',
}

export class GetWeatherDto {
  @IsNotEmpty()
  @IsString()
  location: string;

  @IsEnum(Units)
  units: Units = Units.METRIC;
}
