import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Units } from './get-weather.dto';

export class DisplayOptions {
  @IsBoolean()
  showHumidity: boolean = true;

  @IsBoolean()
  showWindSpeed: boolean = true;

  @IsBoolean()
  showUVIndex: boolean = false;

  @IsBoolean()
  showForecast: boolean = true;
}

export class WeatherSettingsDto {
  @IsString()
  @IsOptional()
  defaultLocation: string = 'New York';

  @IsEnum(Units)
  defaultUnits: Units = Units.METRIC;

  @IsInt()
  forecastDays: number = 5;

  @IsArray()
  @IsString({ each: true })
  visibleFields: string[] = ['temperature', 'condition', 'humidity'];

  @IsObject()
  @ValidateNested()
  @Type(() => DisplayOptions)
  display: DisplayOptions = new DisplayOptions();
}
