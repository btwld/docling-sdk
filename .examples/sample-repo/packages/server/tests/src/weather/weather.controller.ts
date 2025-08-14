import { Controller } from '@nestjs/common';
import { Context, Tool } from '../../../src';
import { GetWeatherDto, Units } from './dto/get-weather.dto';
import { GetWeatherAlertDto } from './dto/get-weather-alert.dto';
import { WeatherSettingsDto } from './dto/weather-settings.dto';
import { z } from 'zod';

// Define a Zod schema directly for weather forecast
const ForecastSchema = z.object({
  location: z.string().min(1, { message: 'Location is required' }),
  days: z.number().int().min(1).max(10).default(3),
  includeHourly: z.boolean().default(false),
});

// Type inference from the Zod schema
type ForecastRequest = z.infer<typeof ForecastSchema>;

@Controller('weather')
export class WeatherController {
  @Tool({
    name: 'get-weather',
    description: 'Get the current weather for a location',
    parameters: GetWeatherDto,
  })
  async getWeather({
    data,
    context,
  }: {
    data: GetWeatherDto;
    context: Context;
  }) {
    const { location, units } = data;

    // Skip logging for tests
    // context?.log?.info?.(`Getting weather for ${location} in ${units} units`);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Mock weather data
    const weatherData = {
      location,
      temperature: units === Units.METRIC ? 22 : 72,
      condition: 'Sunny',
      humidity: 45,
      windSpeed: units === Units.METRIC ? 5 : 11,
      windDirection: 'NE',
      forecast: [
        {
          day: 'Today',
          high: units === Units.METRIC ? 24 : 75,
          low: units === Units.METRIC ? 18 : 65,
          condition: 'Sunny',
        },
        {
          day: 'Tomorrow',
          high: units === Units.METRIC ? 23 : 73,
          low: units === Units.METRIC ? 17 : 63,
          condition: 'Partly Cloudy',
        },
        {
          day: 'Day After',
          high: units === Units.METRIC ? 21 : 70,
          low: units === Units.METRIC ? 16 : 61,
          condition: 'Cloudy',
        },
      ],
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(weatherData),
        },
      ],
      isError: false,
    };
  }

  @Tool({
    name: 'get-weather-alert',
    description: 'Get weather alerts for a location',
    parameters: GetWeatherAlertDto,
  })
  async getWeatherAlert({
    data,
    // Unused but kept for consistency
    context,
  }: {
    data: GetWeatherAlertDto;
    context: Context;
  }) {
    const { location } = data;

    // Skip logging for tests
    // context?.log?.info?.(`Getting weather alerts for ${location}`);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Mock weather alert data
    const alertData = {
      location,
      alerts: [
        {
          type: 'Severe Thunderstorm',
          severity: 'Moderate',
          description:
            'Thunderstorms expected in the area with possible heavy rain and lightning.',
          startTime: new Date(Date.now() + 3600000).toISOString(),
          endTime: new Date(Date.now() + 7200000).toISOString(),
        },
      ],
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(alertData),
        },
      ],
      isError: false,
    };
  }

  @Tool({
    name: 'update-weather-settings',
    description: 'Update user weather preferences',
    parameters: WeatherSettingsDto,
  })
  async updateWeatherSettings({
    data,
    // Unused but kept for consistency
    context,
  }: {
    data: WeatherSettingsDto;
    context: Context;
  }) {
    const {
      defaultLocation,
      defaultUnits,
      forecastDays,
      visibleFields,
      display,
    } = data;

    // Skip logging for tests
    // context?.log?.info?.(
    //   `Updating weather settings for ${defaultLocation} with units ${defaultUnits}`,
    // );

    // In a real implementation, this would save the settings to a database
    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Return the saved settings
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Weather settings updated successfully',
            settings: {
              defaultLocation,
              defaultUnits,
              forecastDays,
              visibleFields,
              display,
            },
          }),
        },
      ],
      isError: false,
    };
  }

  @Tool({
    name: 'get-forecast',
    description: 'Get weather forecast for a location',
    parameters: ForecastSchema,
  })
  async getForecast(
    data: ForecastRequest,
    // Unused but kept for consistency
    context: Context,
  ) {
    const { location, days, includeHourly } = data;

    // Skip logging for tests
    // context?.log?.info?.(
    //   `Getting ${days}-day forecast for ${location} (hourly: ${includeHourly})`,
    // );

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Generate mock forecast data
    const forecast = {
      location,
      days: Array.from({ length: days }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() + i);

        return {
          date: date.toISOString().split('T')[0],
          high: Math.round(15 + 10 * Math.random()), // Random temperature between 15-25
          low: Math.round(5 + 8 * Math.random()), // Random temperature between 5-13
          condition: ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy'][
            Math.floor(Math.random() * 4)
          ],
          hourly: includeHourly
            ? Array.from({ length: 24 }, (_, hour) => ({
                hour: hour,
                temp: Math.round(10 + 15 * Math.random()),
                condition: [
                  'Clear',
                  'Partly Cloudy',
                  'Cloudy',
                  'Rain',
                  'Thunderstorm',
                ][Math.floor(Math.random() * 5)],
              }))
            : undefined,
        };
      }),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(forecast),
        },
      ],
      isError: false,
    };
  }
}
